const axios = require("axios");

const env = require("../../../config/env");
const AppError = require("../../../utils/AppError");
const logger = require("../../../utils/logger");

function getMetaAppAccessToken() {
  if (
    !env.META_APP_ID ||
    env.META_APP_ID === "your_meta_app_id_here" ||
    !env.META_APP_SECRET ||
    env.META_APP_SECRET === "your_meta_app_secret_here"
  ) {
    logger.error("Meta App credentials missing in environment variables.");
    throw new AppError("Meta authentication is currently unavailable.", 500);
  }

  return `${env.META_APP_ID}|${env.META_APP_SECRET}`;
}

async function verifyMetaAccessToken(accessToken) {
  const appAccessToken = getMetaAppAccessToken();
  const debugUrl = "https://graph.facebook.com/debug_token";

  try {
    // Verify the token validity
    const debugResponse = await axios.get(debugUrl, {
      params: {
        input_token: accessToken,
        access_token: appAccessToken,
      },
      timeout: 5000, // Prevent hanging if Meta API is down
    });

    const debugData = debugResponse.data?.data;

    if (!debugData || debugData.is_valid !== true) {
      throw new Error("Token marked as invalid by Meta.");
    }

    if (String(debugData.app_id) !== String(env.META_APP_ID)) {
      throw new Error("Token app_id does not match the server configuration.");
    }

    const userId = debugData.user_id;

    if (!userId) {
      throw new Error("Missing user_id in Meta debug response.");
    }

    // Fetch the user's profile data
    const profileResponse = await axios.get("https://graph.facebook.com/me", {
      params: {
        fields: "id,name,email,picture",
        access_token: accessToken,
      },
      timeout: 5000,
    });

    const profile = profileResponse.data;

    if (!profile?.id) {
      throw new Error("Failed to extract ID from Meta profile response.");
    }

    const email = profile.email
      ? profile.email.toLowerCase()
      : `meta_${profile.id}@meta.local`;

    return {
      provider: "meta",
      providerUserId: profile.id,
      email,
      fullName: profile.name || "Meta User",
      picture: profile.picture?.data?.url || null,
    };
  } catch (error) {
    // Log the exact cause (e.g., Axios timeout, rate limit, or manual error throw)
    logger.error("Meta Token Verification Failed", { 
      detail: error.response?.data?.error?.message || error.message 
    });
    
    throw new AppError("Invalid or expired Meta authentication token.", 401);
  }
}

module.exports = {
  verifyMetaAccessToken,
};