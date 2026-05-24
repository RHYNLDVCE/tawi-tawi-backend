const { getSession } = require("../../database/neo4j");

async function createUser(userData) {
  const session = getSession();

  try {
    const result = await session.executeWrite((tx) =>
      tx.run(
        `
        CREATE (u:User {
          id: $id,
          fullName: $fullName,
          email: $email,
          status: $status,
          createdAt: $createdAt,
          updatedAt: $updatedAt
        })

        FOREACH (_ IN CASE WHEN $passwordHash IS NULL THEN [] ELSE [1] END |
          SET u.passwordHash = $passwordHash
        )

        RETURN u
        `,
        userData
      )
    );

    return result.records[0]?.get("u") || null;
  } finally {
    await session.close();
  }
}

async function findUserByEmail(email) {
  const session = getSession();

  try {
    const result = await session.executeRead((tx) =>
      tx.run(
        `
        MATCH (u:User { email: $email })
        RETURN u
        LIMIT 1
        `,
        {
          email: email.toLowerCase(),
        }
      )
    );

    return result.records[0]?.get("u") || null;
  } finally {
    await session.close();
  }
}

async function findUserById(id) {
  const session = getSession();

  try {
    const result = await session.executeRead((tx) =>
      tx.run(
        `
        MATCH (u:User { id: $id })
        RETURN u
        LIMIT 1
        `,
        { id }
      )
    );

    return result.records[0]?.get("u") || null;
  } finally {
    await session.close();
  }
}

async function updateUserById(id, updateData) {
  const session = getSession();

  try {
    const result = await session.executeWrite((tx) =>
      tx.run(
        `
        MATCH (u:User { id: $id })
        SET 
          u.fullName = coalesce($fullName, u.fullName),
          u.updatedAt = $updatedAt
        RETURN u
        `,
        {
          id,
          fullName: updateData.fullName || null,
          updatedAt: updateData.updatedAt,
        }
      )
    );

    return result.records[0]?.get("u") || null;
  } finally {
    await session.close();
  }
}


async function linkServiceToUser(userId, serviceName, localId) {
  const session = getSession();

  try {
    const result = await session.executeWrite((tx) =>
      tx.run(
        `
        MATCH (u:User { id: $userId })
        // Create the service account node if it doesn't exist
        MERGE (s:ServiceAccount { service: $serviceName, localId: $localId })
        // Create the relationship
        MERGE (u)-[r:LINKED_TO]->(s)
        RETURN s
        `,
        {
          userId,
          serviceName: serviceName.toLowerCase(),
          localId,
        }
      )
    );

    return result.records[0]?.get("s") || null;
  } finally {
    await session.close();
  }
}

async function getLinkedServiceId(userId, serviceName) {
  const session = getSession();

  try {
    const result = await session.executeRead((tx) =>
      tx.run(
        `
        MATCH (u:User { id: $userId })-[:LINKED_TO]->(s:ServiceAccount { service: $serviceName })
        RETURN s.localId AS localId
        LIMIT 1
        `,
        {
          userId,
          serviceName: serviceName.toLowerCase(),
        }
      )
    );

    return result.records[0]?.get("localId") || null;
  } finally {
    await session.close();
  }
}

module.exports = {
  createUser,
  findUserByEmail,
  findUserById,
  updateUserById,
  linkServiceToUser,
  getLinkedServiceId
};