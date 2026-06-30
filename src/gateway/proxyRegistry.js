const { createProxyMiddleware } = require("http-proxy-middleware");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const NodeCache = require("node-cache");
const env = require("../config/env");
const logger = require("../utils/logger");
const { getLinkedServiceId } = require("../modules/users/user.repository");
const generateToken = require("../utils/generateToken");

const buildServiceUrl = (baseUrl, path) => {//ctrl+F 'lutz' need ko para sa post ko 
  return `${String(baseUrl || "").replace(/\/+$/, "")}${path}`;
};
// Initialize an in-memory cache with a 5-minute Time-To-Live (TTL)
const mappingCache = new NodeCache({ stdTTL: 300 });

// Generates a standardized proxy middleware for any microservice
function createServiceProxy(serviceName, targetUrl, targetPrefix) {
  const target = targetUrl ? targetUrl.replace("/api/v1/gateway", "") : "";

  if (!target) {
    logger.warn(`Target URL missing for service: ${serviceName}. Proxy will not mount.`);
    return null;
  }

    const proxyReqHandler = handleProxyRequest(serviceName, targetPrefix);

  return createProxyMiddleware({//ctrl+F 'lutz' need ko para sa post ko 
    target,
    changeOrigin: true,
    proxyTimeout: 30000,
    timeout: 30000,

    pathRewrite: (path, req) => {
      return req.originalUrl.replace(`/api/${serviceName}`, targetPrefix);
    },

    // For newer http-proxy-middleware versions.
    on: {
      proxyReq: proxyReqHandler,
      error: (err, req, res) => {
        logger.error(`[${serviceName.toUpperCase()}] Proxy routing failed`, {
          error: err.message,
        });

        if (!res.headersSent) {
          res.status(502).json({
            success: false,
            message: `${serviceName} service is currently unavailable.`,
            error: err.message,
          });
        }
      },
    },

    // For older http-proxy-middleware versions.
    onProxyReq: proxyReqHandler,

    onError: (err, req, res) => {
      logger.error(`[${serviceName.toUpperCase()}] Proxy routing failed`, {
        error: err.message,
      });

      if (!res.headersSent) {
        res.status(502).json({
          success: false,
          message: `${serviceName} service is currently unavailable.`,
          error: err.message,
        });
      }
    },
  });
}

// Accepts BOTH privateKey (to mint) and publicKey (to verify)
function setupProxies(app, privateKey, publicKey) {
  const services = [
    { name: "hanapgawa", url: env.HANAPGAWA_SERVICE_URL, prefix: "/api/v1" },
    { name: "transportation", url: env.TRANSPORT_SERVICE_URL, prefix: "/api" },
    { name: "tourism", url: env.TOURISM_SERVICE_URL, prefix: "/api" },
    { name: "shu", url: env.SHU_SERVICE_URL, prefix: "/api/v1" },
    { name: "ecommerce", url: env.ECOMMERCE_SERVICE_URL, prefix: "" }
  ];

  services.forEach((service) => {
    // Async Token Translator Middleware
    const tokenTranslator = async (req, res, next) => {
      try {
        const authHeader = req.headers.authorization;
        
        if (authHeader && authHeader.startsWith("Bearer ")) {
          const incomingToken = authHeader.split(" ")[1];
          
          // CRITICAL SECURITY FIX: Cryptographically verify the token signature 
          // Do not use jwt.decode on untrusted input
          const decoded = jwt.verify(incomingToken, publicKey, { algorithms: ["RS256"] });
          
          if (decoded && decoded.userId) {
            // IMPORTANT:
            // SHU/RHU backend already accepts the original Tawi-Tawi token
            // when the request includes X-Internal-Gateway-Secret.
            // So for SHU only, verify the token here but do not translate it.
            // Other services will continue using the existing token translation flow.
            if (service.name === "shu") {
              if (env.GATEWAY_INTERNAL_SECRET) {
                req.headers["x-internal-gateway-secret"] = env.GATEWAY_INTERNAL_SECRET;
                req.headers["X-Internal-Gateway-Secret"] = env.GATEWAY_INTERNAL_SECRET;
              }
              return next();
            }

            const cacheKey = `${decoded.userId}-${service.name}`;
            
            // PERFORMANCE FIX: Check cache first to avoid hammering Neo4j
            let localId = mappingCache.get(cacheKey);
            
            if (localId === undefined) {
              localId = await getLinkedServiceId(decoded.userId, service.name);
              // Store null if not found to prevent cache stampedes
              mappingCache.set(cacheKey, localId || null);
            }
            
            if (localId) {
              // Mint a brand new token using the downstream service's local ID
              const translatedToken = generateToken({
                sub: localId, 
                email: decoded.email
              }, privateKey);
              
              req.headers.authorization = `Bearer ${translatedToken}`;
            }
          }
        }
        next();
      } catch (error) {
        logger.warn(`[${service.name.toUpperCase()}] Unauthorized proxy attempt intercepted`, { error: error.message });
        // Block the request immediately if the token is forged or expired
        return res.status(401).json({ error: "Unauthorized or expired token." });
      }
    };
    


  const proxy = createServiceProxy(service.name, service.url, service.prefix);
  if (proxy) {
    app.use(`/api/${service.name}`, tokenTranslator, proxy);
    logger.info(`Mounted proxy route: /api/${service.name} -> ${service.url}`);
  }
  });
}


function handleProxyRequest(serviceName, targetPrefix) {
  return (proxyReq, req, res) => {
    if (req.headers.authorization) {
      proxyReq.setHeader("Authorization", req.headers.authorization);
    }

    if (env.GATEWAY_INTERNAL_SECRET) {
      proxyReq.setHeader(
        "X-Internal-Gateway-Secret",
        env.GATEWAY_INTERNAL_SECRET
      );
    }

    proxyReq.setHeader("Accept", "application/json");

    // Fix POST/PUT/PATCH body forwarding if Express already parsed req.body.
    // If req.body is undefined, the original request stream will pass normally.
    if (
      req.body &&
      ["POST", "PUT", "PATCH"].includes(req.method.toUpperCase())
    ) {
      const bodyData =
        typeof req.body === "string" ? req.body : JSON.stringify(req.body);

      proxyReq.setHeader("Content-Type", "application/json");
      proxyReq.setHeader("Content-Length", Buffer.byteLength(bodyData));
      proxyReq.write(bodyData);
    }

    logger.info(
      `[${serviceName.toUpperCase()}] Proxying request: ${
        req.method
      } ${req.originalUrl.replace(`/api/${serviceName}`, targetPrefix)}`
    );
  };
}


module.exports = setupProxies;

