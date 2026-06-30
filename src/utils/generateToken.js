const jwt = require("jsonwebtoken");
const env = require("../config/env");

function generateToken(payload, privateKey) {
  // Ignore privateKey and use the persistent JWT_SECRET
  return jwt.sign(payload, env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: env.JWT_EXPIRES_IN || "7d",
  });
}

module.exports = generateToken;