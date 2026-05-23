const { ObjectId } = require('mongodb');
const { getMongoDb } = require('../../../database/mongodb');
const { HttpError } = require('../../../lib/http-error');

const POSTS_COL    = 'social_posts';
const COMMENTS_COL = 'post_comments';

function requireMongo() {
  const db = getMongoDb();
  if (!db) throw new HttpError(503, 'MongoDB is not configured. Set MONGODB_URL first.');
  return db;
}

let indexesEnsured = false;
async function ensureIndexes(db) {
  if (indexesEnsured) return;
  const posts    = db.collection(POSTS_COL);
  const comments = db.collection(COMMENTS_COL);
  await posts.createIndex({ createdAt: -1 });
  await posts.createIndex({ userId: 1, createdAt: -1 });
  await posts.createIndex({ municipality: 1, createdAt: -1 });
  await posts.createIndex({ tags: 1 });
  await comments.createIndex({ postId: 1, createdAt: 1 });
  indexesEnsured = true;
}

function isValidId(id) {
  return ObjectId.isValid(id) && String(new ObjectId(id)) === id;
}

function toPost(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return { id: _id.toString(), ...rest };
}

function toComment(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return { id: _id.toString(), ...rest };
}

async function createPost({ userId, userRole, content, media, tags, municipality }) {
  const db = requireMongo();
  await ensureIndexes(db);
  const now = new Date();
  const doc = {
    userId,
    userRole,
    content,
    media:        media        || [],
    tags:         tags         || [],
    municipality: municipality || null,
    likedBy:      [],
    likeCount:    0,
    commentCount: 0,
    status:       'active',
    createdAt:    now,
    updatedAt:    now,
  };
  const result = await db.collection(POSTS_COL).insertOne(doc);
  return toPost({ _id: result.insertedId, ...doc });
}

async function listPosts({ municipality, tag, userId, before, limit = 20 } = {}) {
  const db = requireMongo();
  await ensureIndexes(db);
  const filter = { status: 'active' };
  if (municipality) filter.municipality = String(municipality);
  if (tag)          filter.tags          = String(tag);
  if (userId)       filter.userId        = String(userId);
  if (before && isValidId(before)) filter._id = { $lt: new ObjectId(before) };

  const docs = await db.collection(POSTS_COL)
    .find(filter)
    .sort({ _id: -1 })
    .limit(Math.min(limit, 50))
    .toArray();
  return docs.map(toPost);
}

async function getPostById(id) {
  if (!isValidId(id)) return null;
  const db = requireMongo();
  const doc = await db.collection(POSTS_COL).findOne({ _id: new ObjectId(id), status: 'active' });
  return toPost(doc);
}

async function softDeletePost(id) {
  if (!isValidId(id)) return false;
  const db = requireMongo();
  const result = await db.collection(POSTS_COL).updateOne(
    { _id: new ObjectId(id), status: 'active' },
    { $set: { status: 'deleted', updatedAt: new Date() } },
  );
  return result.modifiedCount > 0;
}

async function toggleLike(postId, userId) {
  if (!isValidId(postId)) return null;
  const db = requireMongo();
  const post = await db.collection(POSTS_COL).findOne(
    { _id: new ObjectId(postId), status: 'active' },
    { projection: { likedBy: 1 } },
  );
  if (!post) return null;

  const alreadyLiked = post.likedBy.includes(userId);
  const update = alreadyLiked
    ? { $pull: { likedBy: userId }, $inc: { likeCount: -1 } }
    : { $addToSet: { likedBy: userId }, $inc: { likeCount: 1 } };

  await db.collection(POSTS_COL).updateOne(
    { _id: new ObjectId(postId) },
    { ...update, $set: { updatedAt: new Date() } },
  );
  return { liked: !alreadyLiked };
}

async function createComment({ postId, userId, userRole, content }) {
  if (!isValidId(postId)) return null;
  const db = requireMongo();
  await ensureIndexes(db);
  const now = new Date();
  const doc = { postId, userId, userRole, content, status: 'active', createdAt: now };
  const [result] = await Promise.all([
    db.collection(COMMENTS_COL).insertOne(doc),
    db.collection(POSTS_COL).updateOne(
      { _id: new ObjectId(postId) },
      { $inc: { commentCount: 1 }, $set: { updatedAt: now } },
    ),
  ]);
  return toComment({ _id: result.insertedId, ...doc });
}

async function listComments(postId, { before, limit = 30 } = {}) {
  if (!isValidId(postId)) return [];
  const db = requireMongo();
  const filter = { postId, status: 'active' };
  if (before && isValidId(before)) filter._id = { $lt: new ObjectId(before) };
  const docs = await db.collection(COMMENTS_COL)
    .find(filter)
    .sort({ _id: -1 })
    .limit(Math.min(limit, 100))
    .toArray();
  return docs.map(toComment);
}

async function softDeleteComment(commentId, postId) {
  if (!isValidId(commentId)) return false;
  const db = requireMongo();
  const result = await db.collection(COMMENTS_COL).findOneAndUpdate(
    { _id: new ObjectId(commentId), postId, status: 'active' },
    { $set: { status: 'deleted' } },
  );
  if (result) {
    await db.collection(POSTS_COL).updateOne(
      { _id: new ObjectId(postId) },
      { $inc: { commentCount: -1 }, $set: { updatedAt: new Date() } },
    );
  }
  return Boolean(result);
}

module.exports = {
  createPost,
  listPosts,
  getPostById,
  softDeletePost,
  toggleLike,
  createComment,
  listComments,
  softDeleteComment,
};
