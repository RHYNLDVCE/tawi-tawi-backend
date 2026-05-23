const { getMongoDb } = require('../../../database/mongodb');
const { HttpError } = require('../../../lib/http-error');

const COLLECTION = 'provider_profiles';

function requireMongo() {
  const db = getMongoDb();
  if (!db) throw new HttpError(503, 'MongoDB is not configured. Set MONGODB_URL first.');
  return db;
}

let indexesEnsured = false;
async function ensureIndexes(db) {
  if (indexesEnsured) return;
  const col = db.collection(COLLECTION);
  await col.createIndex({ providerUserId: 1 }, { unique: true, sparse: true });
  await col.createIndex({ municipalities: 1 });
  await col.createIndex({ skills: 1 });
  indexesEnsured = true;
}

function toProfile(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
}

async function upsertProviderProfile(providerUserId, fields) {
  const db = requireMongo();
  await ensureIndexes(db);
  const now = new Date();
  const result = await db.collection(COLLECTION).findOneAndUpdate(
    { providerUserId },
    {
      $set: { ...fields, providerUserId, updatedAt: now },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true, returnDocument: 'after' },
  );
  return toProfile(result);
}

async function getProviderProfile(providerUserId) {
  const db = requireMongo();
  await ensureIndexes(db);
  const doc = await db.collection(COLLECTION).findOne({ providerUserId });
  return toProfile(doc);
}

async function searchProviderProfiles({ municipality, skill, keyword } = {}) {
  const db = requireMongo();
  await ensureIndexes(db);
  const filter = {};
  if (municipality) filter.municipalities = String(municipality);
  if (skill)        filter.skills         = { $regex: String(skill), $options: 'i' };
  if (keyword) {
    const rx = { $regex: String(keyword), $options: 'i' };
    filter.$or = [{ bio: rx }, { skills: rx }];
  }
  const docs = await db.collection(COLLECTION)
    .find(filter)
    .sort({ updatedAt: -1 })
    .limit(50)
    .toArray();
  return docs.map(toProfile);
}

module.exports = { upsertProviderProfile, getProviderProfile, searchProviderProfiles };
