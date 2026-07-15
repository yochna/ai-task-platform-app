const mongoose = require('mongoose');

const OPERATIONS = ['UPPERCASE', 'LOWERCASE', 'REVERSE_STRING', 'WORD_COUNT'];
const STATUSES = ['PENDING', 'RUNNING', 'SUCCESS', 'FAILED'];

const taskSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true },
    inputText: { type: String, required: true },
    operationType: { type: String, enum: OPERATIONS, required: true },
    status: { type: String, enum: STATUSES, default: 'PENDING', index: true },
    result: { type: String, default: null },
    logs: [{ message: String, timestamp: { type: Date, default: Date.now } }],
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    error: { type: String, default: null },
  },
  { timestamps: true }
);

// Compound index: most common query pattern is "a user's tasks, newest first,
// optionally filtered by status" -> covers list + filter without a collection scan.
taskSchema.index({ user: 1, createdAt: -1 });
taskSchema.index({ user: 1, status: 1 });

module.exports = mongoose.model('Task', taskSchema);
module.exports.OPERATIONS = OPERATIONS;
module.exports.STATUSES = STATUSES;
