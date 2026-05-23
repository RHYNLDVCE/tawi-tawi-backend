const express = require("express");
const cors = require("cors");
const path = require("path");
const { ApolloServer } = require("@apollo/server");
const { expressMiddleware } = require("@as-integrations/express5");
const jwt = require("jsonwebtoken");
const depthLimit = require("graphql-depth-limit");

const env = require("./config/env");
const typeDefs = require("./graphql/typeDefs");
const resolvers = require("./graphql/resolvers");
const { findUserById } = require("./modules/users/user.repository");
const { serializeUser } = require("./modules/users/user.serializer");
const USER_STATUS = require("./constants/userStatus");
const logger = require("./utils/logger");
const notFoundMiddleware = require("./middleware/notFound.middleware");
const errorMiddleware = require("./middleware/error.middleware");

const app = express();

app.set("trust proxy", 1);

app.use(cors({
  origin: env.CORS_ORIGIN === "*" ? "*" : env.CORS_ORIGIN.split(","),
  credentials: true,
}));

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(express.static(path.join(__dirname, "../public")));

const getUserFromToken = async (token) => {
  try {
    if (!token) return null;
    const decoded = jwt.verify(token.replace("Bearer ", ""), env.JWT_SECRET);
    const userNode = await findUserById(decoded.userId);
    if (!userNode) return null;
    const user = userNode.properties;
    if (user.status !== USER_STATUS.ACTIVE) return null;
    return serializeUser(userNode);
  } catch (error) {
    logger.warn("GraphQL context auth failed", { message: error.message });
    return null;
  }
};

async function startApolloServer() {
  const server = new ApolloServer({
    typeDefs,
    resolvers,
    validationRules: [depthLimit(5)],
    formatError: (error) => {
      logger.error("GraphQL Error", error);
      return {
        message: error.message,
        code: error.extensions?.code || "INTERNAL_SERVER_ERROR",
      };
    },
  });

  await server.start();

  app.use(
    "/graphql",
    expressMiddleware(server, {
      context: async ({ req }) => {
        const token = req.headers.authorization || "";
        const user = await getUserFromToken(token);
        return {
          user,
          ip: req.ip || req.connection.remoteAddress,
        };
      },
    })
  );

  logger.info("Apollo GraphQL gateway mounted at /graphql");
}

startApolloServer();

app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Tawi-Tawi Gateway API is running.",
    mode: "GraphQL",
  });
});

// ── HanapGawa REST API — mounted at /api/v1, no collision with /graphql ──────
const hanapgawaApiRouter = require("./routes/api-v1");
app.use("/api/v1", hanapgawaApiRouter);
// ─────────────────────────────────────────────────────────────────────────────

app.use(notFoundMiddleware);
app.use(errorMiddleware);

module.exports = app;
