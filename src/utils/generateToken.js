const jwt = require("jsonwebtoken");
const env = require("../config/env");

function generateToken(payload) {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  });
}

module.exports = generateToken;