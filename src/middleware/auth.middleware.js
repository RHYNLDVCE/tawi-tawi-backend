const jwt = require("jsonwebtoken");

const env = require("../config/env");
const AppError = require("../utils/AppError");
const USER_STATUS = require("../constants/userStatus");
const { findUserById } = require("../modules/users/user.repository");
const { serializeUser } = require("../modules/users/user.serializer");

async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new AppError("Authentication token is missing.", 401);
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(token, env.JWT_SECRET);

    const userNode = await findUserById(decoded.userId);

    if (!userNode) {
      throw new AppError("User account no longer exists.", 401);
    }

    const user = userNode.properties;

    if (user.status !== USER_STATUS.ACTIVE) {
      throw new AppError("User account is disabled.", 403);
    }

    req.user = serializeUser(userNode);

    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError") {
      return next(new AppError("Invalid authentication token.", 401));
    }

    if (error.name === "TokenExpiredError") {
      return next(new AppError("Authentication token has expired.", 401));
    }

    next(error);
  }
}

module.exports = authMiddleware;