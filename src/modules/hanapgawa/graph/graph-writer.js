const { getSession } = require('../../../database/neo4j');

async function mergeUserNode({ id, fullName, email }) {
  const session = getSession();
  try {
    await session.executeWrite((tx) =>
      tx.run(
        `MERGE (u:User {id: $id})
         SET u.fullName = $fullName, u.email = $email`,
        { id, fullName: fullName || '', email: email || '' },
      ),
    );
  } catch { /* non-fatal */ } finally {
    await session.close();
  }
}

async function mergeJobNode({ id, title, category, municipality, clientUserId }) {
  const session = getSession();
  try {
    await session.executeWrite((tx) =>
      tx.run(
        `MERGE (j:Job {id: $id})
         SET j.title = $title, j.category = $category, j.municipality = $municipality
         WITH j
         MATCH (u:User {id: $clientUserId})
         MERGE (u)-[:POSTED_JOB]->(j)`,
        { id, title: title || '', category: category || '', municipality: municipality || '', clientUserId },
      ),
    );
  } catch { /* non-fatal */ } finally {
    await session.close();
  }
}

async function writeHiredRelationship(clientId, workerId, bookingId) {
  const session = getSession();
  try {
    await session.executeWrite((tx) =>
      tx.run(
        `MATCH (client:User {id: $clientId}), (worker:User {id: $workerId})
         MERGE (client)-[r:HIRED {bookingId: $bookingId}]->(worker)`,
        { clientId, workerId, bookingId },
      ),
    );
  } catch { /* non-fatal */ } finally {
    await session.close();
  }
}

async function writeWorkedForRelationship(workerId, clientId, bookingId) {
  const session = getSession();
  try {
    await session.executeWrite((tx) =>
      tx.run(
        `MATCH (worker:User {id: $workerId}), (client:User {id: $clientId})
         MERGE (worker)-[r:WORKED_FOR {bookingId: $bookingId}]->(client)`,
        { workerId, clientId, bookingId },
      ),
    );
  } catch { /* non-fatal */ } finally {
    await session.close();
  }
}

async function writeReviewedRelationship(reviewerId, reviewedId, rating, bookingId) {
  const session = getSession();
  try {
    await session.executeWrite((tx) =>
      tx.run(
        `MATCH (reviewer:User {id: $reviewerId}), (reviewed:User {id: $reviewedId})
         MERGE (reviewer)-[r:REVIEWED {bookingId: $bookingId}]->(reviewed)
         SET r.rating = $rating`,
        { reviewerId, reviewedId, rating, bookingId },
      ),
    );
  } catch { /* non-fatal */ } finally {
    await session.close();
  }
}

async function deleteJobNode(jobId) {
  const session = getSession();
  try {
    await session.executeWrite((tx) =>
      tx.run(
        `MATCH (j:Job {id: $jobId}) DETACH DELETE j`,
        { jobId },
      ),
    );
  } catch { /* non-fatal */ } finally {
    await session.close();
  }
}

module.exports = {
  mergeUserNode,
  mergeJobNode,
  writeHiredRelationship,
  writeWorkedForRelationship,
  writeReviewedRelationship,
  deleteJobNode,
};
