const { getHanapgawaPool } = require('../../../database/hanapgawa-postgres');
const { HttpError } = require('../../../lib/http-error');

function requirePostgres() {
  const pool = getHanapgawaPool();
  if (!pool) throw new HttpError(503, 'PostgreSQL is not configured. Set HANAPGAWA_POSTGRES_URL first.');
  return pool;
}

let authSchemaReady = false;

async function ensureAuthSchema(pool) {
  if (authSchemaReady) {
    return;
  }

  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_verification_codes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  authSchemaReady = true;
}

async function createUser({ email, passwordHash, role, fullName, emailVerifiedAt = null }) {
  const pool = requirePostgres();
  await ensureAuthSchema(pool);
  const result = await pool.query(
    `
      INSERT INTO users (email, password_hash, role, full_name, email_verified_at)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, email, role, full_name AS "fullName", email_verified_at AS "emailVerifiedAt", status, created_at AS "createdAt"
    `,
    [email, passwordHash, role, fullName, emailVerifiedAt],
  );

  return result.rows[0];
}

async function markUserEmailVerified(userId) {
  const pool = requirePostgres();
  await ensureAuthSchema(pool);
  const result = await pool.query(
    `
      UPDATE users
      SET email_verified_at = COALESCE(email_verified_at, NOW()), updated_at = NOW()
      WHERE id = $1
      RETURNING id, email, role, full_name AS "fullName", email_verified_at AS "emailVerifiedAt", status
    `,
    [userId],
  );

  return result.rows[0] || null;
}

async function findUserByEmail(email) {
  const pool = requirePostgres();
  await ensureAuthSchema(pool);
  const result = await pool.query(
    `
      SELECT id, email, password_hash AS "passwordHash", role, full_name AS "fullName", email_verified_at AS "emailVerifiedAt", status
      FROM users
      WHERE email = $1
    `,
    [email],
  );

  return result.rows[0] || null;
}

async function findUserById(id) {
  const pool = requirePostgres();
  const result = await pool.query(
    `
      SELECT id, email, role, full_name AS "fullName", email_verified_at AS "emailVerifiedAt", status
      FROM users
      WHERE id = $1
    `,
    [id],
  );

  return result.rows[0] || null;
}

async function listUsersByRoles(roles, status) {
  const pool = requirePostgres();
  const values = [roles];
  let query = `
    SELECT id, email, role, full_name AS "fullName", email_verified_at AS "emailVerifiedAt", status, created_at AS "createdAt"
    FROM users
    WHERE role = ANY($1)
  `;

  if (status) {
    values.push(status);
    query += ` AND status = $2`;
  }

  query += ' ORDER BY created_at DESC';

  const result = await pool.query(query, values);
  return result.rows;
}

async function listAllUsersForAdmin(search) {
  const pool = requirePostgres();
  const values = [];
  let where = '';

  if (search) {
    values.push(`%${search.toLowerCase()}%`);
    where = `WHERE LOWER(u.full_name) LIKE $1 OR LOWER(u.email) LIKE $1`;
  }

  const result = await pool.query(
    `
      SELECT
        u.id,
        u.email,
        u.role,
        u.full_name AS "fullName",
        u.email_verified_at AS "emailVerifiedAt",
        u.status,
        u.created_at AS "createdAt",
        COUNT(DISTINCT jp.id)::INT AS "postCount",
        COUNT(DISTINCT sp.id)::INT AS "socialPostCount",
        COUNT(DISTINCT rr.id)::INT AS "reportCount"
      FROM users u
      LEFT JOIN job_posts jp ON jp.client_user_id = u.id
      LEFT JOIN social_posts sp ON sp.user_id = u.id
      LEFT JOIN reports rr ON rr.reporter_user_id = u.id OR rr.provider_user_id = u.id
      ${where}
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT 100
    `,
    values,
  );

  return result.rows;
}

async function updateUserStatus(id, status) {
  const pool = requirePostgres();
  await ensureAuthSchema(pool);
  const result = await pool.query(
    `
      UPDATE users
      SET status = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING id, email, role, full_name AS "fullName", email_verified_at AS "emailVerifiedAt", status
    `,
    [id, status],
  );

  return result.rows[0] || null;
}

async function listUsersByIds(ids) {
  if (!ids.length) {
    return [];
  }

  const pool = requirePostgres();
  const result = await pool.query(
    `
      SELECT id, email, role, full_name AS "fullName", email_verified_at AS "emailVerifiedAt", status
      FROM users
      WHERE id = ANY($1)
    `,
    [ids],
  );

  return result.rows;
}

async function createEmailVerificationCode({ userId, codeHash, expiresAt }) {
  const pool = requirePostgres();
  await ensureAuthSchema(pool);
  await pool.query('UPDATE email_verification_codes SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL', [userId]);
  const result = await pool.query(
    `
      INSERT INTO email_verification_codes (user_id, code_hash, expires_at)
      VALUES ($1, $2, $3)
      RETURNING id, user_id AS "userId", expires_at AS "expiresAt", created_at AS "createdAt"
    `,
    [userId, codeHash, expiresAt],
  );

  return result.rows[0];
}

async function findActiveEmailVerificationCode(userId) {
  const pool = requirePostgres();
  const result = await pool.query(
    `
      SELECT id, user_id AS "userId", code_hash AS "codeHash", expires_at AS "expiresAt"
      FROM email_verification_codes
      WHERE user_id = $1 AND used_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [userId],
  );

  return result.rows[0] || null;
}

async function markEmailVerified(userId, codeId) {
  const pool = requirePostgres();
  await ensureAuthSchema(pool);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('UPDATE email_verification_codes SET used_at = NOW() WHERE id = $1', [codeId]);
    const result = await client.query(
      `
        UPDATE users
        SET email_verified_at = COALESCE(email_verified_at, NOW()), updated_at = NOW()
        WHERE id = $1
        RETURNING id, email, role, full_name AS "fullName", email_verified_at AS "emailVerifiedAt", status
      `,
      [userId],
    );
    await client.query('COMMIT');
    return result.rows[0] || null;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  createUser,
  createEmailVerificationCode,
  findUserByEmail,
  findUserById,
  findActiveEmailVerificationCode,
  listUsersByIds,
  listAllUsersForAdmin,
  listUsersByRoles,
  markEmailVerified,
  markUserEmailVerified,
  updateUserStatus,
};
