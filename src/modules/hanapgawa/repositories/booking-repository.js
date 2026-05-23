const { getHanapgawaPool } = require('../../../database/hanapgawa-postgres');
const { HttpError } = require('../../../lib/http-error');

function requirePostgres() {
  const pool = getHanapgawaPool();
  if (!pool) throw new HttpError(503, 'PostgreSQL is not configured. Set HANAPGAWA_POSTGRES_URL first.');
  return pool;
}

// Full RETURNING clause shared by all write operations
const bookingReturning = `
  id,
  client_user_id AS "clientUserId",
  worker_user_id AS "workerUserId",
  service_listing_id AS "serviceListingId",
  job_post_id AS "jobPostId",
  service_category AS "serviceCategory",
  municipality,
  location_details AS "locationDetails",
  notes,
  status,
  previous_status AS "previousStatus",
  source,
  scheduled_at AS "scheduledAt",
  provider_completed_at AS "providerCompletedAt",
  client_confirmed_at AS "clientConfirmedAt",
  cancellation_requested_at AS "cancellationRequestedAt",
  cancellation_requested_by AS "cancellationRequestedBy",
  cancellation_reason AS "cancellationReason",
  reposted_job_id AS "repostedJobId",
  reschedule_note AS "rescheduleNote",
  rescheduled_at AS "rescheduledAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

// Full SELECT clause used by list/find queries (adds joined columns)
const bookingSelect = `
  b.id,
  b.client_user_id AS "clientUserId",
  b.worker_user_id AS "workerUserId",
  cu.full_name AS "clientName",
  wu.full_name AS "workerName",
  b.service_listing_id AS "serviceListingId",
  b.job_post_id AS "jobPostId",
  jp.title AS "jobTitle",
  b.service_category AS "serviceCategory",
  b.municipality,
  b.location_details AS "locationDetails",
  b.notes,
  b.status,
  b.previous_status AS "previousStatus",
  b.scheduled_at AS "scheduledAt",
  b.provider_completed_at AS "providerCompletedAt",
  b.client_confirmed_at AS "clientConfirmedAt",
  b.cancellation_requested_at AS "cancellationRequestedAt",
  b.cancellation_requested_by AS "cancellationRequestedBy",
  b.cancellation_reason AS "cancellationReason",
  b.source,
  b.reposted_job_id AS "repostedJobId",
  b.reschedule_note AS "rescheduleNote",
  b.rescheduled_at AS "rescheduledAt",
  b.created_at AS "createdAt",
  b.updated_at AS "updatedAt"
`;

async function createBooking({ clientUserId, workerUserId, serviceListingId, serviceCategory, municipality, locationDetails, notes, scheduledAt, status = 'pending', source = 'direct_booking', jobPostId }) {
  const pool = requirePostgres();
  const result = await pool.query(
    `
      INSERT INTO bookings (
        client_user_id,
        worker_user_id,
        service_listing_id,
        service_category,
        municipality,
        location_details,
        notes,
        scheduled_at,
        status,
        source,
        job_post_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING ${bookingReturning}
    `,
    [clientUserId, workerUserId, serviceListingId || null, serviceCategory, municipality, locationDetails || '', notes, scheduledAt, status, source, jobPostId || null],
  );

  return result.rows[0];
}

async function listBookingsForUser(userId) {
  const pool = requirePostgres();
  const result = await pool.query(
    `
      SELECT ${bookingSelect}
      FROM bookings b
      LEFT JOIN users cu ON cu.id = b.client_user_id
      LEFT JOIN users wu ON wu.id = b.worker_user_id
      LEFT JOIN job_posts jp ON jp.id = b.job_post_id
      WHERE b.client_user_id = $1 OR b.worker_user_id = $1
      ORDER BY b.created_at DESC
    `,
    [userId],
  );

  return result.rows;
}

async function findBookingById(bookingId) {
  const pool = requirePostgres();
  const result = await pool.query(
    `
      SELECT ${bookingSelect}
      FROM bookings b
      LEFT JOIN users cu ON cu.id = b.client_user_id
      LEFT JOIN users wu ON wu.id = b.worker_user_id
      LEFT JOIN job_posts jp ON jp.id = b.job_post_id
      WHERE b.id = $1
    `,
    [bookingId],
  );

  return result.rows[0] || null;
}

async function updateBookingStatus({ bookingId, status, actorUserId, cancellationReason }) {
  const pool = requirePostgres();
  const isCancellationStatus = ['cancellation_requested', 'cancelled', 'rejected'].includes(status);
  const result = await pool.query(
    `
      UPDATE bookings
      SET
        previous_status = CASE WHEN $2 = 'cancellation_requested' THEN status ELSE previous_status END,
        status = $2,
        provider_completed_at = CASE WHEN $2 = 'completion_requested' THEN NOW() ELSE provider_completed_at END,
        client_confirmed_at = CASE WHEN $2 = 'completed' THEN NOW() ELSE client_confirmed_at END,
        cancellation_requested_at = CASE WHEN $2 = 'cancellation_requested' THEN NOW() ELSE cancellation_requested_at END,
        cancellation_requested_by = CASE WHEN $2 = 'cancellation_requested' THEN $3 ELSE cancellation_requested_by END,
        cancellation_reason = CASE WHEN $4 = true THEN $5 ELSE cancellation_reason END,
        updated_at = NOW()
      WHERE id = $1
      RETURNING ${bookingReturning}
    `,
    [bookingId, status, actorUserId || null, isCancellationStatus && !!cancellationReason, cancellationReason || null],
  );

  return result.rows[0] || null;
}

async function listAllBookings(status) {
  const pool = requirePostgres();
  const values = [];
  const where = status ? 'WHERE b.status = $1' : '';
  if (status) values.push(status);

  const result = await pool.query(
    `
      SELECT ${bookingSelect}
      FROM bookings b
      LEFT JOIN users cu ON cu.id = b.client_user_id
      LEFT JOIN users wu ON wu.id = b.worker_user_id
      LEFT JOIN job_posts jp ON jp.id = b.job_post_id
      ${where}
      ORDER BY b.created_at DESC
    `,
    values,
  );

  return result.rows;
}

async function rescheduleBooking({ bookingId, scheduledAt, rescheduleNote }) {
  const pool = requirePostgres();
  const result = await pool.query(
    `
      UPDATE bookings
      SET
        scheduled_at = $2,
        reschedule_note = $3,
        rescheduled_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
      RETURNING id, scheduled_at AS "scheduledAt", reschedule_note AS "rescheduleNote", rescheduled_at AS "rescheduledAt"
    `,
    [bookingId, scheduledAt, rescheduleNote || null],
  );

  return result.rows[0] || null;
}

async function markBookingReposted({ bookingId, jobPostId }) {
  const pool = requirePostgres();
  const result = await pool.query(
    `
      UPDATE bookings
      SET reposted_job_id = $2, updated_at = NOW()
      WHERE id = $1 AND reposted_job_id IS NULL
      RETURNING id, reposted_job_id AS "repostedJobId"
    `,
    [bookingId, jobPostId],
  );

  return result.rows[0] || null;
}

async function removeBooking(bookingId) {
  const pool = requirePostgres();
  await pool.query('DELETE FROM bookings WHERE id = $1', [bookingId]);
}

module.exports = {
  createBooking,
  findBookingById,
  listAllBookings,
  listBookingsForUser,
  markBookingReposted,
  removeBooking,
  rescheduleBooking,
  updateBookingStatus,
};
