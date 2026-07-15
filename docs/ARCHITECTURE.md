# Architecture Document — AI Task Processing Platform

## 1. Overall System Architecture

The platform follows a producer/consumer pattern, decoupling the user-facing
request path from actual task execution:

```
┌──────────┐      ┌──────────────┐      ┌────────┐      ┌───────────────┐
│  React    │ REST │  Express API  │ push │  Redis  │ pop │ Python Worker  │
│ Frontend  │─────▶│  (Node.js)    │─────▶│  Queue  │────▶│  (N replicas)  │
└──────────┘      └──────┬───────┘      └────────┘      └───────┬───────┘
                          │                                       │
                          ▼                                       ▼
                     ┌─────────┐                            ┌─────────┐
                     │ MongoDB │◀───────────────────────────│ MongoDB │
                     │ (tasks, │        status/result        │ (writes)│
                     │  users) │                              └─────────┘
                     └─────────┘
```

- **Frontend (React/Vite)** — auth screens and a task dashboard that polls
  `GET /api/tasks` every 3s to reflect status transitions without a manual
  refresh (a WebSocket/SSE push channel is a natural next step, noted below).
- **Backend (Node/Express)** — owns all writes to Mongo for task metadata,
  handles auth (JWT + bcrypt), and is the **only** producer onto the Redis
  queue. It never executes task logic itself — `POST /tasks/:id/run` only
  flips the task to `PENDING` and pushes `{ taskId }` onto Redis.
- **Redis** — a single list (`ai_tasks_queue`) used as a work queue via
  `LPUSH` (producer) / `BRPOP` (consumer). This gives natural back-pressure:
  if workers fall behind, the queue simply grows instead of the API blocking.
- **Worker (Python)** — stateless consumers that block on `BRPOP`, fetch the
  full task document from Mongo by ID (source of truth, not the queue
  payload, so the message stays tiny and there's no data-duplication drift),
  run the operation, and write status/result/logs back to Mongo.
- **MongoDB** — single source of truth for both users and tasks; the API and
  workers both read/write it directly, so a worker crash mid-task doesn't
  strand state anywhere the API can't see it.

Each component is independently deployable and independently scalable
(see §2), and the queue is the only coupling between the API and the worker
fleet — neither knows about the other's replica count.

## 2. Worker Scaling Strategy

Workers are stateless: any replica can pop any message, so scaling out is
just adding replicas. Two mechanisms are in place:

1. **HorizontalPodAutoscaler (implemented)** — scales the `worker` Deployment
   between 2 and 10 replicas on CPU utilization (target 70%). This is the
   simplest signal available without extra infrastructure and works
   reasonably well because operation execution is CPU-bound.
2. **Queue-depth-based scaling (recommended next step)** — CPU is a lagging
   indicator; a truer signal is Redis `LLEN ai_tasks_queue`. In production
   this project would move to **KEDA** with a `redis-list` ScaledObject that
   scales workers directly on queue length, e.g. targeting ~10 pending items
   per replica. This reacts faster to bursts and can also scale to zero
   during idle periods, which the CPU-based HPA cannot do.

Because workers only hold a single message at a time in memory and commit
progress to Mongo continuously (status → RUNNING before processing, logs
appended per attempt), losing a worker pod mid-task is safe: the task is
left in `RUNNING` and a reconciliation job (or a manual re-run) can pick it
back up — no in-flight work is silently lost from the queue itself, since
Redis only removes a message once `BRPOP` has already handed it to a worker.

## 3. Handling High Task Volume (~100,000 tasks/day)

100,000 tasks/day averages to ~1.16 tasks/sec, but real traffic is bursty
(exam-season peaks, business-hours skew), so the design targets bursts of
10-20x average, not just the average:

- **Producer side stays cheap**: `POST /tasks/:id/run` is an O(1) Mongo write
  + O(1) Redis `LPUSH`. The API's own horizontal scaling (2+ replicas,
  stateless, behind the Service) handles request-volume independent of
  worker throughput — a slow worker fleet never blocks the API from
  accepting new tasks.
- **Queue absorbs bursts**: Redis lists handle millions of small entries
  comfortably; the queue is the buffer between bursty arrival and steady
  processing capacity, so workers are sized for *average* throughput plus
  the KEDA/HPA autoscaling handles the burst.
- **Worker throughput math**: if a single worker processes ~5 tasks/sec
  (simple string ops are sub-millisecond; this budgets for future
  heavier AI operations), 10 workers comfortably clear 100k tasks/day with
  significant headroom, which is why the HPA ceiling is set to 10 with room
  to raise it.
- **Mongo write load**: each task produces a handful of small updates
  (status → RUNNING, one or more log pushes, final result). At this volume
  that's well within a single replica set's capacity, but see indexing
  strategy (§4) to keep those writes/reads cheap as data grows.
- **Idempotency**: `process_task` is safe to re-run (it re-reads the task by
  ID and overwrites status/result), so if a worker is killed and a task is
  retried by an operator, re-processing doesn't corrupt state.

## 4. MongoDB Indexing Strategy

Two indexes back the actual query patterns the app makes (see `Task.js`):

- `{ user: 1, createdAt: -1 }` — the dashboard's primary query
  (`find({ user }).sort({ createdAt: -1 })`) is a per-user, most-recent-first
  list; this compound index lets Mongo satisfy both the filter and the sort
  without an in-memory sort stage.
- `{ user: 1, status: 1 }` — supports the "filter by status" dashboard view
  (`?status=RUNNING`) and would back a future ops dashboard that needs to
  count/scan tasks by status per user.
- `User.email` has a `unique` index (declared in the schema) for both login
  lookups and duplicate-registration checks in O(log n).

At 100k tasks/day (~36M tasks/year), collection size grows quickly, so two
follow-ups are called out for production hardening rather than implemented
here: (a) add a TTL index on `completedAt` if old task history doesn't need
to live forever, and (b) monitor index selectivity with `explain()` once
real traffic patterns emerge, since synthetic assumptions here may not match
actual usage.

## 5. Redis Failure Handling and Recovery Strategy

- **Persistence**: Redis runs with `--appendonly yes` (AOF) and a
  PersistentVolumeClaim in Kubernetes, so a pod restart doesn't lose queued
  messages the way an in-memory-only cache would.
- **Connection failures (worker side)**: `main.py`'s loop catches
  `redis.exceptions.ConnectionError` specifically, logs it, sleeps 3s, and
  retries — the process never crashes on a transient Redis blip, it just
  backs off and keeps polling.
- **Connection failures (API side)**: the Node Redis client's `error` event
  is logged; since `LPUSH` only happens inside `POST /tasks/:id/run`, a
  Redis outage causes that specific request to fail with a 500 rather than
  silently dropping the task — the task record already exists in Mongo with
  status `PENDING`/unqueued, so nothing is lost, and the run can be retried
  once Redis recovers.
- **Message loss window**: because `BRPOP` is atomic (a message is only
  removed from the list once delivered to a client), the only loss scenario
  is a worker crashing *after* `BRPOP` returns but *before* it finishes
  processing — that message is gone from Redis. This is mitigated by the
  fact that the task's true state lives in Mongo (status `RUNNING` with no
  `completedAt`), so a periodic reconciliation job (cron or a Kubernetes
  CronJob, not yet implemented) can find tasks stuck in `RUNNING` past a
  timeout and re-enqueue them — noted as a production follow-up.
- **Single point of failure**: this deployment runs Redis as a single
  replica for simplicity, which is a real limitation. Production hardening
  would move to a managed Redis (e.g., AWS ElastiCache/Redis Cloud) with
  replication and automatic failover, or Redis Sentinel if self-hosted.

## 6. Deployment Strategy

### Staging
- Deployed from the `main` branch on every merge, via the same CI/CD
  pipeline described in the README, but targeting a separate `ai-task-platform-staging`
  namespace/Argo CD Application with its own Mongo/Redis instances (not
  shared with production) so staging data and load never affect prod.
- Images are tagged with the short commit SHA (not just `latest`), so
  staging always deploys a specific, traceable build, and rollback is a
  one-line manifest change back to a prior SHA.

### Production
- Promotion to production is a **deliberate, separate step** from staging
  deploys — e.g., a manually-triggered "promote" workflow that copies the
  already-tested image tags from staging into the production infra repo
  path/branch, rather than auto-deploying every merge straight to prod.
- Argo CD's `selfHeal: true` (see `infra/argocd/application.yaml`) means
  production always converges back to whatever's committed in the infra
  repo — manual `kubectl edit` drift is corrected automatically, which
  keeps git as the single source of truth for what's actually running.
- Resource requests/limits, readiness/liveness probes, and the worker HPA
  (all defined in `infra/k8s/`) are the same manifests used in staging,
  just applied to the production namespace — the only difference between
  environments is which image tag is deployed and which Mongo/Redis
  instances they point at (via the ConfigMap), which avoids configuration
  drift between staging and prod.
- Rollback: since Argo CD tracks git history, reverting a bad production
  deploy is `git revert` on the infra repo — Argo CD's auto-sync picks up
  the reverted manifest and rolls the cluster back within one sync cycle.
