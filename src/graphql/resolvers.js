const authService = require("../modules/auth/auth.service");
const userService = require("../modules/users/user.service");
const { checkUserInExternalService, registerUserInExternalService } = require("../gateway/serviceClients");
const { 
  validateRegister, 
  validateLogin, 
  validateGoogleLogin, 
  validateMetaLogin 
} = require("../modules/auth/auth.validation");
const AppError = require("../utils/AppError");
const logger = require("../utils/logger");
const { linkServiceToUser } = require("../modules/users/user.repository");
const resolvers = {
  Query: {
    me: async (_, __, context) => {
      if (!context.user) throw new AppError("Authentication required", 401);
      return context.user;
    },
    verifyServiceAccess: async (_, { serviceName }, context) => {
      if (!context.user) throw new AppError("Authentication required", 401);

      const status = await checkUserInExternalService(serviceName, context.user);

      if (status.isLinked && status.externalUserId) {
        await linkServiceToUser(context.user.id, serviceName, status.externalUserId);
        logger.info(`Successfully linked existing native account for ${serviceName}`, { userId: context.user.id });
      }

      return {
        serviceName,
        hasAccess: status.isLinked,
        requiresRegistration: status.requiresRegistration,
        message: status.isLinked 
          ? `Access granted to ${serviceName} service.` 
          : status.requiresRegistration 
            ? `Account not found. Please complete registration for ${serviceName}.` 
            : `Handshake failed for ${serviceName}.`,
      };
    },
  },
  Mutation: {
    // Extract context and pass context.privateKey down
    register: async (_, args, context) => {
      const validation = validateRegister(args);
      if (!validation.isValid) throw new AppError(validation.errors[0], 400);
      
      const result = await authService.registerPublicUser(validation.value, context.privateKey);
      logger.info("New user registered via GraphQL", { userId: result.user.id });
      return result;
    },
    login: async (_, args, context) => {
      const validation = validateLogin(args);
      if (!validation.isValid) throw new AppError(validation.errors[0], 400);
      
      const result = await authService.loginPublicUser(validation.value, context.privateKey);
      logger.info("User logged in via GraphQL", { userId: result.user.id });
      return result;
    },
    googleLogin: async (_, args, context) => {
      const validation = validateGoogleLogin(args);
      if (!validation.isValid) throw new AppError(validation.errors[0], 400);
      
      const result = await authService.loginWithGoogle(validation.value.idToken, context.privateKey);
      logger.info("User logged in via Google (GraphQL)", { userId: result.user.id });
      return result;
    },
    metaLogin: async (_, args, context) => {
      const validation = validateMetaLogin(args);
      if (!validation.isValid) throw new AppError(validation.errors[0], 400);
      
      const result = await authService.loginWithMeta(validation.value.accessToken, context.privateKey);
      logger.info("User logged in via Meta (GraphQL)", { userId: result.user.id });
      return result;
    },

    registerForService: async (_, { serviceName, payload }, context) => {
      if (!context.user) throw new AppError("Authentication required", 401);

      // result now contains both isLinked and externalUserId
      const result = await registerUserInExternalService(serviceName, context.user, payload);

      // Phase 2 Update: Save the mapping to Neo4j upon successful registration
      if (result.isLinked && result.externalUserId) {
        await linkServiceToUser(context.user.id, serviceName, result.externalUserId);
        logger.info(`Successfully registered and linked new account for ${serviceName}`, { userId: context.user.id });
      }

      // FIX: Use result.isLinked instead of the standalone isLinked variable
      return {
        serviceName,
        hasAccess: result.isLinked,
        requiresRegistration: !result.isLinked, 
        message: result.isLinked 
          ? `Successfully registered and linked to ${serviceName}.` 
          : `Registration failed for ${serviceName}.`
      };
    }
  },
};

module.exports = resolvers;