const AppError = require("../../utils/AppError");
const { serializeUser } = require("./user.serializer");
const { updateUserById } = require("./user.repository");

async function getMe(user) {
  return serializeUser(user);
}

async function updateMe(userId, updateData) {
  const updatedUser = await updateUserById(userId, {
    ...updateData,
    updatedAt: new Date().toISOString(),
  });

  if (!updatedUser) {
    throw new AppError("User not found.", 404);
  }

  return serializeUser(updatedUser);
}

module.exports = {
  getMe,
  updateMe,
};