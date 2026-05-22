const app = require("./app");
const env = require("./config/env");
const logger = require("./utils/logger");
const {
  verifyNeo4jConnection,
  closeNeo4jConnection,
} = require("./database/neo4j");

async function startServer() {
  try {
    await verifyNeo4jConnection();

    const server = app.listen(env.PORT, () => {
      logger.info(`Server running`, { port: env.PORT });
      logger.info(`API URL ready`, { url: `http://localhost:${env.PORT}/graphql` });
    });

    process.on("SIGINT", async () => {
      logger.info("Initiating graceful shutdown...");
      server.close(async () => {
        await closeNeo4jConnection();
        logger.info("Server terminated successfully.");
        process.exit(0);
      });
    });
  } catch (error) {
    logger.error("Failed to start server", error);
    process.exit(1);
  }
}

startServer();