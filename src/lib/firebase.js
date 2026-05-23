const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

let _initialized = false;

function initFirebase() {
  if (_initialized) return;
  const candidates = [
    path.join(__dirname, '../config/firebase-service-account.json'),
    '/etc/secrets/firebase-service-account.json',
  ];
  const serviceAccountPath = candidates.find(fs.existsSync);
  if (!serviceAccountPath) {
    console.warn('[Firebase] Service account not found — push notifications disabled.');
    return;
  }
  try {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    _initialized = true;
    console.log('[Firebase] Admin initialized.');
  } catch (e) {
    console.warn('[Firebase] Admin init failed:', e.message);
  }
}

async function sendPushNotification({ token, title, body, data = {} }) {
  if (!_initialized || !token) return;
  try {
    await admin.messaging().send({
      token,
      notification: { title, body },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)]),
      ),
      android: { priority: 'high', notification: { sound: 'default' } },
      apns: { payload: { aps: { sound: 'default' } } },
    });
  } catch (e) {
    if (e.code === 'messaging/registration-token-not-registered') return 'stale';
    console.warn('[Firebase] FCM send failed:', e.message);
  }
}

module.exports = { initFirebase, sendPushNotification };
