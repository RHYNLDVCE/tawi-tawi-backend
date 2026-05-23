const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');

const { env } = require('../config/env');
const { HttpError } = require('../../../lib/http-error');
const { mergeUserNode } = require('../graph/graph-writer');
const {
  createEmailVerificationCode,
  createUser,
  findActiveEmailVerificationCode,
  findUserByEmail,
  markEmailVerified,
  markUserEmailVerified,
} = require('../repositories/user-repository');
const { sendEmailVerificationCode } = require('./email-service');

const VERIFICATION_CODE_TTL_MINUTES = 15;
const googleClient = new OAuth2Client();

function buildTokenPayload(user) {
  return {
    sub: user.id,
    email: user.email,
    role: user.role,
  };
}

function signAccessToken(user) {
  return jwt.sign(buildTokenPayload(user), env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });
}

function buildPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    fullName: user.fullName,
    status: user.status,
    emailVerified: Boolean(user.emailVerifiedAt),
  };
}

function hashVerificationCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

async function createVerificationCode(user) {
  const code = String(crypto.randomInt(100000, 1000000));
  const expiresAt = new Date(Date.now() + VERIFICATION_CODE_TTL_MINUTES * 60 * 1000);

  await createEmailVerificationCode({
    userId: user.id,
    codeHash: hashVerificationCode(code),
    expiresAt,
  });

  let emailResult;

  try {
    emailResult = await sendEmailVerificationCode({ email: user.email, code });
  } catch (error) {
    emailResult = { sent: false, reason: error.message };
  }

  console.log(`[auth] Verification code for ${user.email}: ${code} (emailSent: ${emailResult.sent})`);
  if (!emailResult.sent) {
    console.warn(`[auth] Email delivery failed — reason: ${emailResult.reason || 'unknown'}`);
  }

  return { code, expiresAt, emailSent: emailResult.sent };
}

async function registerUser({ email, password, role, fullName }) {
  const existingUser = await findUserByEmail(email);

  if (existingUser) {
    throw new HttpError(409, 'Email is already registered.');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await createUser({ email, passwordHash, role, fullName });
  const verification = await createVerificationCode(user);

  mergeUserNode({ id: user.id, fullName: user.fullName, email: user.email }).catch(() => {});

  return {
    user: buildPublicUser(user),
    emailVerificationRequired: true,
    emailSent: verification.emailSent,
    ...(!verification.emailSent && env.nodeEnv !== 'production' ? { devVerificationCode: verification.code } : {}),
  };
}

async function loginUser({ email, password }) {
  const user = await findUserByEmail(email);

  if (!user) {
    throw new HttpError(401, 'Invalid email or password.');
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);

  if (!passwordMatches) {
    throw new HttpError(401, 'Invalid email or password.');
  }

  if (!user.emailVerifiedAt) {
    throw new HttpError(403, 'Please verify your email before logging in.');
  }

  if (['suspended', 'banned'].includes(user.status)) {
    throw new HttpError(403, 'This account is not allowed to access HanapGawa.');
  }

  return {
    user: buildPublicUser(user),
    token: signAccessToken(user),
  };
}

async function resendVerificationCode({ email }) {
  const user = await findUserByEmail(email);

  if (!user) {
    throw new HttpError(404, 'No account exists for that email.');
  }

  if (user.emailVerifiedAt) {
    return { emailVerified: true };
  }

  const verification = await createVerificationCode(user);

  return {
    emailVerificationRequired: true,
    emailSent: verification.emailSent,
    ...(!verification.emailSent && env.nodeEnv !== 'production' ? { devVerificationCode: verification.code } : {}),
  };
}

async function verifyEmail({ email, code }) {
  const user = await findUserByEmail(email);

  if (!user) {
    throw new HttpError(404, 'No account exists for that email.');
  }

  if (user.emailVerifiedAt) {
    return {
      user: buildPublicUser(user),
      token: signAccessToken(user),
    };
  }

  const verification = await findActiveEmailVerificationCode(user.id);

  if (!verification || new Date(verification.expiresAt).getTime() < Date.now()) {
    throw new HttpError(400, 'Verification code is expired. Request a new code.');
  }

  if (verification.codeHash !== hashVerificationCode(code)) {
    throw new HttpError(400, 'Invalid verification code.');
  }

  const verifiedUser = await markEmailVerified(user.id, verification.id);

  return {
    user: buildPublicUser(verifiedUser),
    token: signAccessToken(verifiedUser),
  };
}

async function signInWithGoogle({ idToken }) {
  if (!env.googleClientId) {
    throw new HttpError(503, 'Google Sign-In is not configured.');
  }

  let ticket;
  try {
    ticket = await googleClient.verifyIdToken({
      idToken,
      audience: env.googleClientId,
    });
  } catch {
    throw new HttpError(401, 'Invalid Google sign-in token.');
  }

  const payload = ticket.getPayload();
  if (!payload?.email || !payload.email_verified) {
    throw new HttpError(401, 'Google account email must be verified.');
  }

  let user = await findUserByEmail(payload.email);

  if (!user) {
    const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
    user = await createUser({
      email: payload.email,
      passwordHash,
      role: 'client',
      fullName: payload.name || payload.email.split('@')[0],
    });
    mergeUserNode({ id: user.id, fullName: user.fullName, email: user.email }).catch(() => {});
  }

  if (['suspended', 'banned'].includes(user.status)) {
    throw new HttpError(403, 'This account is not allowed to access HanapGawa.');
  }

  if (!user.emailVerifiedAt) {
    const verification = await createVerificationCode(user);
    return {
      emailVerificationRequired: true,
      email: user.email,
      emailSent: verification.emailSent,
      ...(!verification.emailSent && env.nodeEnv !== 'production' ? { devVerificationCode: verification.code } : {}),
    };
  }

  return {
    user: buildPublicUser(user),
    token: signAccessToken(user),
  };
}

function verifyExternalToken(token) {
  return jwt.verify(token, env.jwtSecret);
}

module.exports = {
  loginUser,
  registerUser,
  resendVerificationCode,
  signInWithGoogle,
  verifyEmail,
  verifyExternalToken,
};
