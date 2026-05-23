const { createProxyMiddleware } = require("http-proxy-middleware");
const env = require("../config/env");
const logger = require("../utils/logger");

// Generates a standardized proxy middleware for any microservice
function createServiceProxy(serviceName, targetUrl) {
  const target = targetUrl ? targetUrl.replace("/api/v1/gateway", "") : "";

  if (!target) {
    logger.warn(`Target URL missing for service: ${serviceName}. Proxy will not mount.`);
    return null;
  }

  return createProxyMiddleware({
    target,
    changeOrigin: true,
    pathRewrite: (path, req) => {
      // Automatically maps /api/[serviceName]/... to /api/v1/...
      return req.originalUrl.replace(`/api/${serviceName}`, "/api/v1");
    },
    onProxyReq: (proxyReq, req, res) => {
      if (req.headers.authorization) {
        proxyReq.setHeader("Authorization", req.headers.authorization);
      }
      
      if (env.GATEWAY_INTERNAL_SECRET) {
        proxyReq.setHeader("X-Internal-Gateway-Secret", env.GATEWAY_INTERNAL_SECRET);
      }
      
      logger.info(`[${serviceName.toUpperCase()}] Proxying request: ${req.method} ${req.originalUrl.replace(`/api/${serviceName}`, "/api/v1")}`);
    },
    onError: (err, req, res) => {
      logger.error(`[${serviceName.toUpperCase()}] Proxy routing failed`, { error: err.message });
      res.status(502).json({ error: `${serviceName} service is currently unavailable.` });
    }
  });
}

// Mounts all registered microservices to the Express app
function setupProxies(app) {
  // Developers simply add their new service to this array
  const services = [
    { name: "hanapgawa", url: env.HANAPGAWA_SERVICE_URL || "http://localhost:4000" },
    { name: "transportation", url: env.TRANSPORT_SERVICE_URL || "http://localhost:4001" },
    { name: "tourism", url: env.TOURISM_SERVICE_URL || "http://localhost:4002" }
  ];

  services.forEach((service) => {
    const proxy = createServiceProxy(service.name, service.url);
    if (proxy) {
      app.use(`/api/${service.name}`, proxy);
      logger.info(`Mounted proxy route: /api/${service.name} -> ${service.url}`);
    }
  });
}

module.exports = setupProxies;