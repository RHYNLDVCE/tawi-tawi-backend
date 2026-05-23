const jwt = require("jsonwebtoken");
const env = require("../config/env");
const { getHanapgawaPool } = require("../database/hanapgawa-postgres");

/**
 * Required auth for HanapGawa /api/v1 routes.
 * Accepts tokens from both Tawi-Tawi (decoded.userId) and HanapGawa (decoded.sub).
 * Lazy-creates a user row in PostgreSQL on first use so FK constraints are satisfied.
 * Sets req.auth = { sub, role, email } — the shape all HanapGawa route files expect.
 *
 * Does NOT touch req.user or auth.middleware.js — existing /v1 routes are unaffected.
 */
async function hanapgawaAuth(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }

    const token = header.slice(7);
    let decoded;
    try {
      decoded = jwt.verify(token, env.JWT_SECRET);
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({ success: false, message: "Authentication token has expired." });
      }
      return res.status(401).json({ success: false, message: "Invalid authentication token." });
    }

    // Tawi-Tawi tokens use decoded.userId; HanapGawa tokens use decoded.sub
    const userId = decoded.sub || decoded.userId;
    const role   = decoded.role  || "user";
    const email  = decoded.email || "";
    const name   = decoded.fullName || decoded.name || "";

    if (!userId) {
      return res.status(401).json({ success: false, message: "Invalid token payload." });
    }

    // Lazy-create bridge user row so HanapGawa FK constraints are satisfied.
    // ON CONFLICT DO NOTHING handles users already registered on HanapGawa side.
    const pool = getHanapgawaPool();
    if (pool) {
      // password_hash = '' for bridge users (Tawi-Tawi side) — they authenticate
      // via JWT only, never via password. ON CONFLICT (id) DO NOTHING skips the
      // insert for users already registered through HanapGawa's own auth flow.
      await pool.query(
        `INSERT INTO users (id, email, role, full_name, email_verified_at, status, password_hash)
         VALUES ($1, $2, $3, $4, NOW(), 'approved', '')
         ON CONFLICT (id) DO NOTHING`,
        [userId, email || `${userId}@tawi-tawi.local`, role, name],
      );
    }

    req.auth = { sub: userId, role, email };
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Optional auth — sets req.auth if a valid token is present, does not block unauthenticated requests.
 * Used by HanapGawa routes that work for both guests and logged-in users.
 */
function hanapgawaOptionalAuth(req, _res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    try {
      const decoded = jwt.verify(header.slice(7), env.JWT_SECRET);
      const userId = decoded.sub || decoded.userId;
      if (userId) {
        req.auth = { sub: userId, role: decoded.role || "user", email: decoded.email || "" };
      }
    } catch { /* invalid token — treat as unauthenticated */ }
  }
  next();
}

module.exports = { hanapgawaAuth, hanapgawaOptionalAuth };
