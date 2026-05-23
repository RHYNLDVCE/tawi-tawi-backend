const { getHanapgawaPool } = require('../../../database/hanapgawa-postgres');
const { getMongoDb } = require('../../../database/mongodb');

// ─── Schema bootstrap ─────────────────────────────────────────────────────────

let schemaReady = false;

async function ensureFeedSchema() {
  if (schemaReady) return;
  const pool = getHanapgawaPool();
  if (!pool) { schemaReady = true; return; }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS feed_reactions (
      user_id   UUID  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      item_type TEXT  NOT NULL,
      item_id   TEXT  NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, item_type, item_id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_feed_reactions_item
      ON feed_reactions(item_type, item_id)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS feed_comments (
      id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      full_name         TEXT        NOT NULL DEFAULT '',
      item_type         TEXT        NOT NULL,
      item_id           TEXT        NOT NULL,
      body              TEXT        NOT NULL DEFAULT '',
      gif_url           TEXT,
      parent_comment_id UUID        REFERENCES feed_comments(id) ON DELETE CASCADE,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_feed_comments_item
      ON feed_comments(item_type, item_id, created_at ASC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS feed_comment_reactions (
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      comment_id UUID NOT NULL REFERENCES feed_comments(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, comment_id)
    )
  `);

  schemaReady = true;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getFollowedUserIds(userId) {
  if (!userId) return [];
  const pool = getHanapgawaPool();
  if (!pool) return [];
  try {
    const result = await pool.query(
      `SELECT following_user_id FROM follows WHERE follower_user_id = $1`,
      [userId],
    );
    return result.rows.map((r) => r.following_user_id);
  } catch { return []; }
}

async function attachInteractionCounts(items, userId = null) {
  if (!items.length) return;
  const pool = getHanapgawaPool();
  if (!pool) return;
  await ensureFeedSchema();

  try {
    const ids = items.map((i) => i.id.toString());

    const [likeResult, commentResult] = await Promise.all([
      pool.query(
        `SELECT item_type, item_id, COUNT(*)::int AS count
         FROM feed_reactions WHERE item_id = ANY($1)
         GROUP BY item_type, item_id`,
        [ids],
      ),
      pool.query(
        `SELECT item_type, item_id, COUNT(*)::int AS count
         FROM feed_comments WHERE item_id = ANY($1)
         GROUP BY item_type, item_id`,
        [ids],
      ),
    ]);

    const likeMap    = new Map(likeResult.rows.map((r)    => [`${r.item_type}:${r.item_id}`, r.count]));
    const commentMap = new Map(commentResult.rows.map((r) => [`${r.item_type}:${r.item_id}`, r.count]));

    let likedSet = new Set();
    if (userId && ids.length > 0) {
      const likedResult = await pool.query(
        `SELECT item_type, item_id FROM feed_reactions
         WHERE user_id = $1 AND item_id = ANY($2)`,
        [userId, ids],
      );
      likedSet = new Set(likedResult.rows.map((r) => `${r.item_type}:${r.item_id}`));
    }

    for (const item of items) {
      const key = `${item.type}:${item.id}`;
      item.likeCount    = likeMap.get(key)    || 0;
      item.commentCount = commentMap.get(key) || 0;
      item.isLiked      = likedSet.has(key);
    }
  } catch { /* counts default to 0 */ }
}

// ─── Public feed ──────────────────────────────────────────────────────────────

async function getPublicFeed({ limit = 40, userId = null } = {}) {
  const items     = [];
  const perSource = Math.ceil(limit / 3);

  const followedIds = await getFollowedUserIds(userId);

  // 1. Service listings (MongoDB)
  try {
    const db = getMongoDb();
    if (db) {
      let listings;
      if (followedIds.length > 0) {
        const [followedListings, generalListings] = await Promise.all([
          db.collection('service_listings')
            .find({ providerUserId: { $in: followedIds }, status: 'active' })
            .sort({ createdAt: -1 })
            .limit(10)
            .toArray(),
          db.collection('service_listings')
            .find({ status: 'active' })
            .sort({ createdAt: -1 })
            .limit(perSource)
            .toArray(),
        ]);
        const seen = new Set();
        listings = [];
        for (const l of [...followedListings, ...generalListings]) {
          const key = l._id.toString();
          if (!seen.has(key)) { seen.add(key); listings.push(l); }
        }
      } else {
        listings = await db.collection('service_listings')
          .find({ status: 'active' })
          .sort({ createdAt: -1 })
          .limit(perSource)
          .toArray();
      }

      const profileDocs = await db.collection('provider_profiles')
        .find({ providerUserId: { $in: listings.map((l) => l.providerUserId) } })
        .toArray();
      const profileMap = new Map(profileDocs.map((p) => [p.providerUserId, p]));

      for (const l of listings) {
        const profile = profileMap.get(l.providerUserId);
        items.push({
          type: 'listing',
          id: l._id.toString(),
          createdAt: l.createdAt,
          likeCount: 0,
          commentCount: 0,
          isLiked: false,
          listing: {
            id:                  l._id.toString(),
            providerUserId:      l.providerUserId,
            providerRole:        l.providerRole,
            providerDisplayName: profile?.displayName || 'Local Provider',
            title:               l.title,
            category:            l.category,
            municipality:        l.municipality,
            description:         l.description,
            priceMin:            l.priceMin,
            priceMax:            l.priceMax,
            estimatedDuration:   l.estimatedDuration,
            requirements:        l.requirements || [],
            availability:        l.availability || [],
            media:               l.media        || [],
          },
        });
      }
    }
  } catch { /* MongoDB unavailable */ }

  // 2. Social posts (MongoDB)
  try {
    const db = getMongoDb();
    if (db) {
      let query = { status: 'active' };
      if (followedIds.length > 0 && userId) {
        query = { status: 'active', userId: { $in: [...followedIds, userId] } };
      }
      const docs = await db.collection('social_posts')
        .find(query)
        .sort({ createdAt: -1 })
        .limit(perSource)
        .toArray();

      // Batch-load user names from PG
      const pool = getHanapgawaPool();
      const authorIds = [...new Set(docs.map((d) => d.userId))].filter(Boolean);
      const nameMap   = new Map();
      if (pool && authorIds.length > 0) {
        try {
          const ur = await pool.query(
            `SELECT id, full_name FROM users WHERE id = ANY($1)`,
            [authorIds],
          );
          for (const row of ur.rows) nameMap.set(row.id, row.full_name);
        } catch { /* ignore */ }
      }

      const followingSet = new Set(followedIds);

      for (const d of docs) {
        const postId = d._id.toString();
        items.push({
          type:              'post',
          id:                postId,
          createdAt:         d.createdAt,
          likeCount:         d.likeCount    || 0,
          commentCount:      d.commentCount || 0,
          isLiked:           false,
          isFollowingAuthor: userId === d.userId || followingSet.has(d.userId),
          socialPost: {
            id:         postId,
            userId:     d.userId,
            fullName:   nameMap.get(d.userId) || d.fullName || 'User',
            profilePic: d.profilePic || null,
            body:       d.content    || '',
            image:      d.media?.[0] || null,
            video:      null,
            metadata:   d.metadata   || {},
            privacy:    d.privacy    || 'Public',
            tags:       d.tags       || [],
            createdAt:  d.createdAt,
          },
        });
      }
    }
  } catch { /* MongoDB unavailable */ }

  // 3. Open job posts (PostgreSQL)
  try {
    const pool = getHanapgawaPool();
    if (pool) {
      const result = await pool.query(
        `SELECT
           jp.id,
           jp.client_user_id  AS "clientUserId",
           u.full_name        AS "clientFullName",
           jp.post_type       AS "postType",
           jp.title, jp.category, jp.municipality, jp.description,
           jp.budget_min      AS "budgetMin",
           jp.budget_max      AS "budgetMax",
           jp.status,
           (SELECT COUNT(*)::int FROM job_offers jo WHERE jo.job_post_id = jp.id) AS "offerCount",
           jp.created_at      AS "createdAt"
         FROM job_posts jp
         JOIN users u ON u.id = jp.client_user_id
         WHERE jp.status = 'open'
         ORDER BY jp.created_at DESC
         LIMIT $1`,
        [perSource],
      );
      for (const job of result.rows) {
        items.push({
          type: 'job',
          id: job.id,
          createdAt: job.createdAt,
          likeCount: 0,
          commentCount: 0,
          isLiked: false,
          job,
        });
      }
    }
  } catch { /* PostgreSQL unavailable */ }

  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const sliced = items.slice(0, limit);
  await attachInteractionCounts(sliced, userId);
  return sliced;
}

// ─── User timeline ────────────────────────────────────────────────────────────

async function getUserTimeline({ userId, role, limit = 50 }) {
  const events = [];
  const pool   = getHanapgawaPool();
  if (!pool) return [];

  try {
    const result = await pool.query(
      `SELECT
         b.id,
         b.service_category AS "serviceCategory",
         b.municipality,
         b.status,
         b.created_at AS "createdAt",
         b.updated_at AS "updatedAt",
         CASE WHEN b.client_user_id = $1 THEN 'client' ELSE 'provider' END AS perspective
       FROM bookings b
       WHERE b.client_user_id = $1 OR b.worker_user_id = $1
       ORDER BY b.updated_at DESC
       LIMIT $2`,
      [userId, Math.ceil(limit / 3)],
    );
    for (const b of result.rows) {
      events.push({
        type:     'booking',
        id:       b.id,
        createdAt: b.updatedAt,
        title:    b.serviceCategory,
        subtitle: `${b.municipality} · ${b.perspective === 'client' ? 'You hired' : 'You were hired'}`,
        status:   b.status,
      });
    }
  } catch { /* ignore */ }

  try {
    const col    = role === 'client' ? 'reviewer_user_id' : 'provider_user_id';
    const result = await pool.query(
      `SELECT
         r.id, r.rating, r.comment,
         r.provider_user_id AS "providerUserId",
         prov.full_name     AS "providerName",
         r.created_at       AS "createdAt"
       FROM reviews r
       LEFT JOIN users prov ON prov.id = r.provider_user_id
       WHERE r.${col} = $1
       ORDER BY r.created_at DESC
       LIMIT $2`,
      [userId, Math.ceil(limit / 4)],
    );
    for (const r of result.rows) {
      events.push({
        type:     'review',
        id:       r.id,
        createdAt: r.createdAt,
        title:    role === 'client'
          ? `You rated ${r.providerName || 'a provider'}`
          : `${r.providerName || 'Client'} reviewed you`,
        subtitle: `${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)} · ${r.comment ? r.comment.slice(0, 60) + (r.comment.length > 60 ? '…' : '') : 'No comment'}`,
        status:   `${r.rating}/5`,
      });
    }
  } catch { /* ignore */ }

  if (role === 'client') {
    try {
      const result = await pool.query(
        `SELECT
           jp.id, jp.title, jp.category, jp.status,
           (SELECT COUNT(*)::int FROM job_offers jo WHERE jo.job_post_id = jp.id) AS "offerCount",
           jp.created_at AS "createdAt",
           jp.updated_at AS "updatedAt"
         FROM job_posts jp
         WHERE jp.client_user_id = $1
         ORDER BY jp.updated_at DESC
         LIMIT $2`,
        [userId, Math.ceil(limit / 4)],
      );
      for (const jp of result.rows) {
        events.push({
          type:     'job_post',
          id:       jp.id,
          createdAt: jp.updatedAt,
          title:    jp.title,
          subtitle: `${jp.category} · ${jp.offerCount} offer${jp.offerCount === 1 ? '' : 's'}`,
          status:   jp.status,
        });
      }
    } catch { /* ignore */ }
  }

  if (role === 'worker' || role === 'agency') {
    try {
      const result = await pool.query(
        `SELECT
           jo.id,
           jp.title       AS "jobTitle",
           jp.category    AS "jobCategory",
           jo.proposed_price AS "proposedPrice",
           jo.status,
           jo.created_at  AS "createdAt",
           jo.updated_at  AS "updatedAt"
         FROM job_offers jo
         JOIN job_posts jp ON jp.id = jo.job_post_id
         WHERE jo.provider_user_id = $1
         ORDER BY jo.updated_at DESC
         LIMIT $2`,
        [userId, Math.ceil(limit / 4)],
      );
      for (const jo of result.rows) {
        events.push({
          type:     'job_offer',
          id:       jo.id,
          createdAt: jo.updatedAt,
          title:    `Offer on: ${jo.jobTitle}`,
          subtitle: `${jo.jobCategory}${jo.proposedPrice ? ` · P${jo.proposedPrice}` : ''}`,
          status:   jo.status,
        });
      }
    } catch { /* ignore */ }
  }

  events.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return events.slice(0, limit);
}

module.exports = { ensureFeedSchema, attachInteractionCounts, getPublicFeed, getUserTimeline };
