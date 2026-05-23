const express = require("express");
const cors = require("cors");
const path = require("path");
const { ApolloServer } = require("@apollo/server");
const { expressMiddleware } = require("@as-integrations/express5");
const jwt = require("jsonwebtoken");
const depthLimit = require("graphql-depth-limit");
const jose = require("node-jose");

const env = require("./config/env");
const typeDefs = require("./graphql/typeDefs");
const resolvers = require("./graphql/resolvers");
const { findUserById } = require("./modules/users/user.repository");
const { serializeUser } = require("./modules/users/user.serializer");
const USER_STATUS = require("./constants/userStatus");
const logger = require("./utils/logger");
const setupProxies = require("./gateway/proxyRegistry"); // Import the dynamic proxy registry

const app = express();

// Trust the reverse proxy if running behind a load balancer or API Gateway
app.set("trust proxy", 1);

app.use(cors({
  origin: env.CORS_ORIGIN === "*" ? "*" : env.CORS_ORIGIN.split(","),
  credentials: true,
}));

// --- JWKS ENTERPRISE SECURITY SETUP ---
// Generates an RSA key pair on server startup for token signing and verification.
const keystore = jose.JWK.createKeyStore();
let currentPublicKeyPem = null;
let currentPrivateKeyPem = null;

async function initializeSecurityKeys() {
  const key = await keystore.generate("RSA", 2048, {
    alg: "RS256",
    use: "sig",
    kid: "tawitawi-gateway-key-1"
  });
  currentPrivateKeyPem = key.toPEM(true);
  currentPublicKeyPem = key.toPEM(false);
  logger.info("Enterprise JWKS RSA key pair initialized");
}
initializeSecurityKeys();

// Exposes the public key for microservices to fetch automatically
app.get("/.well-known/jwks.json", (req, res) => {
  res.json(keystore.toJSON());
});
// --------------------------------------

// Initialize all microservice proxies dynamically via the registry
setupProxies(app);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(express.static(path.join(__dirname, "../public")));

// Extracts user for GraphQL Context
const getUserFromToken = async (token) => {
  try {
    if (!token) return null;
    if (!currentPublicKeyPem) return null; // Failsafe if keys are still generating
    
    // Verify using the RSA Public Key instead of the HS256 Secret
    const decoded = jwt.verify(token.replace("Bearer ", ""), currentPublicKeyPem, { algorithms: ["RS256"] });
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

// Initializes Apollo Server
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
  
  // Mounts GraphQL on /graphql endpoint using expressMiddleware
  app.use(
    "/graphql",
    expressMiddleware(server, {
      context: async ({ req }) => {
        const token = req.headers.authorization || "";
        const user = await getUserFromToken(token);
        
        // Pass the IP address and Private Key into the context
        return { 
          user,
          ip: req.ip || req.connection.remoteAddress,
          privateKey: currentPrivateKeyPem
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

module.exports = app;