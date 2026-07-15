const express = require('express');
const requireAuth = require('../middleware/auth');
const { createTask, runTask, listTasks, getTask } = require('../controllers/taskController');

const router = express.Router();

router.use(requireAuth);

router.post('/', createTask);
router.get('/', listTasks);
router.get('/:id', getTask);
router.post('/:id/run', runTask);

module.exports = router;
