const { getSession } = require("../../database/neo4j");

async function findUserByAuthIdentity(provider, providerUserId) {
  const session = getSession();

  try {
    const result = await session.executeRead((tx) =>
      tx.run(
        `
        MATCH (u:User)-[:HAS_AUTH_IDENTITY]->(a:AuthIdentity {
          provider: $provider,
          providerUserId: $providerUserId
        })
        RETURN u
        LIMIT 1
        `,
        {
          provider,
          providerUserId,
        }
      )
    );

    return result.records[0]?.get("u") || null;
  } finally {
    await session.close();
  }
}

async function createAuthIdentityForUser(userId, identityData) {
  const session = getSession();

  try {
    const now = new Date().toISOString();

    const result = await session.executeWrite((tx) =>
      tx.run(
        `
        MATCH (u:User { id: $userId })

        MERGE (a:AuthIdentity {
          provider: $provider,
          providerUserId: $providerUserId
        })

        ON CREATE SET
          a.email = $email,
          a.fullName = $fullName,
          a.picture = $picture,
          a.createdAt = $createdAt

        SET
          a.updatedAt = $updatedAt

        MERGE (u)-[:HAS_AUTH_IDENTITY]->(a)

        RETURN u
        `,
        {
          userId,
          provider: identityData.provider,
          providerUserId: identityData.providerUserId,
          email: identityData.email || null,
          fullName: identityData.fullName || null,
          picture: identityData.picture || null,
          createdAt: now,
          updatedAt: now,
        }
      )
    );

    return result.records[0]?.get("u") || null;
  } finally {
    await session.close();
  }
}

module.exports = {
  findUserByAuthIdentity,
  createAuthIdentityForUser,
};