import { useEffect, useState, useCallback } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

const OPERATIONS = ['UPPERCASE', 'LOWERCASE', 'REVERSE_STRING', 'WORD_COUNT'];

const STATUS_COLORS = {
  PENDING: '#999',
  RUNNING: '#0077cc',
  SUCCESS: '#1a8f3c',
  FAILED: '#cc2a2a',
};

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [title, setTitle] = useState('');
  const [inputText, setInputText] = useState('');
  const [operationType, setOperationType] = useState(OPERATIONS[0]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const fetchTasks = useCallback(async () => {
    const res = await api.get('/tasks');
    setTasks(res.data.tasks);
  }, []);

  useEffect(() => {
    fetchTasks();
    // Poll so RUNNING/PENDING tasks reflect worker progress without a manual refresh.
    const interval = setInterval(fetchTasks, 3000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    setCreating(true);
    try {
      const res = await api.post('/tasks', { title, inputText, operationType });
      await api.post(`/tasks/${res.data.task._id}/run`);
      setTitle('');
      setInputText('');
      await fetchTasks();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create task');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: '40px auto', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>AI Task Platform</h2>
        <div>
          <span style={{ marginRight: 12 }}>{user?.name}</span>
          <button onClick={logout}>Log out</button>
        </div>
      </div>

      <form onSubmit={handleCreate} style={{ margin: '24px 0', padding: 16, border: '1px solid #ddd' }}>
        <h3>New task</h3>
        <input
          placeholder="Task title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          style={{ display: 'block', width: '100%', marginBottom: 8, padding: 8 }}
        />
        <textarea
          placeholder="Input text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          required
          rows={4}
          style={{ display: 'block', width: '100%', marginBottom: 8, padding: 8 }}
        />
        <select
          value={operationType}
          onChange={(e) => setOperationType(e.target.value)}
          style={{ display: 'block', marginBottom: 8, padding: 8 }}
        >
          {OPERATIONS.map((op) => (
            <option key={op} value={op}>
              {op}
            </option>
          ))}
        </select>
        {error && <p style={{ color: 'red' }}>{error}</p>}
        <button type="submit" disabled={creating}>
          {creating ? 'Running...' : 'Run task'}
        </button>
      </form>

      <h3>Tasks</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #333' }}>
            <th>Title</th>
            <th>Operation</th>
            <th>Status</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t._id} style={{ borderBottom: '1px solid #eee' }}>
              <td>{t.title}</td>
              <td>{t.operationType}</td>
              <td style={{ color: STATUS_COLORS[t.status] || '#000', fontWeight: 600 }}>{t.status}</td>
              <td>{t.result || t.error || '-'}</td>
            </tr>
          ))}
          {tasks.length === 0 && (
            <tr>
              <td colSpan={4} style={{ padding: 12, color: '#777' }}>
                No tasks yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
