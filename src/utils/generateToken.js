const jwt = require("jsonwebtoken");
const env = require("../config/env");

function generateToken(payload, privateKey) {
  if (!privateKey) {
    throw new Error("Token generation failed: Private key is required for RS256 signing.");
  }

  return jwt.sign(payload, privateKey, {
    algorithm: "RS256",
    keyid: "tawitawi-gateway-key-1",
    expiresIn: env.JWT_EXPIRES_IN || "7d",
  });
}

module.exports = generateToken;