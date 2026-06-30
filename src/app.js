const express = require("express");
const helmet = require("helmet"); // Added missing import
const rateLimit = require("express-rate-limit"); // Added for brute-force protection
const cors = require("cors");
const path = require("path");
const { ApolloServer } = require("@apollo/server");
const { expressMiddleware } = require("@as-integrations/express5");
const jwt = require("jsonwebtoken");
const depthLimit = require("graphql-depth-limit");
const jose = require("node-jose");
const axios = require("axios");
const NodeCache = require("node-cache");

const env = require("./config/env");
const authCache = new NodeCache({ stdTTL: 300 });
const typeDefs = require("./graphql/typeDefs");
const resolvers = require("./graphql/resolvers");
const { findUserById } = require("./modules/users/user.repository");
const { serializeUser } = require("./modules/users/user.serializer");
const USER_STATUS = require("./constants/userStatus");
const logger = require("./utils/logger");
const setupProxies = require("./gateway/proxyRegistry"); 

const app = express();

app.set("trust proxy", 1);

// --- SECURE CONFIGURED HELMET ---
app.use(
  helmet({
    crossOriginEmbedderPolicy: false, // Required for Apollo Sandbox to render
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Trust Apollo Sandbox and Tailwind CDN scripts
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://cdn.tailwindcss.com",
          "https://embeddable-sandbox.cdn.apollographql.com"
        ],
        // Allow inline styles injected by Tailwind
        styleSrc: [
          "'self'",
          "'unsafe-inline'"
        ],
        // Allow Apollo Sandbox to load external images and connect to its API
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https:", "wss:"],
        frameSrc: ["'self'", "https://sandbox.embed.apollographql.com"],
      },
    },
  })
);
app.use(cors({
  origin: env.CORS_ORIGIN === "*" ? "*" : env.CORS_ORIGIN.split(","),
  credentials: true,
}));

// --- JWKS ENTERPRISE SECURITY SETUP ---
const keystore = jose.JWK.createKeyStore();
let currentPublicKeyPem = null;
let currentPrivateKeyPem = null;

async function initializeSecurityKeys() {
  if (env.GATEWAY_PRIVATE_KEY && env.GATEWAY_PUBLIC_KEY) {
    try {
      const key = await keystore.add(env.GATEWAY_PRIVATE_KEY, "pem");
      currentPrivateKeyPem = key.toPEM(true);
      currentPublicKeyPem = key.toPEM(false);
      logger.info("Loaded Enterprise JWKS RSA key pair from environment");
      return;
    } catch (error) {
      logger.error("Failed to load JWKS keys from environment. Falling back to generated keys.", { error: error.message });
    }
  }

  logger.warn("GATEWAY_PRIVATE_KEY missing. Generating ephemeral keys. Tokens will NOT persist across restarts.");
  const key = await keystore.generate("RSA", 2048, {
    alg: "RS256",
    use: "sig",
    kid: "tawitawi-gateway-key-1"
  });
  currentPrivateKeyPem = key.toPEM(true);
  currentPublicKeyPem = key.toPEM(false);
  logger.info("Ephemeral JWKS RSA key pair initialized");
}

app.get("/.well-known/jwks.json", (req, res) => {
  res.json(keystore.toJSON());
});
// --------------------------------------

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(express.static(path.join(__dirname, "../public")));

const getUserFromToken = async (token) => {
  try {
    if (!token) return null;
    if (!env.JWT_SECRET) return null; 
    
    const decoded = jwt.verify(token.replace("Bearer ", ""), currentPublicKeyPem, { algorithms: ["RS256"] });
    const userNode = await findUserById(decoded.userId);
    
    if (!userNode) {
      authCache.set(decoded.userId, null);
      return null;
    }
    const user = userNode.properties;
    
    if (user.status !== USER_STATUS.ACTIVE) {
      authCache.set(decoded.userId, null);
      return null;
    }
    const serializedUser = serializeUser(userNode);
    authCache.set(decoded.userId, serializedUser);
    return serializedUser;
  } catch (error) {
    logger.warn("GraphQL context auth failed", { message: error.message });
    return null;
  }
};

// --- RATE LIMITER FOR GRAPHQL ---
const graphqlLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per 15 mins
  message: { error: "Too many requests from this IP, please try again later." }
});

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
  
  // Apply the rate limiter directly to the GraphQL endpoint
  app.use("/graphql", graphqlLimiter);

  app.use(
    "/graphql",
    expressMiddleware(server, {
      context: async ({ req }) => {
        const token = req.headers.authorization || "";
        const user = await getUserFromToken(token);
        
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

app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Tawi-Tawi Gateway API is running.",
    mode: "GraphQL",
  });
});



// Single definition of the startup sequence
async function startGateway() {
  await initializeSecurityKeys();
  setupProxies(app, currentPrivateKeyPem, currentPublicKeyPem);
  await startApolloServer();
}

// Export the app and the startup function cleanly to server.js
module.exports = {
  app,
  startGateway
};