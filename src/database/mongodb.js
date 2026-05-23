const { MongoClient } = require('mongodb');
const env = require('../config/env');

let client = null;
let db = null;

async function initMongo() {
  if (!env.MONGODB_URL) {
    console.warn('[MongoDB] MONGODB_URL not set — MongoDB skipped.');
    return;
  }

  try {
    client = new MongoClient(env.MONGODB_URL, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
    });
    await client.connect();
    db = client.db(env.MONGODB_DB_NAME || 'hanapgawa');
    await db.command({ ping: 1 });
    console.log('[MongoDB] Connected successfully.');
  } catch (err) {
    console.error('[MongoDB] Connection failed (non-fatal):', err.message);
    client = null;
    db = null;
  }
}

function getMongoDb() {
  return db;
}

async function closeMongo() {
  if (client) {
    try {
      await client.close();
      console.log('[MongoDB] Connection closed.');
    } catch { /* already closed */ }
    client = null;
    db = null;
  }
}

module.exports = { initMongo, getMongoDb, closeMongo };
