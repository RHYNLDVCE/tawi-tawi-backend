const { Pool } = require("pg");
const env = require("../config/env");

let pool = null;

function getHanapgawaPool() {
  return pool;
}

async function initHanapgawaDb() {
  if (!env.HANAPGAWA_POSTGRES_URL) {
    console.warn("[HanapGawa] HANAPGAWA_POSTGRES_URL not set — PostgreSQL skipped.");
    return;
  }

  try {
    pool = new Pool({
      connectionString: env.HANAPGAWA_POSTGRES_URL,
      ssl: env.HANAPGAWA_POSTGRES_SSL ? { rejectUnauthorized: false } : false,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
      console.log("[HanapGawa] PostgreSQL connected successfully.");
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("[HanapGawa] PostgreSQL connection failed:", err.message);
    pool = null; // routes will return 503 gracefully — server keeps running
  }
}

async function closeHanapgawaDb() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log("[HanapGawa] PostgreSQL connection closed.");
  }
}

module.exports = { getHanapgawaPool, initHanapgawaDb, closeHanapgawaDb };
