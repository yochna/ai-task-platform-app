import json
import logging
import os
import signal
import sys
import time
from datetime import datetime, timezone

import redis
from bson import ObjectId
from dotenv import load_dotenv
from pymongo import MongoClient

from operations import run_operation

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [worker] %(levelname)s %(message)s",
)
log = logging.getLogger("worker")

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379")
QUEUE_NAME = os.getenv("REDIS_QUEUE_NAME", "ai_tasks_queue")
MONGO_URI = os.getenv("MONGO_URI", "mongodb://mongo:27017/ai_task_platform")
BLOCK_TIMEOUT_SECONDS = int(os.getenv("BLOCK_TIMEOUT_SECONDS", "5"))
HEARTBEAT_FILE = "/tmp/worker_alive"
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "3"))

running = True


def handle_shutdown(signum, frame):
    global running
    log.info("Received signal %s, shutting down after current task...", signum)
    running = False


signal.signal(signal.SIGTERM, handle_shutdown)
signal.signal(signal.SIGINT, handle_shutdown)


def get_redis_client():
    return redis.from_url(REDIS_URL, decode_responses=True)


def get_mongo_collection():
    client = MongoClient(MONGO_URI)
    db = client.get_default_database()
    return db["tasks"]


def process_task(tasks_col, task_id: str):
    task = tasks_col.find_one({"_id": ObjectId(task_id)})
    if not task:
        log.warning("Task %s not found, skipping", task_id)
        return

    now = datetime.now(timezone.utc)
    tasks_col.update_one(
        {"_id": task["_id"]},
        {
            "$set": {"status": "RUNNING", "startedAt": now, "error": None},
            "$push": {"logs": {"message": "Worker picked up task", "timestamp": now}},
        },
    )
    log.info("Processing task %s (%s)", task_id, task.get("operationType"))

    attempt = 0
    last_err = None
    while attempt < MAX_RETRIES:
        attempt += 1
        try:
            result = run_operation(task["operationType"], task["inputText"])
            completed_at = datetime.now(timezone.utc)
            tasks_col.update_one(
                {"_id": task["_id"]},
                {
                    "$set": {
                        "status": "SUCCESS",
                        "result": result,
                        "completedAt": completed_at,
                    },
                    "$push": {
                        "logs": {
                            "message": f"Task completed successfully on attempt {attempt}",
                            "timestamp": completed_at,
                        }
                    },
                },
            )
            log.info("Task %s completed successfully", task_id)
            return
        except Exception as exc:  # noqa: BLE001 - we want to catch & log any op failure
            last_err = str(exc)
            log.error("Task %s failed on attempt %s: %s", task_id, attempt, last_err)
            tasks_col.update_one(
                {"_id": task["_id"]},
                {
                    "$push": {
                        "logs": {
                            "message": f"Attempt {attempt} failed: {last_err}",
                            "timestamp": datetime.now(timezone.utc),
                        }
                    }
                },
            )
            time.sleep(min(2 ** attempt, 10))

    failed_at = datetime.now(timezone.utc)
    tasks_col.update_one(
        {"_id": task["_id"]},
        {
            "$set": {
                "status": "FAILED",
                "error": last_err,
                "completedAt": failed_at,
            }
        },
    )
    log.error("Task %s failed after %s attempts", task_id, MAX_RETRIES)


def main():
    log.info("Worker starting. Queue=%s Mongo=%s", QUEUE_NAME, MONGO_URI)
    r = get_redis_client()
    tasks_col = get_mongo_collection()

    while running:
        try:
            with open(HEARTBEAT_FILE, "w") as f:
                f.write(str(time.time()))
            item = r.brpop(QUEUE_NAME, timeout=BLOCK_TIMEOUT_SECONDS)
            if item is None:
                continue  # timeout, loop back and check `running`
            _, payload = item
            data = json.loads(payload)
            task_id = data.get("taskId")
            if not task_id:
                log.warning("Received malformed queue message: %s", payload)
                continue
            process_task(tasks_col, task_id)
        except redis.exceptions.ConnectionError as exc:
            log.error("Redis connection error: %s. Retrying in 3s...", exc)
            time.sleep(3)
        except Exception as exc:  # noqa: BLE001
            log.exception("Unexpected error in main loop: %s", exc)
            time.sleep(2)

    log.info("Worker stopped cleanly.")
    sys.exit(0)


if __name__ == "__main__":
    main()