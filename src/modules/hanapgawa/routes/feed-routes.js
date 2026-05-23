const express = require('express');

const { asyncHandler }        = require('../../../lib/async-handler');
const { HttpError }           = require('../../../lib/http-error');
const { hanapgawaAuth }       = require('../../../middleware/hanapgawa-auth.middleware');
const { hanapgawaOptionalAuth } = require('../../../middleware/hanapgawa-auth.middleware');
const { getHanapgawaPool }    = require('../../../database/hanapgawa-postgres');
const { getMongoDb }          = require('../../../database/mongodb');
const { createNotification }  = require('../../../lib/notifications');
const {
  ensureFeedSchema,
  getPublicFeed,
  getUserTimeline,
} = require('../services/feed-service');
const { ObjectId } = require('mongodb');

const router = express.Router();

const VALID_TYPES = new Set(['listing', 'job', 'review', 'post']);

// ─── GET /feed/post/:id — single post deep-link (MongoDB) ────────────────────

router.get(
  '/post/:id',
  asyncHandler(async (req, res) => {
    const db = getMongoDb();
    if (!db) return res.status(404).json({ error: 'Not found' });

    if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: 'Not found' });

    const doc = await db.collection('social_posts').findOne({
      _id: new ObjectId(req.params.id),
      status: 'active',
    });
    if (!doc) return res.status(404).json({ error: 'Post not found' });

    const postId = doc._id.toString();
    res.json({
      item: {
        id: postId,
        type: 'post',
        createdAt: doc.createdAt,
        likeCount: doc.likeCount || 0,
        commentCount: doc.commentCount || 0,
        isLiked: false,
        socialPost: {
          id:         postId,
          userId:     doc.userId,
          fullName:   doc.fullName   || 'User',
          profilePic: doc.profilePic || null,
          body:       doc.content    || '',
          image:      doc.media?.[0] || null,
          video:      null,
          metadata:   doc.metadata   || {},
          privacy:    doc.privacy    || 'Public',
          createdAt:  doc.createdAt,
        },
      },
    });
  }),
);

// ─── GET /feed ─────────────────────────────────────────────────────────────────

router.get(
  '/',
  hanapgawaOptionalAuth,
  asyncHandler(async (req, res) => {
    const limit  = Math.min(parseInt(req.query.limit) || 40, 80);
    const userId = req.auth?.sub || null;
    const items  = await getPublicFeed({ limit, userId });
    res.json({ items });
  }),
);

// ─── GET /feed/timeline ────────────────────────────────────────────────────────

router.get(
  '/timeline',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const limit  = Math.min(parseInt(req.query.limit) || 50, 100);
    const events = await getUserTimeline({ userId: req.auth.sub, role: req.auth.role, limit });
    res.json({ events });
  }),
);

// ─── POST /feed/:itemType/:itemId/like — toggle like ─────────────────────────

router.post(
  '/:itemType/:itemId/like',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const { itemType, itemId } = req.params;
    if (!VALID_TYPES.has(itemType)) throw new HttpError(400, 'Invalid item type.');

    const pool = getHanapgawaPool();
    if (!pool) throw new HttpError(503, 'Database unavailable.');
    await ensureFeedSchema();

    const existing = await pool.query(
      `SELECT 1 FROM feed_reactions WHERE user_id = $1 AND item_type = $2 AND item_id = $3`,
      [req.auth.sub, itemType, itemId],
    );

    if (existing.rows.length > 0) {
      await pool.query(
        `DELETE FROM feed_reactions WHERE user_id = $1 AND item_type = $2 AND item_id = $3`,
        [req.auth.sub, itemType, itemId],
      );
    } else {
      await pool.query(
        `INSERT INTO feed_reactions (user_id, item_type, item_id)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [req.auth.sub, itemType, itemId],
      );
    }

    const count = await pool.query(
      `SELECT COUNT(*)::int AS count FROM feed_reactions WHERE item_type = $1 AND item_id = $2`,
      [itemType, itemId],
    );

    res.json({ liked: existing.rows.length === 0, likeCount: count.rows[0].count });
  }),
);

// ─── GET /feed/:itemType/:itemId/like-status ──────────────────────────────────

router.get(
  '/:itemType/:itemId/like-status',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const { itemType, itemId } = req.params;
    if (!VALID_TYPES.has(itemType)) throw new HttpError(400, 'Invalid item type.');

    const pool = getHanapgawaPool();
    if (!pool) return res.json({ isLiked: false });
    await ensureFeedSchema();

    const result = await pool.query(
      `SELECT 1 FROM feed_reactions WHERE user_id = $1 AND item_type = $2 AND item_id = $3`,
      [req.auth.sub, itemType, itemId],
    );
    res.json({ isLiked: result.rows.length > 0 });
  }),
);

// ─── GET /feed/:itemType/:itemId/likers ───────────────────────────────────────

router.get(
  '/:itemType/:itemId/likers',
  asyncHandler(async (req, res) => {
    const { itemType, itemId } = req.params;
    if (!VALID_TYPES.has(itemType)) throw new HttpError(400, 'Invalid item type.');

    const pool = getHanapgawaPool();
    if (!pool) return res.json({ likers: [] });
    await ensureFeedSchema();

    const result = await pool.query(
      `SELECT u.id AS "userId", u.full_name AS "fullName"
       FROM feed_reactions fr
       JOIN users u ON u.id = fr.user_id
       WHERE fr.item_type = $1 AND fr.item_id = $2
       ORDER BY fr.created_at DESC
       LIMIT 50`,
      [itemType, itemId],
    );
    res.json({ likers: result.rows });
  }),
);

// ─── GET /feed/:itemType/:itemId/comments ─────────────────────────────────────

router.get(
  '/:itemType/:itemId/comments',
  hanapgawaOptionalAuth,
  asyncHandler(async (req, res) => {
    const { itemType, itemId } = req.params;
    if (!VALID_TYPES.has(itemType)) throw new HttpError(400, 'Invalid item type.');

    const pool   = getHanapgawaPool();
    if (!pool) return res.json({ comments: [] });
    await ensureFeedSchema();

    const userId = req.auth?.sub || null;

    const result = await pool.query(
      `SELECT
         c.id,
         c.user_id           AS "userId",
         c.full_name         AS "fullName",
         c.parent_comment_id AS "parentCommentId",
         c.body,
         c.gif_url           AS "gifUrl",
         c.created_at        AS "createdAt",
         c.updated_at        AS "updatedAt",
         COUNT(cr.user_id)::int AS "reactionCount",
         EXISTS (
           SELECT 1 FROM feed_comment_reactions mine
           WHERE mine.comment_id = c.id AND mine.user_id = $3
         ) AS "isReacted"
       FROM feed_comments c
       LEFT JOIN feed_comment_reactions cr ON cr.comment_id = c.id
       WHERE c.item_type = $1 AND c.item_id = $2
       GROUP BY c.id
       ORDER BY c.created_at ASC
       LIMIT 200`,
      [itemType, itemId, userId],
    );
    res.json({ comments: result.rows });
  }),
);

// ─── POST /feed/:itemType/:itemId/comments ────────────────────────────────────

router.post(
  '/:itemType/:itemId/comments',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const { itemType, itemId } = req.params;
    if (!VALID_TYPES.has(itemType)) throw new HttpError(400, 'Invalid item type.');

    const body   = (req.body.body || '').toString().trim();
    const gifUrl = req.body.gifUrl ? req.body.gifUrl.toString() : null;
    if (!body && !gifUrl) throw new HttpError(400, 'Comment body is required.');
    if (body.length > 1000) throw new HttpError(400, 'Comment too long.');

    const parentCommentId = req.body.parentCommentId
      ? req.body.parentCommentId.toString()
      : null;

    const pool = getHanapgawaPool();
    if (!pool) throw new HttpError(503, 'Database unavailable.');
    await ensureFeedSchema();

    if (parentCommentId) {
      const parent = await pool.query(
        `SELECT id FROM feed_comments WHERE id = $1 AND item_type = $2 AND item_id = $3`,
        [parentCommentId, itemType, itemId],
      );
      if (!parent.rows.length) throw new HttpError(404, 'Parent comment not found.');
    }

    const userResult = await pool.query(
      `SELECT full_name FROM users WHERE id = $1`,
      [req.auth.sub],
    );
    const fullName = userResult.rows[0]?.full_name || 'User';

    const result = await pool.query(
      `INSERT INTO feed_comments
         (user_id, full_name, item_type, item_id, body, parent_comment_id, gif_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING
         id,
         user_id           AS "userId",
         full_name         AS "fullName",
         parent_comment_id AS "parentCommentId",
         body, gif_url     AS "gifUrl",
         created_at        AS "createdAt"`,
      [req.auth.sub, fullName, itemType, itemId, body, parentCommentId, gifUrl],
    );

    // Non-fatal: notify post author if commenting on a MongoDB social post
    if (itemType === 'post') {
      (async () => {
        try {
          const db = getMongoDb();
          if (!db || !ObjectId.isValid(itemId)) return;
          const post = await db.collection('social_posts')
            .findOne({ _id: new ObjectId(itemId) }, { projection: { userId: 1 } });
          if (post && post.userId && post.userId !== req.auth.sub) {
            await createNotification(pool, {
              userId:    post.userId,
              actorId:   req.auth.sub,
              actorName: fullName,
              type:      'comment',
              title:     `${fullName} commented on your post`,
              body:      body.slice(0, 100),
              linkType:  'post',
              linkId:    itemId,
            });
          }
        } catch { /* non-fatal */ }
      })();
    }

    res.json({ comment: result.rows[0] });
  }),
);

// ─── PATCH /feed/comments/:commentId ─────────────────────────────────────────

router.patch(
  '/comments/:commentId',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const body = (req.body.body || '').toString().trim();
    if (!body) throw new HttpError(400, 'Comment body is required.');
    if (body.length > 1000) throw new HttpError(400, 'Comment too long.');

    const pool = getHanapgawaPool();
    if (!pool) throw new HttpError(503, 'Database unavailable.');
    await ensureFeedSchema();

    const result = await pool.query(
      `UPDATE feed_comments
       SET body = $1, updated_at = NOW()
       WHERE id = $2 AND user_id = $3
       RETURNING
         id,
         user_id           AS "userId",
         full_name         AS "fullName",
         parent_comment_id AS "parentCommentId",
         body, gif_url     AS "gifUrl",
         created_at        AS "createdAt",
         updated_at        AS "updatedAt"`,
      [body, req.params.commentId, req.auth.sub],
    );
    if (!result.rows.length) throw new HttpError(404, 'Comment not found or not yours.');
    res.json({ comment: { ...result.rows[0], reactionCount: 0, isReacted: false } });
  }),
);

// ─── DELETE /feed/comments/:commentId ────────────────────────────────────────

router.delete(
  '/comments/:commentId',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const pool = getHanapgawaPool();
    if (!pool) throw new HttpError(503, 'Database unavailable.');
    await ensureFeedSchema();

    const owned = await pool.query(
      `SELECT id FROM feed_comments WHERE id = $1 AND user_id = $2`,
      [req.params.commentId, req.auth.sub],
    );
    if (!owned.rows.length) throw new HttpError(404, 'Comment not found or not yours.');

    // Cascade-delete the thread (CTE recursive delete)
    await pool.query(
      `WITH RECURSIVE thread AS (
         SELECT id FROM feed_comments WHERE id = $1
         UNION ALL
         SELECT c.id FROM feed_comments c
         INNER JOIN thread t ON c.parent_comment_id = t.id
       )
       DELETE FROM feed_comments WHERE id IN (SELECT id FROM thread)`,
      [req.params.commentId],
    );
    res.json({ deleted: true });
  }),
);

// ─── POST /feed/comments/:commentId/reaction ──────────────────────────────────

router.post(
  '/comments/:commentId/reaction',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const pool = getHanapgawaPool();
    if (!pool) throw new HttpError(503, 'Database unavailable.');
    await ensureFeedSchema();

    const existing = await pool.query(
      `SELECT 1 FROM feed_comment_reactions WHERE user_id = $1 AND comment_id = $2`,
      [req.auth.sub, req.params.commentId],
    );

    if (existing.rows.length > 0) {
      await pool.query(
        `DELETE FROM feed_comment_reactions WHERE user_id = $1 AND comment_id = $2`,
        [req.auth.sub, req.params.commentId],
      );
    } else {
      await pool.query(
        `INSERT INTO feed_comment_reactions (user_id, comment_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [req.auth.sub, req.params.commentId],
      );
    }

    const count = await pool.query(
      `SELECT COUNT(*)::int AS count FROM feed_comment_reactions WHERE comment_id = $1`,
      [req.params.commentId],
    );
    res.json({ reacted: existing.rows.length === 0, reactionCount: count.rows[0].count });
  }),
);

module.exports = { feedRoutes: router };
