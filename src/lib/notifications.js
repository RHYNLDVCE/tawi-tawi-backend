const { sendPushNotification } = require('./firebase');

async function _getDeviceTokens(pool, userId) {
  try {
    const r = await pool.query(
      `SELECT token FROM user_device_tokens WHERE user_id = $1`,
      [userId],
    );
    return r.rows.map((row) => row.token);
  } catch {
    return [];
  }
}

async function createNotification(pool, { userId, actorId, actorName, type, title, body = '', linkType, linkId }) {
  if (!pool || !userId) return;
  try {
    await pool.query(
      `INSERT INTO notifications (user_id, actor_id, actor_name, type, title, body, link_type, link_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, actorId || null, actorName || '', type, title, body.slice(0, 200), linkType || null, linkId || null],
    );
    _getDeviceTokens(pool, userId).then((tokens) => {
      for (const token of tokens) {
        sendPushNotification({
          token,
          title,
          body: body.slice(0, 120) || title,
          data: {
            type,
            ...(linkType ? { linkType } : {}),
            ...(linkId ? { linkId } : {}),
          },
        });
      }
    });
  } catch (e) {
    console.warn('[notifications] Failed to create notification:', e.message);
  }
}

module.exports = { createNotification };
