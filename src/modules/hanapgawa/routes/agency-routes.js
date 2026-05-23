const express = require('express');
const { z } = require('zod');

const { asyncHandler }  = require('../../../lib/async-handler');
const { HttpError }     = require('../../../lib/http-error');
const { hanapgawaAuth } = require('../../../middleware/hanapgawa-auth.middleware');
const { getHanapgawaPool } = require('../../../database/hanapgawa-postgres');
const { findUserById }  = require('../repositories/user-repository');

const router = express.Router();

// ─── Schema bootstrap ─────────────────────────────────────────────────────────

let schemaReady = false;

async function ensureAgencySchema() {
  if (schemaReady) return;
  const pool = getHanapgawaPool();
  if (!pool) { schemaReady = true; return; }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agency_worker_applications (
      id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      agency_user_id UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      worker_user_id UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status         TEXT        NOT NULL DEFAULT 'pending',
      message        TEXT        NOT NULL DEFAULT '',
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (agency_user_id, worker_user_id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_agency_apps_agency
      ON agency_worker_applications(agency_user_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_agency_apps_worker
      ON agency_worker_applications(worker_user_id, created_at DESC)
  `);

  schemaReady = true;
}

const applicationReturning = `
  id,
  agency_user_id AS "agencyUserId",
  worker_user_id AS "workerUserId",
  status, message,
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

// ─── POST /agency/applications — agency invites a worker ──────────────────────

router.post(
  '/applications',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    if (req.auth.role !== 'agency') throw new HttpError(403, 'Only agency accounts can send applications.');

    const payload = z.object({
      workerUserId: z.string().uuid(),
      message:      z.string().max(1000).optional().default(''),
    }).safeParse(req.body);
    if (!payload.success) throw new HttpError(400, 'Invalid agency application payload.', payload.error.flatten());

    const worker = await findUserById(payload.data.workerUserId);
    if (!worker || worker.role !== 'worker') throw new HttpError(404, 'Worker account not found.');

    const pool = getHanapgawaPool();
    if (!pool) throw new HttpError(503, 'Database unavailable.');
    await ensureAgencySchema();

    const result = await pool.query(
      `INSERT INTO agency_worker_applications (agency_user_id, worker_user_id, status, message)
       VALUES ($1, $2, 'pending', $3)
       ON CONFLICT (agency_user_id, worker_user_id)
       DO UPDATE SET status = 'pending', message = EXCLUDED.message, updated_at = NOW()
       RETURNING ${applicationReturning}`,
      [req.auth.sub, payload.data.workerUserId, payload.data.message],
    );

    res.status(201).json({ application: result.rows[0] });
  }),
);

// ─── GET /agency/applications/mine — list own applications ────────────────────

router.get(
  '/applications/mine',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    if (!['agency', 'worker'].includes(req.auth.role)) {
      throw new HttpError(403, 'Only agency and worker accounts can view applications.');
    }

    const pool = getHanapgawaPool();
    if (!pool) return res.json({ applications: [] });
    await ensureAgencySchema();

    const conditions = [];
    const values     = [];

    if (req.auth.role === 'agency') {
      values.push(req.auth.sub);
      conditions.push(`agency_user_id = $${values.length}`);
    } else {
      values.push(req.auth.sub);
      conditions.push(`worker_user_id = $${values.length}`);
    }

    if (req.query.status) {
      values.push(String(req.query.status));
      conditions.push(`status = $${values.length}`);
    }

    const where  = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query(
      `SELECT ${applicationReturning}
       FROM agency_worker_applications
       ${where}
       ORDER BY created_at DESC`,
      values,
    );

    res.json({ applications: result.rows });
  }),
);

// ─── PATCH /agency/applications/:applicationId — worker responds ───────────────

router.patch(
  '/applications/:applicationId',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    if (req.auth.role !== 'worker' && req.auth.role !== 'admin') {
      throw new HttpError(403, 'Only the target worker can respond to an application.');
    }

    const applicationId = z.string().uuid().safeParse(req.params.applicationId);
    if (!applicationId.success) throw new HttpError(400, 'Invalid application id.');

    const payload = z.object({
      status: z.enum(['approved', 'rejected', 'withdrawn']),
    }).safeParse(req.body);
    if (!payload.success) throw new HttpError(400, 'Invalid application update payload.', payload.error.flatten());

    const pool = getHanapgawaPool();
    if (!pool) throw new HttpError(503, 'Database unavailable.');
    await ensureAgencySchema();

    const found = await pool.query(
      `SELECT id, worker_user_id AS "workerUserId" FROM agency_worker_applications WHERE id = $1`,
      [applicationId.data],
    );
    if (!found.rows[0]) throw new HttpError(404, 'Application not found.');
    if (req.auth.role !== 'admin' && found.rows[0].workerUserId !== req.auth.sub) {
      throw new HttpError(403, 'You can only manage applications sent to your worker account.');
    }

    const result = await pool.query(
      `UPDATE agency_worker_applications
       SET status = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING ${applicationReturning}`,
      [applicationId.data, payload.data.status],
    );

    res.json({ application: result.rows[0] });
  }),
);

// ─── GET /agency/memberships/:agencyUserId — list approved workers ────────────

router.get(
  '/memberships/:agencyUserId',
  asyncHandler(async (req, res) => {
    const agencyUserId = z.string().uuid().safeParse(req.params.agencyUserId);
    if (!agencyUserId.success) throw new HttpError(400, 'Invalid agency user id.');

    const pool = getHanapgawaPool();
    if (!pool) return res.json({ memberships: [] });
    await ensureAgencySchema();

    const result = await pool.query(
      `SELECT
         a.id,
         a.agency_user_id AS "agencyUserId",
         a.worker_user_id AS "workerUserId",
         u.full_name      AS "workerFullName",
         a.status, a.message,
         a.created_at     AS "createdAt",
         a.updated_at     AS "updatedAt"
       FROM agency_worker_applications a
       JOIN users u ON u.id = a.worker_user_id
       WHERE a.agency_user_id = $1 AND a.status = 'approved'
       ORDER BY a.created_at DESC`,
      [agencyUserId.data],
    );

    res.json({ memberships: result.rows });
  }),
);

module.exports = { agencyRoutes: router };
