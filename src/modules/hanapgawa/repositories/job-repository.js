const { getHanapgawaPool } = require('../../../database/hanapgawa-postgres');
const { HttpError } = require('../../../lib/http-error');

function requirePostgres() {
  const pool = getHanapgawaPool();
  if (!pool) throw new HttpError(503, 'PostgreSQL is not configured. Set HANAPGAWA_POSTGRES_URL first.');
  return pool;
}

const jobSelect = `
  jp.id,
  jp.client_user_id AS "clientUserId",
  client.full_name AS "clientFullName",
  jp.post_type AS "postType",
  jp.title,
  jp.category,
  jp.municipality,
  jp.location_details AS "locationDetails",
  jp.description,
  jp.budget_min AS "budgetMin",
  jp.budget_max AS "budgetMax",
  jp.workers_needed AS "workersNeeded",
  (SELECT COUNT(*)::int FROM job_offers offers WHERE offers.job_post_id = jp.id AND offers.status = 'accepted') AS "acceptedOfferCount",
  CASE
    WHEN jp.client_user_id = $1 OR $2 = 'admin' THEN COALESCE((
      SELECT json_agg(json_build_object('id', u.id, 'name', u.full_name) ORDER BY offers.updated_at)
      FROM job_offers offers
      JOIN users u ON u.id = offers.provider_user_id
      WHERE offers.job_post_id = jp.id AND offers.status = 'accepted'
    ), '[]'::json)
    ELSE '[]'::json
  END AS "acceptedWorkers",
  jp.allow_direct_booking AS "allowDirectBooking",
  jp.status,
  (SELECT COUNT(*)::int FROM job_offers offers WHERE offers.job_post_id = jp.id) AS "offerCount",
  (SELECT COUNT(*)::int FROM job_offers offers WHERE offers.job_post_id = jp.id AND offers.status = 'pending') AS "pendingOfferCount",
  jp.assigned_provider_user_id AS "assignedProviderUserId",
  provider.full_name AS "assignedProviderFullName",
  jp.scheduled_at AS "scheduledAt",
  jp.created_at AS "createdAt",
  jp.updated_at AS "updatedAt"
`;

const offerSelect = `
  jo.id,
  jo.job_post_id AS "jobPostId",
  jo.provider_user_id AS "providerUserId",
  provider.full_name AS "providerName",
  jo.message,
  jo.proposed_price AS "proposedPrice",
  jo.media,
  jo.status,
  jo.created_at AS "createdAt",
  jo.updated_at AS "updatedAt"
`;

async function createJobPost({ clientUserId, postType, title, category, municipality, locationDetails, description, budgetMin, budgetMax, workersNeeded, scheduledAt, allowDirectBooking }) {
  const pool = requirePostgres();
  const result = await pool.query(
    `
      INSERT INTO job_posts (
        client_user_id, post_type, title, category, municipality,
        location_details, description, budget_min, budget_max,
        workers_needed, scheduled_at, allow_direct_booking
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING
        id,
        client_user_id AS "clientUserId",
        post_type AS "postType",
        title, category, municipality,
        location_details AS "locationDetails",
        description,
        budget_min AS "budgetMin",
        budget_max AS "budgetMax",
        workers_needed AS "workersNeeded",
        allow_direct_booking AS "allowDirectBooking",
        status,
        0 AS "offerCount",
        0 AS "pendingOfferCount",
        0 AS "acceptedOfferCount",
        '[]'::json AS "acceptedWorkers",
        assigned_provider_user_id AS "assignedProviderUserId",
        scheduled_at AS "scheduledAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
    [clientUserId, postType, title, category, municipality, locationDetails || '', description, budgetMin ?? null, budgetMax ?? null, workersNeeded || 1, scheduledAt || null, allowDirectBooking ?? false],
  );

  return result.rows[0];
}

async function updateJobPost(jobPostId, { postType, title, category, municipality, locationDetails, description, budgetMin, budgetMax, workersNeeded, scheduledAt, allowDirectBooking }) {
  const pool = requirePostgres();
  const result = await pool.query(
    `
      UPDATE job_posts
      SET
        post_type = $2, title = $3, category = $4, municipality = $5,
        location_details = $6, description = $7, budget_min = $8,
        budget_max = $9, workers_needed = $10, scheduled_at = $11,
        allow_direct_booking = $12, updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        client_user_id AS "clientUserId",
        post_type AS "postType",
        title, category, municipality,
        location_details AS "locationDetails",
        description,
        budget_min AS "budgetMin",
        budget_max AS "budgetMax",
        workers_needed AS "workersNeeded",
        allow_direct_booking AS "allowDirectBooking",
        status,
        (SELECT COUNT(*)::int FROM job_offers offers WHERE offers.job_post_id = job_posts.id) AS "offerCount",
        (SELECT COUNT(*)::int FROM job_offers offers WHERE offers.job_post_id = job_posts.id AND offers.status = 'pending') AS "pendingOfferCount",
        (SELECT COUNT(*)::int FROM job_offers offers WHERE offers.job_post_id = job_posts.id AND offers.status = 'accepted') AS "acceptedOfferCount",
        '[]'::json AS "acceptedWorkers",
        assigned_provider_user_id AS "assignedProviderUserId",
        scheduled_at AS "scheduledAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
    [jobPostId, postType, title, category, municipality, locationDetails || '', description, budgetMin ?? null, budgetMax ?? null, workersNeeded || 1, scheduledAt || null, allowDirectBooking ?? false],
  );

  return result.rows[0] || null;
}

async function deleteJobPost(jobPostId) {
  const pool = requirePostgres();
  const result = await pool.query('DELETE FROM job_posts WHERE id = $1 RETURNING id', [jobPostId]);
  return result.rowCount > 0;
}

async function listJobPosts({ userId, role, status }) {
  const pool = requirePostgres();
  const values = [userId, role];
  const conditions = [];

  if (status) {
    values.push(status);
    conditions.push(`jp.status = $${values.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await pool.query(
    `
      SELECT ${jobSelect}
      FROM job_posts jp
      JOIN users client ON client.id = jp.client_user_id
      LEFT JOIN users provider ON provider.id = jp.assigned_provider_user_id
      ${where}
      ORDER BY jp.created_at DESC
      LIMIT 50
    `,
    values,
  );

  return result.rows;
}

async function findJobPostById(jobPostId, { userId = '', role = 'user' } = {}) {
  const pool = requirePostgres();
  const result = await pool.query(
    `
      SELECT ${jobSelect}
      FROM job_posts jp
      JOIN users client ON client.id = jp.client_user_id
      LEFT JOIN users provider ON provider.id = jp.assigned_provider_user_id
      WHERE jp.id = $3
    `,
    [userId, role, jobPostId],
  );

  return result.rows[0] || null;
}

async function createJobOffer({ jobPostId, providerUserId, message, proposedPrice, media }) {
  const pool = requirePostgres();
  const result = await pool.query(
    `
      INSERT INTO job_offers (job_post_id, provider_user_id, message, proposed_price, media)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (job_post_id, provider_user_id)
      DO UPDATE SET
        message = EXCLUDED.message,
        proposed_price = EXCLUDED.proposed_price,
        media = EXCLUDED.media,
        status = CASE WHEN job_offers.status = 'accepted' THEN 'accepted' ELSE 'pending' END,
        updated_at = NOW()
      RETURNING
        id,
        job_post_id AS "jobPostId",
        provider_user_id AS "providerUserId",
        message,
        proposed_price AS "proposedPrice",
        media,
        status,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
    [jobPostId, providerUserId, message || '', proposedPrice ?? null, JSON.stringify(media || [])],
  );

  return result.rows[0];
}

async function listOffersForJob(jobPostId) {
  const pool = requirePostgres();
  const result = await pool.query(
    `
      SELECT ${offerSelect}
      FROM job_offers jo
      JOIN users provider ON provider.id = jo.provider_user_id
      WHERE jo.job_post_id = $1
      ORDER BY jo.created_at DESC
    `,
    [jobPostId],
  );

  return result.rows;
}

async function listOffersForProvider(providerUserId) {
  const pool = requirePostgres();
  const result = await pool.query(
    `
      SELECT
        ${offerSelect},
        jp.title AS "jobTitle",
        jp.category AS "jobCategory",
        jp.municipality AS "jobMunicipality"
      FROM job_offers jo
      JOIN users provider ON provider.id = jo.provider_user_id
      JOIN job_posts jp ON jp.id = jo.job_post_id
      WHERE jo.provider_user_id = $1
      ORDER BY jo.created_at DESC
    `,
    [providerUserId],
  );

  return result.rows;
}

async function findJobOfferById(offerId) {
  const pool = requirePostgres();
  const result = await pool.query(
    `
      SELECT ${offerSelect}
      FROM job_offers jo
      JOIN users provider ON provider.id = jo.provider_user_id
      WHERE jo.id = $1
    `,
    [offerId],
  );

  return result.rows[0] || null;
}

async function acceptJobOffer({ jobPostId, offerId }) {
  const pool = requirePostgres();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const offerResult = await client.query(
      `
        UPDATE job_offers
        SET status = 'accepted', updated_at = NOW()
        WHERE id = $1 AND job_post_id = $2 AND status = 'pending'
        RETURNING
          id,
          job_post_id AS "jobPostId",
          provider_user_id AS "providerUserId",
          message,
          proposed_price AS "proposedPrice",
          media,
          status,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      `,
      [offerId, jobPostId],
    );

    const offer = offerResult.rows[0] || null;
    if (!offer) {
      await client.query('ROLLBACK');
      return null;
    }

    const countResult = await client.query(
      `SELECT
         jp.workers_needed AS "workersNeeded",
         (SELECT COUNT(*)::int FROM job_offers offers WHERE offers.job_post_id = jp.id AND offers.status = 'accepted') AS "acceptedOfferCount"
       FROM job_posts jp
       WHERE jp.id = $1 AND jp.status = 'open'`,
      [jobPostId],
    );
    const counts = countResult.rows[0] || null;
    if (!counts) {
      await client.query('ROLLBACK');
      return null;
    }
    const filled = counts.acceptedOfferCount >= counts.workersNeeded;

    const jobResult = await client.query(
      `
        UPDATE job_posts
        SET status = $3, assigned_provider_user_id = COALESCE(assigned_provider_user_id, $2), updated_at = NOW()
        WHERE id = $1 AND status = 'open'
        RETURNING
          id,
          client_user_id AS "clientUserId",
          post_type AS "postType",
          title, category, municipality,
          location_details AS "locationDetails",
          description,
          budget_min AS "budgetMin",
          budget_max AS "budgetMax",
          workers_needed AS "workersNeeded",
          status,
          (SELECT COUNT(*)::int FROM job_offers offers WHERE offers.job_post_id = job_posts.id) AS "offerCount",
          (SELECT COUNT(*)::int FROM job_offers offers WHERE offers.job_post_id = job_posts.id AND offers.status = 'pending') AS "pendingOfferCount",
          (SELECT COUNT(*)::int FROM job_offers offers WHERE offers.job_post_id = job_posts.id AND offers.status = 'accepted') AS "acceptedOfferCount",
          '[]'::json AS "acceptedWorkers",
          assigned_provider_user_id AS "assignedProviderUserId",
          scheduled_at AS "scheduledAt",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      `,
      [jobPostId, offer.providerUserId, filled ? 'assigned' : 'open'],
    );

    const jobPost = jobResult.rows[0] || null;
    if (!jobPost) {
      await client.query('ROLLBACK');
      return null;
    }

    await client.query('COMMIT');
    return { jobPost, offer };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function declineJobOffer({ jobPostId, offerId }) {
  const pool = requirePostgres();
  const result = await pool.query(
    `UPDATE job_offers SET status = 'rejected', updated_at = NOW()
     WHERE id = $1 AND job_post_id = $2 AND status = 'pending'
     RETURNING id, job_post_id AS "jobPostId", provider_user_id AS "providerUserId",
               status, created_at AS "createdAt"`,
    [offerId, jobPostId],
  );
  return result.rows[0] || null;
}

module.exports = {
  acceptJobOffer,
  createJobOffer,
  createJobPost,
  declineJobOffer,
  deleteJobPost,
  findJobOfferById,
  findJobPostById,
  listJobPosts,
  listOffersForJob,
  listOffersForProvider,
  updateJobPost,
};
