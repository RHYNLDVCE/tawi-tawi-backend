const express = require('express');

const { asyncHandler } = require('../../../lib/async-handler');
const { HttpError } = require('../../../lib/http-error');
const { hanapgawaAuth } = require('../../../middleware/hanapgawa-auth.middleware');
const { getHanapgawaPool } = require('../../../database/hanapgawa-postgres');
const { safeGet, safeSet, safeDel } = require('../cache/cache-client');
const { KEYS, TTL } = require('../cache/cache-keys');

const router = express.Router();

// GET /notifications/unread-count  — must be before /:id
router.get(
  '/unread-count',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const cacheKey = KEYS.notifUnreadCount(req.auth.sub);
    const cached = await safeGet(cacheKey);
    if (cached !== null) return res.json({ count: cached });

    const pool = getHanapgawaPool();
    if (!pool) return res.json({ count: 0 });

    const result = await pool.query(
      `SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
      [req.auth.sub],
    );

    const count = result.rows[0].count;
    safeSet(cacheKey, TTL.NOTIF_UNREAD_COUNT, count);
    res.json({ count });
  }),
);

// GET /notifications
router.get(
  '/',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const pool = getHanapgawaPool();
    if (!pool) return res.json({ notifications: [], total: 0 });

    const limit = Math.min(parseInt(req.query.limit) || 40, 100);

    const [listResult, countResult] = await Promise.all([
      pool.query(
        `SELECT id, actor_id AS "actorId", actor_name AS "actorName", type, title, body,
                link_type AS "linkType", link_id AS "linkId",
                read_at AS "readAt", created_at AS "createdAt"
         FROM notifications
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [req.auth.sub, limit],
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total FROM notifications WHERE user_id = $1`,
        [req.auth.sub],
      ),
    ]);

    res.json({ notifications: listResult.rows, total: countResult.rows[0].total });
  }),
);

// POST /notifications/read-all  — must be before /:id
router.post(
  '/read-all',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const pool = getHanapgawaPool();
    if (!pool) return res.json({ ok: true });

    await pool.query(
      `UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL`,
      [req.auth.sub],
    );

    safeDel(KEYS.notifUnreadCount(req.auth.sub));
    res.json({ ok: true });
  }),
);

// POST /notifications/:id/read
router.post(
  '/:id/read',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const pool = getHanapgawaPool();
    if (!pool) return res.json({ ok: true });

    const result = await pool.query(
      `UPDATE notifications SET read_at = NOW() WHERE id = $1 AND user_id = $2 AND read_at IS NULL
       RETURNING id`,
      [req.params.id, req.auth.sub],
    );

    if (!result.rows.length) {
      throw new HttpError(404, 'Notification not found or already read.');
    }

    safeDel(KEYS.notifUnreadCount(req.auth.sub));
    res.json({ ok: true });
  }),
);

module.exports = { notificationRoutes: router };
