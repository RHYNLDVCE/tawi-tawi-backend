const { createClient } = require('redis');
const env = require('../config/env');

let client = null;

async function initRedis() {
  if (!env.REDIS_URL) {
    console.warn('[Redis] REDIS_URL not set — Redis skipped.');
    return;
  }

  try {
    client = createClient({ url: env.REDIS_URL });

    // Swallow all errors silently — Redis is non-critical
    client.on('error', (err) => {
      console.warn('[Redis] Client error (non-fatal):', err.message);
    });

    await client.connect();
    await client.ping();
    console.log('[Redis] Connected successfully.');
  } catch (err) {
    console.error('[Redis] Connection failed (non-fatal):', err.message);
    client = null;
  }
}

function getRedisClient() {
  if (!client || !client.isOpen) return null;
  return client;
}

async function closeRedis() {
  if (client) {
    try {
      if (client.isOpen) await client.quit();
      console.log('[Redis] Connection closed.');
    } catch { /* already closed */ }
    client = null;
  }
}

module.exports = { initRedis, getRedisClient, closeRedis };
