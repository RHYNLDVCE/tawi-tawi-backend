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

const resolvers = {
  Query: {
    me: async (_, __, context) => {
      if (!context.user) throw new AppError("Authentication required", 401);
      return context.user;
    },
    verifyServiceAccess: async (_, { serviceName }, context) => {
      if (!context.user) throw new AppError("Authentication required", 401);

      const status = await checkUserInExternalService(serviceName, context.user);

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
    register: async (_, args) => {
      const validation = validateRegister(args);
      if (!validation.isValid) throw new AppError(validation.errors[0], 400);
      
      const result = await authService.registerPublicUser(validation.value);
      logger.info("New user registered via GraphQL", { userId: result.user.id });
      return result;
    },
    login: async (_, args) => {
      const validation = validateLogin(args);
      if (!validation.isValid) throw new AppError(validation.errors[0], 400);
      
      const result = await authService.loginPublicUser(validation.value);
      logger.info("User logged in via GraphQL", { userId: result.user.id });
      return result;
    },
    googleLogin: async (_, args) => {
      const validation = validateGoogleLogin(args);
      if (!validation.isValid) throw new AppError(validation.errors[0], 400);
      
      const result = await authService.loginWithGoogle(validation.value.idToken);
      logger.info("User logged in via Google (GraphQL)", { userId: result.user.id });
      return result;
    },
    metaLogin: async (_, args) => {
      const validation = validateMetaLogin(args);
      if (!validation.isValid) throw new AppError(validation.errors[0], 400);
      
      const result = await authService.loginWithMeta(validation.value.accessToken);
      logger.info("User logged in via Meta (GraphQL)", { userId: result.user.id });
      return result;
    },
    registerForService: async (_, { serviceName, payload }, context) => {
      if (!context.user) throw new AppError("Authentication required", 401);

      const isLinked = await registerUserInExternalService(serviceName, context.user, payload);

      return {
        serviceName,
        hasAccess: isLinked,
        requiresRegistration: !isLinked, 
        message: isLinked 
          ? `Successfully registered and linked to ${serviceName}.` 
          : `Registration failed for ${serviceName}.`
      };
    }
  },
};

module.exports = resolvers;