const neo4j = require("neo4j-driver");
const env = require("../config/env");
const logger = require("../utils/logger");

const driver = neo4j.driver(
  env.NEO4J_URI,
  neo4j.auth.basic(env.NEO4J_USERNAME, env.NEO4J_PASSWORD)
);

// Automate the creation of database constraints and indexes
async function initializeConstraints() {
  const session = driver.session();
  try {
    await session.executeWrite((tx) =>
      tx.run(`CREATE CONSTRAINT user_email_unique IF NOT EXISTS FOR (u:User) REQUIRE u.email IS UNIQUE`)
    );
    
    await session.executeWrite((tx) =>
      tx.run(`CREATE CONSTRAINT user_id_unique IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE`)
    );
    
    logger.info("Neo4j database constraints initialized successfully.");
  } catch (error) {
    logger.error("Failed to initialize Neo4j constraints", error);
    throw error;
  } finally {
    await session.close();
  }
}

async function verifyNeo4jConnection() {
  await driver.verifyConnectivity();
  logger.info("Neo4j connected successfully.");
  
  // Trigger constraints check during startup
  await initializeConstraints();
}

function getSession() {
  return driver.session();
}

async function closeNeo4jConnection() {
  await driver.close();
  logger.info("Neo4j connection closed.");
}

module.exports = {
  driver,
  getSession,
  verifyNeo4jConnection,
  closeNeo4jConnection,
};