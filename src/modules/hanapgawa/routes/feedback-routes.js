const express = require('express');
const { z } = require('zod');

const { asyncHandler }  = require('../../../lib/async-handler');
const { HttpError }     = require('../../../lib/http-error');
const { hanapgawaAuth } = require('../../../middleware/hanapgawa-auth.middleware');
const { getHanapgawaPool } = require('../../../database/hanapgawa-postgres');

const router = express.Router();

let schemaReady = false;

async function ensureFeedbackSchema() {
  if (schemaReady) return;
  const pool = getHanapgawaPool();
  if (!pool) { schemaReady = true; return; }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_feedback (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      rating      INT         NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment     TEXT        NOT NULL DEFAULT '',
      app_version TEXT        NOT NULL DEFAULT '',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  schemaReady = true;
}

// POST /feedback — auth required to prevent spam
router.post(
  '/',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const parsed = z.object({
      rating:     z.number().int().min(1).max(5),
      comment:    z.string().max(1000).default(''),
      appVersion: z.string().max(20).default(''),
    }).safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, 'Invalid feedback data.');

    const { rating, comment, appVersion } = parsed.data;
    const pool = getHanapgawaPool();
    if (!pool) return res.json({ ok: true });
    await ensureFeedbackSchema();

    await pool.query(
      `INSERT INTO app_feedback (rating, comment, app_version) VALUES ($1, $2, $3)`,
      [rating, comment.trim(), appVersion],
    );
    res.json({ ok: true });
  }),
);

// GET /feedback — admin only
router.get(
  '/',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    if (req.auth.role !== 'admin') throw new HttpError(403, 'Admin access required.');

    const pool = getHanapgawaPool();
    if (!pool) return res.json({ feedback: [], total: 0, average: 0, distribution: [] });
    await ensureFeedbackSchema();

    const result = await pool.query(
      `SELECT id, rating, comment, app_version AS "appVersion", created_at AS "createdAt"
       FROM app_feedback
       ORDER BY created_at DESC
       LIMIT 200`,
    );

    const rows  = result.rows;
    const total = rows.length;
    const avg   = total > 0
      ? (rows.reduce((s, r) => s + r.rating, 0) / total).toFixed(1)
      : '0.0';
    const distribution = [1, 2, 3, 4, 5].map((star) => ({
      star,
      count: rows.filter((r) => r.rating === star).length,
    }));

    res.json({ feedback: rows, total, average: parseFloat(avg), distribution });
  }),
);

module.exports = { feedbackRoutes: router };
