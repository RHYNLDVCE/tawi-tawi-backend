const axios = require("axios");
const env = require("../config/env");
const logger = require("../utils/logger");
const AppError = require("../utils/AppError");
const http = require("http");
const https = require("https");

const axiosInstance = axios.create({
  httpAgent: new http.Agent({ keepAlive: true }),
  httpsAgent: new https.Agent({ keepAlive: true }),
  timeout: 5000,
});

// Map available microservices and associated configurations
const SERVICES = {
  transportation: {
    url: env.TRANSPORT_SERVICE_URL,
    internalSecret: env.GATEWAY_INTERNAL_SECRET,
  },
  tourism: {
    url: env.TOURISM_SERVICE_URL,
    internalSecret: env.GATEWAY_INTERNAL_SECRET,
  },
  hanapgawa: {
    url: env.HANAPGAWA_SERVICE_URL,
    internalSecret: env.GATEWAY_INTERNAL_SECRET,
  },
  shu: {
    url: env.SHU_SERVICE_URL,
    internalSecret: env.GATEWAY_INTERNAL_SECRET,
  },
  ecommerce: {
    url: env.ECOMMERCE_SERVICE_URL,
    internalSecret: env.GATEWAY_INTERNAL_SECRET,
  },
};

async function checkUserInExternalService(serviceName, user) {
  const serviceConfig = SERVICES[serviceName.toLowerCase()];

  if (!serviceConfig) {
    throw new AppError(`Service configuration for "${serviceName}" not found.`, 404);
  }

  logger.info(`Initiating B2B handshake with target service: ${serviceName}`, { userId: user.id });

  try {
    // Send a secure POST request to the external service internal verification endpoint
    const response = await axiosInstance.post(
      `${serviceConfig.url}/verify-user`,
      {
        tawiTawiUserId: user.id,
        email: user.email,
        fullName: user.fullName,
      },
      {
        headers: {
          "X-Internal-Gateway-Secret": serviceConfig.internalSecret,
          "Content-Type": "application/json",
        },
      }
    );

    logger.info(`B2B handshake response received from ${serviceName}`, { 
      userId: user.id, 
      isLinked: response.data?.isLinked || false,
      requiresRegistration: response.data?.requiresRegistration || false
    });

    return {
      isLinked: response.data?.isLinked || false,
      requiresRegistration: response.data?.requiresRegistration || false,
      externalUserId: response.data?.externalUserId || null,
    };
  } catch (error) {
    // Extract precise Axios network or response error details
    const issue = error.response ? `Status: ${error.response.status}` : error.message;
    logger.error(`B2B handshake failed for service: ${serviceName}. Reason: ${issue}`, { error: error.message });
    
    return {
      isLinked: false,
      requiresRegistration: false,
      externalUserId: null,
    };
  }
}

async function registerUserInExternalService(serviceName, user, extraDataString) {
  const serviceConfig = SERVICES[serviceName.toLowerCase()];
  
  if (!serviceConfig) {
    throw new AppError(`Service configuration for "${serviceName}" not found.`, 404);
  }

  // Parse the JSON string of extra fields sent from the UI
  const extraFields = JSON.parse(extraDataString || "{}");

  logger.info(`Initiating B2B registration with target service: ${serviceName}`, { userId: user.id });

  try {
    const response = await axiosInstance.post(
      `${serviceConfig.url}/register-user`,
      {
        tawiTawiUserId: user.id,
        email: user.email,
        fullName: user.fullName,
        ...extraFields 
      },
      { 
        headers: { 
          "X-Internal-Gateway-Secret": serviceConfig.internalSecret,
          "Content-Type": "application/json",
        },
      }
    );

    // Return an object containing both the success status and the new external ID
    return {
      isLinked: response.data?.isLinked || false,
      externalUserId: response.data?.externalUserId || null,
    };
  } catch (error) {
    // Check if it is an Axios network error vs a standard error
    const issue = error.response ? `Status: ${error.response.status}` : error.message;
    logger.error(`B2B registration failed for service: ${serviceName}. Reason: ${issue}`, { error: error.message });
    
    // Throw a 503 Service Unavailable so the client knows it is a network/target issue
    throw new AppError(`The ${serviceName} service is currently unreachable. Please try again later.`, 503);
  }
}

module.exports = {
  checkUserInExternalService,
  registerUserInExternalService,
};