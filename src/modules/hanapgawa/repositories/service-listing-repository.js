const { ObjectId } = require('mongodb');
const { getMongoDb } = require('../../../database/mongodb');
const { HttpError } = require('../../../lib/http-error');

const COLLECTION = 'service_listings';

function requireMongo() {
  const db = getMongoDb();
  if (!db) throw new HttpError(503, 'MongoDB is not configured. Set MONGODB_URL first.');
  return db;
}

let indexesEnsured = false;
async function ensureIndexes(db) {
  if (indexesEnsured) return;
  const col = db.collection(COLLECTION);
  await col.createIndex({ providerUserId: 1, status: 1 });
  await col.createIndex({ category: 1, municipality: 1, status: 1 });
  await col.createIndex({ createdAt: -1 });
  indexesEnsured = true;
}

function toId(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return { id: _id.toString(), ...rest };
}

function isValidObjectId(id) {
  return ObjectId.isValid(id) && String(new ObjectId(id)) === id;
}

async function createServiceListing({
  providerUserId, providerRole, title, category, municipality,
  description, priceMin, priceMax, estimatedDuration,
  requirements, availability, media, allowDirectBooking,
}) {
  const db = requireMongo();
  await ensureIndexes(db);
  const now = new Date();
  const doc = {
    providerUserId,
    providerRole,
    title,
    category,
    municipality,
    description,
    priceMin:           priceMin  ?? null,
    priceMax:           priceMax  ?? null,
    estimatedDuration:  estimatedDuration || '',
    requirements:       requirements || [],
    availability:       availability  || [],
    media:              media         || [],
    allowDirectBooking: Boolean(allowDirectBooking),
    status:             'active',
    createdAt:          now,
    updatedAt:          now,
  };
  const result = await db.collection(COLLECTION).insertOne(doc);
  return toId({ _id: result.insertedId, ...doc });
}

async function listServiceListings({ category, municipality, keyword } = {}) {
  const db = requireMongo();
  await ensureIndexes(db);
  const filter = { status: 'active' };
  if (category)    filter.category    = String(category);
  if (municipality) filter.municipality = String(municipality);
  if (keyword) {
    const rx = { $regex: String(keyword), $options: 'i' };
    filter.$or = [{ title: rx }, { description: rx }];
  }
  const docs = await db.collection(COLLECTION)
    .find(filter)
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray();
  return docs.map(toId);
}

async function getServiceListingById(id) {
  if (!isValidObjectId(id)) return null;
  const db = requireMongo();
  const doc = await db.collection(COLLECTION).findOne({
    _id: new ObjectId(id),
    status: 'active',
  });
  return toId(doc);
}

async function listServiceListingsForProvider(providerUserId) {
  const db = requireMongo();
  const docs = await db.collection(COLLECTION)
    .find({ providerUserId, status: 'active' })
    .sort({ createdAt: -1 })
    .toArray();
  return docs.map(toId);
}

async function deleteServiceListingById(id) {
  if (!isValidObjectId(id)) return false;
  const db = requireMongo();
  const result = await db.collection(COLLECTION).deleteOne({ _id: new ObjectId(id) });
  return result.deletedCount > 0;
}

module.exports = {
  createServiceListing,
  listServiceListings,
  getServiceListingById,
  listServiceListingsForProvider,
  deleteServiceListingById,
};
