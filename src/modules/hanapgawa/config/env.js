const rootEnv = require("../../../config/env");

const env = {
  jwtSecret:      rootEnv.JWT_SECRET,
  jwtExpiresIn:   rootEnv.JWT_EXPIRES_IN,
  googleClientId: rootEnv.GOOGLE_CLIENT_ID || null,
  nodeEnv:        rootEnv.NODE_ENV,
  postgresUrl:    rootEnv.HANAPGAWA_POSTGRES_URL,
  postgresSsl:    rootEnv.HANAPGAWA_POSTGRES_SSL,
  brevoApiKey:    process.env.BREVO_API_KEY || '',
  emailFrom:      process.env.EMAIL_FROM || 'HanapGawa <noreply@hanapgawa.com>',
};

module.exports = { env };
