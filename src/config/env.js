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

  TRANSPORT_SERVICE_URL: process.env.TRANSPORT_SERVICE_URL,
  TOURISM_SERVICE_URL: process.env.TOURISM_SERVICE_URL,
  GATEWAY_INTERNAL_SECRET: process.env.GATEWAY_INTERNAL_SECRET,
};

const requiredEnv = [
  "NEO4J_URI",
  "NEO4J_USERNAME",
  "NEO4J_PASSWORD",
  "JWT_SECRET",
];

requiredEnv.forEach((key) => {
  if (!env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
});

module.exports = env;