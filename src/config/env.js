const dotenv = require("dotenv");

dotenv.config();

const env = {
  PORT: process.env.PORT || 1738,
  NODE_ENV: process.env.NODE_ENV || "development",

  NEO4J_URI: process.env.NEO4J_URI,
  NEO4J_USERNAME: process.env.NEO4J_USERNAME,
  NEO4J_PASSWORD: process.env.NEO4J_PASSWORD,

  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "7d",

  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,

  META_APP_ID: process.env.META_APP_ID,
  META_APP_SECRET: process.env.META_APP_SECRET,

  CORS_ORIGIN: process.env.CORS_ORIGIN || "*",

  // ── Service gateway URLs ─────────────────────────────────────────────────────
  TRANSPORT_SERVICE_URL: process.env.TRANSPORT_SERVICE_URL,
  TOURISM_SERVICE_URL: process.env.TOURISM_SERVICE_URL,
  GATEWAY_INTERNAL_SECRET: process.env.GATEWAY_INTERNAL_SECRET,

  // ── HanapGawa integration (all optional — server starts without them) ────────
  HANAPGAWA_POSTGRES_URL: process.env.POSTGRES_URL || null,
  HANAPGAWA_POSTGRES_SSL: process.env.POSTGRES_SSL === "true",

  MONGODB_URL:     process.env.MONGODB_URL     || null,
  MONGODB_DB_NAME: process.env.MONGODB_DB_NAME || "hanapgawa",

  REDIS_URL: process.env.REDIS_URL || null,

  GEMINI_API_KEY:        process.env.GEMINI_API_KEY        || null,
  GROQ_API_KEY:          process.env.GROQ_API_KEY          || null,
  GIPHY_API_KEY:         process.env.GIPHY_API_KEY         || null,
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME || null,
  CLOUDINARY_API_KEY:    process.env.CLOUDINARY_API_KEY    || null,
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET || null,
  LIVEKIT_URL:           process.env.LIVEKIT_URL || process.env.LIVEKIT_UR || null,
  LIVEKIT_API_KEY:       process.env.LIVEKIT_API_KEY       || null,
  LIVEKIT_API_SECRET:    process.env.LIVEKIT_API_SECRET    || null,
};

// JWT_SECRET is always required.
if (!env.JWT_SECRET) {
  throw new Error("Missing required environment variable: JWT_SECRET");
}

// Neo4j vars are required in production, optional in local development.
if (env.NODE_ENV === "production") {
  ["NEO4J_URI", "NEO4J_USERNAME", "NEO4J_PASSWORD"].forEach((key) => {
    if (!env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  });
} else if (!env.NEO4J_URI) {
  console.warn("[Neo4j] Credentials not set — GraphQL auth will not work locally.");
}

// HanapGawa vars are intentionally never required — server starts without them.

module.exports = env;
