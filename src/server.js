const { app, startGateway } = require("./app");
const env = require("./config/env");
const logger = require("./utils/logger");
const {
  verifyNeo4jConnection,
  closeNeo4jConnection,
} = require("./database/neo4j");

async function startServer() {
  try {
    // 1. Connect to Database first
    await verifyNeo4jConnection();

    // 2. Initialize the Gateway (Keys, Proxies, GraphQL)
    await startGateway();

    // 3. ONLY start listening for traffic after everything is ready
    const server = app.listen(env.PORT, () => {
      logger.info(`Server running`, { port: env.PORT });
      logger.info(`API URL ready`, { url: `http://localhost:${env.PORT}/graphql` });
    });

    // 4. Preserve your graceful shutdown logic
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