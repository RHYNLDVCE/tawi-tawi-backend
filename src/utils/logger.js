const env = require("../config/env");

const formatMessage = (level, message, meta = {}) => {
  const timestamp = new Date().toISOString();
  const metaString = Object.keys(meta).length ? JSON.stringify(meta) : "";
  return `[${timestamp}] [${level}] ${message} ${metaString}`.trim();
};

const logger = {
  info: (message, meta) => {
    console.info(formatMessage("INFO", message, meta));
  },
  warn: (message, meta) => {
    console.warn(formatMessage("WARN", message, meta));
  },
  error: (message, error) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [ERROR] ${message}`);
    if (error && error.stack && env.NODE_ENV === "development") {
      console.error(error.stack);
    } else if (error) {
      console.error(`[${timestamp}] [ERROR DETAILS] ${error.message || error}`);
    }
  },
};

module.exports = logger;