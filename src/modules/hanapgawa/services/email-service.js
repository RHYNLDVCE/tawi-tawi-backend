const { BrevoClient } = require('@getbrevo/brevo');

const { env } = require('../config/env');

let client;

function getClient() {
  if (!env.brevoApiKey) return null;
  if (!client) {
    client = new BrevoClient({ apiKey: env.brevoApiKey });
  }
  return client;
}

async function sendEmailVerificationCode({ email, code }) {
  const brevo = getClient();

  if (!brevo) {
    console.warn('[email] Brevo API key not set — email not sent.');
    return { sent: false, reason: 'Brevo API key is not configured.' };
  }

  const senderEmail = env.emailFrom.includes('<')
    ? env.emailFrom.match(/<(.+)>/)[1]
    : env.emailFrom;

  console.log(`[email] Sending verification code to ${email} from ${senderEmail}`);

  try {
    const result = await brevo.transactionalEmails.sendTransacEmail({
      sender: { name: 'HanapGawa', email: senderEmail },
      to: [{ email }],
      subject: 'Verify your HanapGawa account',
      htmlContent: `
        <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #222; max-width: 520px; margin: 0 auto; padding: 28px;">
          <h2 style="margin: 0 0 12px; text-align: center; color: #2f203f;">Verify your HanapGawa account</h2>
          <p style="margin: 0 0 18px; text-align: center; color: #604f6f;">Enter this verification code to finish creating your account:</p>
          <p style="margin: 0 auto 18px; width: fit-content; font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #2f203f;">${code}</p>
          <p style="margin: 0; text-align: center; color: #604f6f;">This code expires in 15 minutes.</p>
        </div>
      `,
    });
    console.log(`[email] Brevo accepted email to ${email} — messageId: ${result?.messageId || 'n/a'}`);
    return { sent: true };
  } catch (error) {
    console.warn(`[email] Brevo error for ${email}: ${error.message}`);
    return { sent: false, reason: error.message };
  }
}

module.exports = { sendEmailVerificationCode };
