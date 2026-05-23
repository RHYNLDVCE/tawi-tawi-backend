const { randomUUID } = require("crypto");

const AppError = require("../../utils/AppError");
const generateToken = require("../../utils/generateToken");
const { hashPassword, comparePassword } = require("../../utils/password");
const USER_STATUS = require("../../constants/userStatus");

const {
  createUser,
  findUserByEmail,
} = require("../users/user.repository");

const {
  findUserByAuthIdentity,
  createAuthIdentityForUser,
} = require("../users/authIdentity.repository");

const { serializeUser } = require("../users/user.serializer");
const { verifyGoogleIdToken } = require("./providers/google.provider");
const { verifyMetaAccessToken } = require("./providers/meta.provider");

// Accept privateKey from resolvers
async function registerPublicUser(registerData, privateKey) {
  const existingUser = await findUserByEmail(registerData.email);

  if (existingUser) {
    throw new AppError("Email is already registered.", 409);
  }

  const now = new Date().toISOString();
  const passwordHash = await hashPassword(registerData.password);

  const userNode = await createUser({
    id: randomUUID(),
    fullName: registerData.fullName,
    email: registerData.email.toLowerCase(),
    passwordHash,
    status: USER_STATUS.ACTIVE,
    createdAt: now,
    updatedAt: now,
  });

  const user = serializeUser(userNode);

  // Pass privateKey to the utility
  const token = generateToken({
    userId: user.id,
  }, privateKey);

  return {
    token,
    user,
  };
}

// Accept privateKey from resolvers
async function loginPublicUser(loginData, privateKey) {
  const userNode = await findUserByEmail(loginData.email);

  if (!userNode) {
    throw new AppError("Invalid email or password.", 401);
  }

  const user = userNode.properties;

  if (user.status !== USER_STATUS.ACTIVE) {
    throw new AppError("Your account is disabled.", 403);
  }

  if (!user.passwordHash) {
    throw new AppError("Please login using your connected auth provider.", 401);
  }

  const isPasswordCorrect = await comparePassword(
    loginData.password,
    user.passwordHash
  );

  if (!isPasswordCorrect) {
    throw new AppError("Invalid email or password.", 401);
  }

  // Pass privateKey to the utility
  const token = generateToken({
    userId: user.id,
  }, privateKey);

  return {
    token,
    user: serializeUser(userNode),
  };
}

// Accept privateKey and pass it down
async function loginWithProvider(providerUser, privateKey) {
  let userNode = await findUserByAuthIdentity(
    providerUser.provider,
    providerUser.providerUserId
  );

  if (!userNode) {
    const existingUserByEmail = await findUserByEmail(providerUser.email);

    if (existingUserByEmail) {
      userNode = await createAuthIdentityForUser(
        existingUserByEmail.properties.id,
        providerUser
      );
    } else {
      const now = new Date().toISOString();

      const newUserNode = await createUser({
        id: randomUUID(),
        fullName: providerUser.fullName,
        email: providerUser.email,
        passwordHash: null,
        status: USER_STATUS.ACTIVE,
        createdAt: now,
        updatedAt: now,
      });

      userNode = await createAuthIdentityForUser(
        newUserNode.properties.id,
        providerUser
      );
    }
  }

  const user = serializeUser(userNode);

  // Pass privateKey to the utility
  const token = generateToken({
    userId: user.id,
  }, privateKey);

  return {
    token,
    user,
  };
}

// Accept privateKey from resolvers and pass to loginWithProvider
async function loginWithGoogle(idToken, privateKey) {
  const googleUser = await verifyGoogleIdToken(idToken);
  return loginWithProvider(googleUser, privateKey);
}

// Accept privateKey from resolvers and pass to loginWithProvider
async function loginWithMeta(accessToken, privateKey) {
  const metaUser = await verifyMetaAccessToken(accessToken);
  return loginWithProvider(metaUser, privateKey);
}

async function logoutPublicUser() {
  return true;
}

module.exports = {
  registerPublicUser,
  loginPublicUser,
  loginWithGoogle,
  loginWithMeta,
  logoutPublicUser,
};