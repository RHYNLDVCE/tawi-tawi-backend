const express = require('express');

const { asyncHandler } = require('../../../lib/async-handler');
const { HttpError } = require('../../../lib/http-error');
const { hanapgawaAuth } = require('../../../middleware/hanapgawa-auth.middleware');
const { hanapgawaOptionalAuth } = require('../../../middleware/hanapgawa-auth.middleware');
const { getHanapgawaPool } = require('../../../database/hanapgawa-postgres');

const router = express.Router();

// ─── Schema bootstrap ─────────────────────────────────────────────────────────

let schemaReady = false;

async function ensureStorySchema() {
  if (schemaReady) return;
  const pool = getHanapgawaPool();
  if (!pool) { schemaReady = true; return; }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS stories (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      full_name   TEXT        NOT NULL DEFAULT '',
      profile_pic TEXT,
      body        TEXT        NOT NULL DEFAULT '',
      image       TEXT,
      video       TEXT,
      metadata    JSONB       NOT NULL DEFAULT '{}',
      privacy     TEXT        NOT NULL DEFAULT 'Public',
      expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_stories_expires ON stories(expires_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_stories_user ON stories(user_id, created_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS story_views (
      story_id   UUID        NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      user_id    UUID        NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (story_id, user_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS story_reactions (
      story_id   UUID        NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      user_id    UUID        NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
      reaction   TEXT        NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (story_id, user_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS featured_stories (
      id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id             UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      story_id            UUID        NOT NULL,
      body                TEXT        NOT NULL DEFAULT '',
      image               TEXT,
      video               TEXT,
      metadata            JSONB       NOT NULL DEFAULT '{}',
      full_name           TEXT        NOT NULL DEFAULT '',
      profile_pic         TEXT,
      original_created_at TIMESTAMPTZ,
      featured_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, story_id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_featured_stories_user ON featured_stories(user_id, featured_at DESC)
  `);

  schemaReady = true;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /stories — public feed of active stories
router.get(
  '/',
  hanapgawaOptionalAuth,
  asyncHandler(async (req, res) => {
    const pool = getHanapgawaPool();
    if (!pool) return res.json({ stories: [] });
    await ensureStorySchema();

    const viewerId = req.auth?.sub || null;

    const result = await pool.query(
      `
        SELECT
          s.id,
          s.user_id      AS "userId",
          s.full_name    AS "fullName",
          s.profile_pic  AS "profilePic",
          s.body, s.image, s.video, s.metadata, s.privacy,
          s.expires_at   AS "expiresAt",
          s.created_at   AS "createdAt",
          CASE
            WHEN s.user_id = $1            THEN TRUE
            WHEN sv.user_id IS NOT NULL     THEN TRUE
            ELSE FALSE
          END AS "viewedByMe"
        FROM stories s
        LEFT JOIN story_views sv ON sv.story_id = s.id AND sv.user_id = $1
        WHERE s.expires_at > NOW() AND s.privacy = 'Public'
        ORDER BY s.created_at DESC
        LIMIT 50
      `,
      [viewerId],
    );

    res.json({ stories: result.rows });
  }),
);

// GET /stories/featured/:userId — public
router.get(
  '/featured/:userId',
  asyncHandler(async (req, res) => {
    const pool = getHanapgawaPool();
    if (!pool) return res.json({ featuredStories: [] });
    await ensureStorySchema();

    const result = await pool.query(
      `
        SELECT
          id,
          user_id             AS "userId",
          story_id            AS "storyId",
          body, image, video, metadata,
          full_name           AS "fullName",
          profile_pic         AS "profilePic",
          original_created_at AS "originalCreatedAt",
          featured_at         AS "featuredAt"
        FROM featured_stories
        WHERE user_id = $1
        ORDER BY featured_at DESC
      `,
      [req.params.userId],
    );

    res.json({ featuredStories: result.rows });
  }),
);

// POST /stories — create a story (auth required)
router.post(
  '/',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const pool = getHanapgawaPool();
    if (!pool) throw new HttpError(503, 'Database unavailable.');
    await ensureStorySchema();

    const body     = (req.body.body  || '').toString().trim();
    const image    = req.body.image  ? req.body.image.toString()  : null;
    const video    = req.body.video  ? req.body.video.toString()  : null;
    const metadata = req.body.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {};
    const privacy  = req.body.privacy ? req.body.privacy.toString() : 'Public';

    if (!body && !image && !video && Object.keys(metadata).length === 0) {
      throw new HttpError(400, 'Story content is required.');
    }

    const userRow = await pool.query(
      `SELECT full_name FROM users WHERE id = $1`,
      [req.auth.sub],
    );
    const fullName = userRow.rows[0]?.full_name || 'User';

    const result = await pool.query(
      `
        INSERT INTO stories (user_id, full_name, body, image, video, metadata, privacy)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING
          id,
          user_id     AS "userId",
          full_name   AS "fullName",
          profile_pic AS "profilePic",
          body, image, video, metadata, privacy,
          expires_at  AS "expiresAt",
          created_at  AS "createdAt"
      `,
      [req.auth.sub, fullName, body, image, video, JSON.stringify(metadata), privacy],
    );

    res.status(201).json({ story: result.rows[0] });
  }),
);

// POST /stories/:storyId/view — record a view (auth required)
router.post(
  '/:storyId/view',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const pool = getHanapgawaPool();
    if (!pool) throw new HttpError(503, 'Database unavailable.');
    await ensureStorySchema();

    await pool.query(
      `INSERT INTO story_views (story_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.params.storyId, req.auth.sub],
    );

    res.json({ viewed: true });
  }),
);

// POST /stories/:storyId/react — upsert reaction (auth required)
router.post(
  '/:storyId/react',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const reaction = (req.body.reaction || '').toString().trim();
    if (!reaction) throw new HttpError(400, 'Reaction is required.');

    const pool = getHanapgawaPool();
    if (!pool) throw new HttpError(503, 'Database unavailable.');
    await ensureStorySchema();

    await pool.query(
      `
        INSERT INTO story_reactions (story_id, user_id, reaction)
        VALUES ($1, $2, $3)
        ON CONFLICT (story_id, user_id)
        DO UPDATE SET reaction = EXCLUDED.reaction, created_at = NOW()
      `,
      [req.params.storyId, req.auth.sub, reaction],
    );

    res.json({ reacted: true });
  }),
);

// POST /stories/:storyId/feature — pin story to profile (owner only)
router.post(
  '/:storyId/feature',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const pool = getHanapgawaPool();
    if (!pool) throw new HttpError(503, 'Database unavailable.');
    await ensureStorySchema();

    const story = await pool.query(
      `SELECT id, user_id, full_name, profile_pic, body, image, video, metadata, created_at
       FROM stories WHERE id = $1`,
      [req.params.storyId],
    );
    if (!story.rows[0]) throw new HttpError(404, 'Story not found.');
    if (story.rows[0].user_id !== req.auth.sub) throw new HttpError(403, 'Only the story owner can feature this story.');

    const s = story.rows[0];
    await pool.query(
      `
        INSERT INTO featured_stories
          (user_id, story_id, body, image, video, metadata, full_name, profile_pic, original_created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (user_id, story_id) DO NOTHING
      `,
      [req.auth.sub, s.id, s.body, s.image, s.video, JSON.stringify(s.metadata), s.full_name, s.profile_pic, s.created_at],
    );

    res.json({ featured: true });
  }),
);

// DELETE /stories/:storyId/feature — unfeature a story (owner only)
router.delete(
  '/:storyId/feature',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const pool = getHanapgawaPool();
    if (!pool) throw new HttpError(503, 'Database unavailable.');
    await ensureStorySchema();

    await pool.query(
      `DELETE FROM featured_stories WHERE story_id = $1 AND user_id = $2`,
      [req.params.storyId, req.auth.sub],
    );

    res.json({ unfeatured: true });
  }),
);

// DELETE /stories/featured/:featuredId — remove a featured story by its own id
router.delete(
  '/featured/:featuredId',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const pool = getHanapgawaPool();
    if (!pool) throw new HttpError(503, 'Database unavailable.');
    await ensureStorySchema();

    const result = await pool.query(
      `DELETE FROM featured_stories WHERE id = $1 AND user_id = $2 RETURNING id`,
      [req.params.featuredId, req.auth.sub],
    );
    if (!result.rows.length) throw new HttpError(404, 'Featured story not found or not yours.');

    res.json({ deleted: true });
  }),
);

// GET /stories/:storyId/viewers — owner only
router.get(
  '/:storyId/viewers',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const pool = getHanapgawaPool();
    if (!pool) throw new HttpError(503, 'Database unavailable.');
    await ensureStorySchema();

    const story = await pool.query(
      `SELECT user_id FROM stories WHERE id = $1`,
      [req.params.storyId],
    );
    if (!story.rows[0]) throw new HttpError(404, 'Story not found.');
    if (story.rows[0].user_id !== req.auth.sub) {
      throw new HttpError(403, 'Only the story owner can view story viewers.');
    }

    const result = await pool.query(
      `
        SELECT
          sv.user_id    AS "userId",
          u.full_name   AS "fullName",
          sv.created_at AS "viewedAt",
          sr.reaction
        FROM story_views sv
        JOIN  users u  ON u.id  = sv.user_id
        LEFT  JOIN story_reactions sr
          ON  sr.story_id = sv.story_id AND sr.user_id = sv.user_id
        WHERE sv.story_id = $1 AND sv.user_id != $2
        ORDER BY sv.created_at DESC
      `,
      [req.params.storyId, req.auth.sub],
    );

    res.json({ viewers: result.rows });
  }),
);

// DELETE /stories/:storyId — owner deletes own story (cascades views + reactions)
router.delete(
  '/:storyId',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const pool = getHanapgawaPool();
    if (!pool) throw new HttpError(503, 'Database unavailable.');
    await ensureStorySchema();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const story = await client.query(
        `SELECT id FROM stories WHERE id = $1 AND user_id = $2`,
        [req.params.storyId, req.auth.sub],
      );
      if (!story.rows[0]) throw new HttpError(404, 'Story not found or not yours.');

      await client.query(`DELETE FROM story_reactions WHERE story_id = $1`, [req.params.storyId]);
      await client.query(`DELETE FROM story_views     WHERE story_id = $1`, [req.params.storyId]);
      await client.query(`DELETE FROM stories          WHERE id       = $1`, [req.params.storyId]);

      await client.query('COMMIT');
      res.json({ deleted: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }),
);

module.exports = { storyRoutes: router };
