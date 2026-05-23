const { getRedisClient } = require('../../../database/redis');

/**
 * Try to read a cached value.
 * Returns parsed object on HIT, null on MISS or if Redis is down.
 */
async function safeGet(key) {
  try {
    const redis = getRedisClient();
    if (!redis) return null;
    const raw = await redis.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Write a value to cache with a TTL (seconds).
 * Fire-and-forget — never blocks the caller, never throws.
 */
function safeSet(key, ttl, data) {
  try {
    const redis = getRedisClient();
    if (!redis) return;
    redis.setEx(key, ttl, JSON.stringify(data)).catch(() => {});
  } catch { /* Redis down — ignore */ }
}

/**
 * Delete one or more cache keys.
 * Fire-and-forget — never throws.
 */
function safeDel(...keys) {
  try {
    const redis = getRedisClient();
    if (!redis || !keys.length) return;
    redis.del(keys).catch(() => {});
  } catch { /* Redis down — ignore */ }
}

/**
 * Delete all keys matching a pattern (e.g. 'listings:search:*').
 * Uses SCAN to avoid blocking Redis with KEYS on large datasets.
 * Fire-and-forget — never throws.
 */
async function safeDelPattern(pattern) {
  try {
    const redis = getRedisClient();
    if (!redis) return;
    const keys = [];
    for await (const key of redis.scanIterator({ MATCH: pattern, COUNT: 100 })) {
      keys.push(key);
    }
    if (keys.length) await redis.del(keys).catch(() => {});
  } catch { /* Redis down — ignore */ }
}

module.exports = { safeGet, safeSet, safeDel, safeDelPattern };
