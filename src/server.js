const app = require("./app");
const env = require("./config/env");
const logger = require("./utils/logger");
const {
  verifyNeo4jConnection,
  closeNeo4jConnection,
} = require("./database/neo4j");
const { initHanapgawaDb, closeHanapgawaDb } = require("./database/hanapgawa-postgres");
const { initMongo, closeMongo } = require("./database/mongodb");
const { initRedis, closeRedis } = require("./database/redis");

async function startServer() {
  try {
    await verifyNeo4jConnection();

    await initHanapgawaDb(); // non-throwing — server starts even if PG is unavailable
    await initMongo();        // non-throwing — server starts even if MongoDB is unavailable
    await initRedis();        // non-throwing — server starts even if Redis is unavailable

    const server = app.listen(env.PORT, () => {
      logger.info(`Server running`, { port: env.PORT });
      logger.info(`GraphQL API ready`, { url: `http://localhost:${env.PORT}/graphql` });
      logger.info(`HanapGawa REST ready`, { url: `http://localhost:${env.PORT}/api/v1` });
    });

    process.on("SIGINT", async () => {
      logger.info("Initiating graceful shutdown...");
      server.close(async () => {
        await closeNeo4jConnection();
        await closeHanapgawaDb();
        await closeMongo();
        await closeRedis();
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
