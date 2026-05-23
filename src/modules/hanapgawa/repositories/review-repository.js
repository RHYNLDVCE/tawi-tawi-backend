const { getHanapgawaPool } = require('../../../database/hanapgawa-postgres');
const { HttpError } = require('../../../lib/http-error');

function requirePostgres() {
  const pool = getHanapgawaPool();
  if (!pool) throw new HttpError(503, 'PostgreSQL is not configured. Set HANAPGAWA_POSTGRES_URL first.');
  return pool;
}

const reviewSelect = `
  r.id,
  r.booking_id AS "bookingId",
  r.reviewer_user_id AS "reviewerUserId",
  ru.full_name AS "reviewerName",
  ru.profile_photo_url AS "reviewerPhotoUrl",
  r.reviewed_user_id AS "reviewedUserId",
  r.rating,
  r.comment,
  r.created_at AS "createdAt",
  r.updated_at AS "updatedAt"
`;

async function createReview({ bookingId, reviewerUserId, reviewedUserId, rating, comment }) {
  const pool = requirePostgres();
  const result = await pool.query(
    `
      INSERT INTO reviews (booking_id, reviewer_user_id, reviewed_user_id, rating, comment)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (booking_id, reviewer_user_id)
      DO UPDATE SET
        rating = EXCLUDED.rating,
        comment = EXCLUDED.comment,
        updated_at = NOW()
      RETURNING
        id,
        booking_id AS "bookingId",
        reviewer_user_id AS "reviewerUserId",
        reviewed_user_id AS "reviewedUserId",
        rating,
        comment,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
    [bookingId, reviewerUserId, reviewedUserId, rating, comment || null],
  );
  return result.rows[0];
}

async function listReviewsForUser(userId) {
  const pool = requirePostgres();
  const result = await pool.query(
    `
      SELECT ${reviewSelect}
      FROM reviews r
      LEFT JOIN users ru ON ru.id = r.reviewer_user_id
      WHERE r.reviewed_user_id = $1
      ORDER BY r.created_at DESC
    `,
    [userId],
  );

  const reviews = result.rows;
  const count = reviews.length;
  const avgRating = count > 0
    ? Math.round((reviews.reduce((sum, r) => sum + r.rating, 0) / count) * 10) / 10
    : null;

  return { reviews, summary: { count, avgRating } };
}

async function listReviewSummariesForProviders(providerUserIds) {
  if (!providerUserIds || providerUserIds.length === 0) return [];
  const pool = requirePostgres();
  const result = await pool.query(
    `
      SELECT
        reviewed_user_id AS "userId",
        COUNT(*)::int AS "reviewCount",
        ROUND(AVG(rating)::numeric, 1)::float AS "avgRating"
      FROM reviews
      WHERE reviewed_user_id = ANY($1::uuid[])
      GROUP BY reviewed_user_id
    `,
    [providerUserIds],
  );
  return result.rows;
}

module.exports = {
  createReview,
  listReviewsForUser,
  listReviewSummariesForProviders,
};
