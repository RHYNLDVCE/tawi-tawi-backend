const { getHanapgawaPool: getPostgresPool } = require('../../../database/hanapgawa-postgres');
const { HttpError } = require('../../../lib/http-error');

function requirePostgres() {
  const pool = getPostgresPool();

  if (!pool) {
    throw new HttpError(503, 'PostgreSQL is not configured. Set POSTGRES_URL first.');
  }

  return pool;
}

async function listCategories(activeOnly = true) {
  const pool = requirePostgres();
  const result = await pool.query(
    `
      SELECT id, name, slug, description, icon, active, created_at AS "createdAt"
      FROM service_categories
      ${activeOnly ? 'WHERE active = TRUE' : ''}
      ORDER BY name ASC
    `,
  );

  return result.rows;
}

async function createCategory({ name, slug, description, icon }) {
  const pool = requirePostgres();
  const result = await pool.query(
    `
      INSERT INTO service_categories (name, slug, description, icon)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, slug, description, icon, active
    `,
    [name, slug, description, icon],
  );

  return result.rows[0];
}

async function updateCategory({ id, name, slug, description, icon, active }) {
  const pool = requirePostgres();
  const result = await pool.query(
    `
      UPDATE service_categories
      SET name = $2, slug = $3, description = $4, icon = $5, active = $6, updated_at = NOW()
      WHERE id = $1
      RETURNING id, name, slug, description, icon, active
    `,
    [id, name, slug, description, icon, active],
  );

  return result.rows[0] || null;
}

module.exports = {
  createCategory,
  listCategories,
  updateCategory,
};
