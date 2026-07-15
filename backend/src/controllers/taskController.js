const Task = require('../models/Task');
const { OPERATIONS } = require('../models/Task');
const getRedisClient = require('../config/redis');

async function createTask(req, res, next) {
  try {
    const { title, inputText, operationType } = req.body;

    if (!title || !inputText || !operationType) {
      return res.status(400).json({ error: 'title, inputText and operationType are required' });
    }
    if (!OPERATIONS.includes(operationType)) {
      return res.status(400).json({ error: `operationType must be one of: ${OPERATIONS.join(', ')}` });
    }

    const task = await Task.create({
      user: req.user.id,
      title,
      inputText,
      operationType,
      status: 'PENDING',
    });

    res.status(201).json({ task });
  } catch (err) {
    next(err);
  }
}

// Pushes an existing PENDING task onto the Redis queue for the worker to pick up.
async function runTask(req, res, next) {
  try {
    const task = await Task.findOne({ _id: req.params.id, user: req.user.id });
    if (!task) return res.status(404).json({ error: 'Task not found' });

    if (task.status === 'RUNNING') {
      return res.status(409).json({ error: 'Task is already running' });
    }

    task.status = 'PENDING';
    task.error = null;
    task.logs.push({ message: 'Task queued for execution' });
    await task.save();

    const redis = await getRedisClient();
    await redis.lPush(
      process.env.REDIS_QUEUE_NAME || 'ai_tasks_queue',
      JSON.stringify({ taskId: task._id.toString() })
    );

    res.json({ message: 'Task queued', task });
  } catch (err) {
    next(err);
  }
}

async function listTasks(req, res, next) {
  try {
    const { status } = req.query;
    const filter = { user: req.user.id };
    if (status) filter.status = status;

    const tasks = await Task.find(filter).sort({ createdAt: -1 }).limit(200);
    res.json({ tasks });
  } catch (err) {
    next(err);
  }
}

async function getTask(req, res, next) {
  try {
    const task = await Task.findOne({ _id: req.params.id, user: req.user.id });
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json({ task });
  } catch (err) {
    next(err);
  }
}

module.exports = { createTask, runTask, listTasks, getTask };
