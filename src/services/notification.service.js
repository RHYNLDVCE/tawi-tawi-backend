const admin = require("firebase-admin");
const serviceAccount = require("../../firebase-service-account.json");
const logger = require("../utils/logger");

// Initializes the Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  logger.info("Firebase Admin SDK initialized successfully.");
}

/**
 * Dispatches a push notification to a specific device.
 * @param {string} fcmToken - The target device token.
 * @param {string} title - Notification title.
 * @param {string} body - Notification body content.
 * @param {object} data - Optional hidden data payload for app routing.
 */
async function sendPushNotification(fcmToken, title, body, data = {}) {
  try {
    const message = {
      notification: {
        title,
        body,
      },
      data,
      token: fcmToken,
    };

    const response = await admin.messaging().send(message);
    logger.info("Successfully sent message", { messageId: response });
    return true;
  } catch (error) {
    logger.error("Error sending push notification", error);
    return false;
  }
}

module.exports = {
  sendPushNotification,
};