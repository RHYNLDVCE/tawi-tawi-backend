const { OAuth2Client } = require("google-auth-library");

const env = require("../../../config/env");
const AppError = require("../../../utils/AppError");
const logger = require("../../../utils/logger");

let googleClient = null;

function getGoogleClient() {
  if (
    !env.GOOGLE_CLIENT_ID ||
    env.GOOGLE_CLIENT_ID === "your_google_client_id_here"
  ) {
    logger.error("Google Client ID is missing in environment variables.");
    throw new AppError("Google authentication is currently unavailable.", 500);
  }

  if (!googleClient) {
    googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);
  }

  return googleClient;
}

async function verifyGoogleIdToken(idToken) {
  const client = getGoogleClient();

  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    if (!payload || !payload.sub) {
      throw new Error("Malformed Google payload received.");
    }

    if (!payload.email) {
      throw new Error("Google account email permission was denied.");
    }

    if (payload.email_verified === false) {
      throw new Error("Google email address is not verified.");
    }

    return {
      provider: "google",
      providerUserId: payload.sub,
      email: payload.email.toLowerCase(),
      fullName: payload.name || payload.email,
      picture: payload.picture || null,
    };
  } catch (error) {
    // Log the actual upstream error for internal debugging
    logger.error("Google Token Verification Failed", { detail: error.message });
    
    // Throw a sanitized error to the client
    throw new AppError("Invalid or expired Google authentication token.", 401);
  }
}

module.exports = {
  verifyGoogleIdToken,
};