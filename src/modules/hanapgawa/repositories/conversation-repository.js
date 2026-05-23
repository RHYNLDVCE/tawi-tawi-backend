const { getHanapgawaPool } = require('../../../database/hanapgawa-postgres');
const { HttpError } = require('../../../lib/http-error');

function requirePostgres() {
  const pool = getHanapgawaPool();
  if (!pool) throw new HttpError(503, 'PostgreSQL is not configured. Set HANAPGAWA_POSTGRES_URL first.');
  return pool;
}

// ─── Shared SELECT fragments ──────────────────────────────────────────────────

const conversationSelect = `
  c.id,
  c.client_user_id    AS "clientUserId",
  cu.full_name        AS "clientName",
  c.provider_user_id  AS "providerUserId",
  pu.full_name        AS "providerName",
  c.service_listing_id AS "serviceListingId",
  c.booking_id        AS "bookingId",
  c.last_message_preview AS "lastMessagePreview",
  c.last_sender_id    AS "lastSenderId",
  c.created_at        AS "createdAt",
  c.updated_at        AS "updatedAt"
`;

const messageSelect = `
  m.id,
  m.conversation_id           AS "conversationId",
  m.sender_user_id            AS "senderUserId",
  m.message,
  m.image,
  m.voice_message             AS "voiceMessage",
  m.voice_duration            AS "voiceDuration",
  m.reply_to_message_id       AS "replyToMessageId",
  m.forwarded_from_message_id AS "forwardedFromMessageId",
  m.is_system                 AS "isSystem",
  m.created_at                AS "createdAt"
`;

const nicknameSelect = `
  cn.id,
  cn.conversation_id  AS "conversationId",
  cn.target_user_id   AS "targetUserId",
  u.full_name         AS "targetName",
  cn.nickname,
  cn.set_by_user_id   AS "setByUserId",
  cn.created_at       AS "createdAt",
  cn.updated_at       AS "updatedAt"
`;

// ─── Schema bootstrap ─────────────────────────────────────────────────────────

let schemaReady = false;

// Returns the pg_class.relkind for a table name in the public schema,
// or null if the table does not exist.
// relkind 'r' = regular table, 'p' = partitioned table.
async function _tableKind(client, tableName) {
  const r = await client.query(
    `SELECT relkind FROM pg_class
     WHERE relname = $1 AND relnamespace = 'public'::regnamespace`,
    [tableName],
  );
  return r.rows[0]?.relkind || null;
}

async function ensureConversationSchema() {
  if (schemaReady) return;
  const pool = requirePostgres();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ── conversations ────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider_user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        service_listing_id   TEXT,
        booking_id           UUID REFERENCES bookings(id) ON DELETE SET NULL,
        last_message_preview TEXT NOT NULL DEFAULT '',
        last_sender_id       UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_sender_id UUID REFERENCES users(id) ON DELETE SET NULL`);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_conversations_client   ON conversations(client_user_id,  updated_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_conversations_provider ON conversations(provider_user_id, updated_at DESC)`);

    // ── conversation_messages ────────────────────────────────────────────────
    // Check whether the table already exists and what kind it is.
    // On a fresh deployment we create it as RANGE-partitioned (best for archiving).
    // On an existing deployment (e.g. shared Supabase from original backend) the
    // table already exists as a regular table — we add any missing columns and skip
    // the partition DDL entirely so we don't break live data.
    const msgKind = await _tableKind(client, 'conversation_messages');

    if (!msgKind) {
      // Fresh database — create partitioned table + year partitions + default
      await client.query(`
        CREATE TABLE conversation_messages (
          id                        UUID         NOT NULL DEFAULT gen_random_uuid(),
          conversation_id           UUID         NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          sender_user_id            UUID         NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
          message                   TEXT         NOT NULL,
          image                     TEXT,
          voice_message             TEXT,
          voice_duration            INTEGER      NOT NULL DEFAULT 0,
          reply_to_message_id       UUID,
          forwarded_from_message_id UUID,
          is_system                 BOOLEAN      NOT NULL DEFAULT FALSE,
          created_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
          PRIMARY KEY (id, created_at)
        ) PARTITION BY RANGE (created_at)
      `);
      await client.query(`CREATE TABLE conversation_messages_y2024 PARTITION OF conversation_messages FOR VALUES FROM ('2024-01-01') TO ('2025-01-01')`);
      await client.query(`CREATE TABLE conversation_messages_y2025 PARTITION OF conversation_messages FOR VALUES FROM ('2025-01-01') TO ('2026-01-01')`);
      await client.query(`CREATE TABLE conversation_messages_y2026 PARTITION OF conversation_messages FOR VALUES FROM ('2026-01-01') TO ('2027-01-01')`);
      await client.query(`CREATE TABLE conversation_messages_y2027 PARTITION OF conversation_messages FOR VALUES FROM ('2027-01-01') TO ('2028-01-01')`);
      await client.query(`CREATE TABLE conversation_messages_default PARTITION OF conversation_messages DEFAULT`);
    } else {
      // Table exists (regular or partitioned) — ensure all columns are present
      await client.query(`ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS image                     TEXT`);
      await client.query(`ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS voice_message             TEXT`);
      await client.query(`ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS voice_duration            INTEGER NOT NULL DEFAULT 0`);
      await client.query(`ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS reply_to_message_id       UUID`);
      await client.query(`ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS forwarded_from_message_id UUID`);
      await client.query(`ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS is_system                 BOOLEAN NOT NULL DEFAULT FALSE`);
    }

    await client.query(`CREATE INDEX IF NOT EXISTS idx_conv_messages_conv_created ON conversation_messages(conversation_id, created_at DESC)`);

    // ── conversation_nicknames ───────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS conversation_nicknames (
        id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id  UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        target_user_id   UUID        NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
        nickname         TEXT        NOT NULL,
        set_by_user_id   UUID        REFERENCES users(id)                  ON DELETE SET NULL,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (conversation_id, target_user_id)
      )
    `);

    await client.query('COMMIT');
    schemaReady = true;
    console.log('[ConversationRepo] Schema ready. conversation_messages type:', msgKind || 'partitioned (new)');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[ConversationRepo] ensureConversationSchema error (non-fatal):', err.message);
    schemaReady = true;
  } finally {
    client.release();
  }
}

// ─── Conversation functions ───────────────────────────────────────────────────

async function createConversation({ clientUserId, providerUserId, serviceListingId, bookingId, initialMessage }) {
  await ensureConversationSchema();
  const pool = requirePostgres();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const convResult = await client.query(
      `
        INSERT INTO conversations
          (client_user_id, provider_user_id, service_listing_id, booking_id,
           last_message_preview, last_sender_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING
          id,
          client_user_id    AS "clientUserId",
          provider_user_id  AS "providerUserId",
          service_listing_id AS "serviceListingId",
          booking_id        AS "bookingId",
          last_message_preview AS "lastMessagePreview",
          last_sender_id    AS "lastSenderId",
          created_at        AS "createdAt",
          updated_at        AS "updatedAt"
      `,
      [
        clientUserId,
        providerUserId,
        serviceListingId || null,
        bookingId        || null,
        initialMessage.slice(0, 140),
        clientUserId,
      ],
    );

    const conversation = convResult.rows[0];

    const msgResult = await client.query(
      `
        INSERT INTO conversation_messages
          (conversation_id, sender_user_id, message)
        VALUES ($1, $2, $3)
        RETURNING
          id,
          conversation_id           AS "conversationId",
          sender_user_id            AS "senderUserId",
          message,
          image,
          voice_message             AS "voiceMessage",
          voice_duration            AS "voiceDuration",
          reply_to_message_id       AS "replyToMessageId",
          forwarded_from_message_id AS "forwardedFromMessageId",
          is_system                 AS "isSystem",
          created_at                AS "createdAt"
      `,
      [conversation.id, clientUserId, initialMessage],
    );

    await client.query('COMMIT');
    return { conversation, message: msgResult.rows[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function findConversationBetweenUsers(userAId, userBId) {
  await ensureConversationSchema();
  const pool = requirePostgres();
  const result = await pool.query(
    `
      SELECT
        id,
        client_user_id    AS "clientUserId",
        provider_user_id  AS "providerUserId",
        service_listing_id AS "serviceListingId",
        booking_id        AS "bookingId",
        last_message_preview AS "lastMessagePreview",
        last_sender_id    AS "lastSenderId",
        created_at        AS "createdAt",
        updated_at        AS "updatedAt"
      FROM conversations
      WHERE (client_user_id = $1 AND provider_user_id = $2)
         OR (client_user_id = $2 AND provider_user_id = $1)
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [userAId, userBId],
  );
  return result.rows[0] || null;
}

async function findConversationById(id) {
  await ensureConversationSchema();
  const pool = requirePostgres();
  const result = await pool.query(
    `
      SELECT
        id,
        client_user_id    AS "clientUserId",
        provider_user_id  AS "providerUserId",
        service_listing_id AS "serviceListingId",
        booking_id        AS "bookingId",
        last_message_preview AS "lastMessagePreview",
        last_sender_id    AS "lastSenderId",
        created_at        AS "createdAt",
        updated_at        AS "updatedAt"
      FROM conversations
      WHERE id = $1
    `,
    [id],
  );
  return result.rows[0] || null;
}

async function listConversationsForUser(userId, search = '') {
  await ensureConversationSchema();
  const pool = requirePostgres();
  const q = search.trim();

  // The nickname join shows the OTHER participant's nickname as seen by this user.
  const result = await pool.query(
    `
      SELECT
        ${conversationSelect},
        cn_other.nickname AS "otherNickname"
      FROM conversations c
      LEFT JOIN users cu ON cu.id = c.client_user_id
      LEFT JOIN users pu ON pu.id = c.provider_user_id
      LEFT JOIN conversation_nicknames cn_other
        ON  cn_other.conversation_id = c.id
        AND cn_other.target_user_id  = CASE
              WHEN c.client_user_id = $1 THEN c.provider_user_id
              ELSE c.client_user_id
            END
      WHERE (c.client_user_id = $1 OR c.provider_user_id = $1)
        AND ($2 = '' OR cu.full_name ILIKE $3 OR pu.full_name ILIKE $3
             OR c.last_message_preview ILIKE $3)
      ORDER BY c.updated_at DESC
    `,
    [userId, q, `%${q}%`],
  );
  return result.rows;
}

// ─── Message functions ────────────────────────────────────────────────────────

async function addMessage({
  conversationId,
  senderUserId,
  message,
  image               = null,
  voiceMessage        = null,
  voiceDuration       = 0,
  replyToMessageId    = null,
  forwardedFromMessageId = null,
}) {
  await ensureConversationSchema();
  const pool = requirePostgres();

  const msgResult = await pool.query(
    `
      INSERT INTO conversation_messages
        (conversation_id, sender_user_id, message, image,
         voice_message, voice_duration, reply_to_message_id, forwarded_from_message_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING
        id,
        conversation_id           AS "conversationId",
        sender_user_id            AS "senderUserId",
        message,
        image,
        voice_message             AS "voiceMessage",
        voice_duration            AS "voiceDuration",
        reply_to_message_id       AS "replyToMessageId",
        forwarded_from_message_id AS "forwardedFromMessageId",
        is_system                 AS "isSystem",
        created_at                AS "createdAt"
    `,
    [conversationId, senderUserId, message, image,
     voiceMessage, voiceDuration, replyToMessageId, forwardedFromMessageId],
  );

  const preview = voiceMessage ? 'Voice message' : image ? 'Photo' : message.slice(0, 140);
  await pool.query(
    `
      UPDATE conversations
      SET last_message_preview = $2,
          last_sender_id       = $3,
          updated_at           = NOW()
      WHERE id = $1
    `,
    [conversationId, preview, senderUserId],
  );

  return msgResult.rows[0];
}

async function addSystemMessage({ conversationId, message }) {
  await ensureConversationSchema();
  const pool = requirePostgres();

  // System messages are attributed to the client_user_id of the conversation
  // (any valid participant reference satisfies the FK — we pick the client).
  const result = await pool.query(
    `
      INSERT INTO conversation_messages
        (conversation_id, sender_user_id, message, is_system)
      SELECT $1, client_user_id, $2, TRUE
      FROM conversations
      WHERE id = $1
      RETURNING
        id,
        conversation_id           AS "conversationId",
        sender_user_id            AS "senderUserId",
        message,
        image,
        voice_message             AS "voiceMessage",
        voice_duration            AS "voiceDuration",
        reply_to_message_id       AS "replyToMessageId",
        forwarded_from_message_id AS "forwardedFromMessageId",
        is_system                 AS "isSystem",
        created_at                AS "createdAt"
    `,
    [conversationId, message],
  );
  return result.rows[0] || null;
}

// Cursor-based pagination — newest first.
// before: UUID of the message to paginate from (exclusive).
// Returns messages older than the cursor, ordered newest → oldest.
// Client reverses the array for chronological display.
async function listMessages(conversationId, { before, limit = 50 } = {}) {
  await ensureConversationSchema();
  const pool = requirePostgres();
  const cap = Math.min(limit, 100);

  if (before) {
    const result = await pool.query(
      `
        SELECT ${messageSelect}
        FROM conversation_messages m
        WHERE m.conversation_id = $1
          AND m.created_at < (
            SELECT created_at
            FROM   conversation_messages
            WHERE  id              = $2
              AND  conversation_id = $1
            LIMIT 1
          )
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT $3
      `,
      [conversationId, before, cap],
    );
    return result.rows;
  }

  const result = await pool.query(
    `
      SELECT ${messageSelect}
      FROM   conversation_messages m
      WHERE  m.conversation_id = $1
      ORDER  BY m.created_at DESC, m.id DESC
      LIMIT  $2
    `,
    [conversationId, cap],
  );
  return result.rows;
}

async function editMessage({ messageId, senderUserId, message }) {
  await ensureConversationSchema();
  const pool = requirePostgres();
  const result = await pool.query(
    `
      UPDATE conversation_messages
      SET    message = $1
      WHERE  id             = $2
        AND  sender_user_id = $3
      RETURNING
        id,
        conversation_id           AS "conversationId",
        sender_user_id            AS "senderUserId",
        message,
        image,
        voice_message             AS "voiceMessage",
        voice_duration            AS "voiceDuration",
        reply_to_message_id       AS "replyToMessageId",
        forwarded_from_message_id AS "forwardedFromMessageId",
        is_system                 AS "isSystem",
        created_at                AS "createdAt"
    `,
    [message, messageId, senderUserId],
  );
  if (!result.rows.length) throw new HttpError(404, 'Message not found or not yours.');
  return result.rows[0];
}

async function deleteMessage({ messageId, senderUserId }) {
  await ensureConversationSchema();
  const pool = requirePostgres();
  const result = await pool.query(
    `
      DELETE FROM conversation_messages
      WHERE  id             = $1
        AND  sender_user_id = $2
      RETURNING id
    `,
    [messageId, senderUserId],
  );
  if (!result.rows.length) throw new HttpError(404, 'Message not found or not yours.');
}

async function deleteConversation({ conversationId, userId }) {
  await ensureConversationSchema();
  const pool = requirePostgres();
  const result = await pool.query(
    `
      DELETE FROM conversations
      WHERE id = $1
        AND (client_user_id = $2 OR provider_user_id = $2)
      RETURNING id
    `,
    [conversationId, userId],
  );
  if (!result.rows.length) throw new HttpError(404, 'Conversation not found or not yours.');
}

// ─── Nickname functions ───────────────────────────────────────────────────────

async function upsertConversationNickname(conversationId, targetUserId, nickname, setByUserId) {
  await ensureConversationSchema();
  const pool = requirePostgres();
  const result = await pool.query(
    `
      INSERT INTO conversation_nicknames
        (conversation_id, target_user_id, nickname, set_by_user_id)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (conversation_id, target_user_id)
      DO UPDATE SET
        nickname       = EXCLUDED.nickname,
        set_by_user_id = EXCLUDED.set_by_user_id,
        updated_at     = NOW()
      RETURNING
        id,
        conversation_id  AS "conversationId",
        target_user_id   AS "targetUserId",
        nickname,
        set_by_user_id   AS "setByUserId",
        created_at        AS "createdAt",
        updated_at        AS "updatedAt"
    `,
    [conversationId, targetUserId, nickname.trim(), setByUserId],
  );
  return result.rows[0];
}

async function deleteConversationNickname(conversationId, targetUserId) {
  await ensureConversationSchema();
  const pool = requirePostgres();
  await pool.query(
    `
      DELETE FROM conversation_nicknames
      WHERE conversation_id = $1
        AND target_user_id  = $2
    `,
    [conversationId, targetUserId],
  );
}

async function getConversationNicknames(conversationId) {
  await ensureConversationSchema();
  const pool = requirePostgres();
  const result = await pool.query(
    `
      SELECT ${nicknameSelect}
      FROM   conversation_nicknames cn
      LEFT   JOIN users u ON u.id = cn.target_user_id
      WHERE  cn.conversation_id = $1
    `,
    [conversationId],
  );
  return result.rows;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  ensureConversationSchema,
  createConversation,
  findConversationBetweenUsers,
  findConversationById,
  listConversationsForUser,
  addMessage,
  addSystemMessage,
  listMessages,
  editMessage,
  deleteMessage,
  deleteConversation,
  upsertConversationNickname,
  deleteConversationNickname,
  getConversationNicknames,
};
