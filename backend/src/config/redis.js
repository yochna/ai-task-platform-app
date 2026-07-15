const { createClient } = require('redis');

let client;

async function getRedisClient() {
  if (client && client.isOpen) return client;

  client = createClient({ url: process.env.REDIS_URL });

  client.on('error', (err) => console.error('[redis] Client error:', err.message));
  client.on('connect', () => console.log('[redis] Connected'));

  await client.connect();
  return client;
}

module.exports = getRedisClient;
