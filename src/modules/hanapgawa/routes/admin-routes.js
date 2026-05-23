const express = require('express');
const { z } = require('zod');
const { ObjectId } = require('mongodb');

const { asyncHandler } = require('../../../lib/async-handler');
const { HttpError } = require('../../../lib/http-error');
const { hanapgawaAuth } = require('../../../middleware/hanapgawa-auth.middleware');
const { getHanapgawaPool } = require('../../../database/hanapgawa-postgres');
const { getMongoDb } = require('../../../database/mongodb');
const { createNotification } = require('../../../lib/notifications');

const { findUserById, listAllUsersForAdmin, listUsersByRoles, updateUserStatus } = require('../repositories/user-repository');
const { listReports, updateReportStatus } = require('../repositories/report-repository');
const { getAllBookings } = require('../services/booking-service');
const { getCategories, addCategory, editCategory } = require('../services/category-service');

const router = express.Router();

// All admin routes require authentication AND admin role
router.use(hanapgawaAuth);
router.use((req, _res, next) => {
  if (req.auth.role !== 'admin') return next(new HttpError(403, 'Admin access required.'));
  next();
});

// ─── Dashboard ────────────────────────────────────────────────────────────────

router.get(
  '/summary',
  asyncHandler(async (_req, res) => {
    const pool = getHanapgawaPool();
    if (!pool) return res.json({ summary: { totalUsers: 0, pendingVerifications: 0, completedJobs: 0, pendingReports: 0, suspendedUsers: 0 } });

    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*)::INT FROM users)                                          AS "totalUsers",
        (SELECT COUNT(*)::INT FROM users WHERE status = 'approved')               AS "verifiedUsers",
        (SELECT COUNT(*)::INT FROM users WHERE status = 'pending')                AS "pendingVerifications",
        (SELECT COUNT(*)::INT FROM bookings WHERE status = 'completed')           AS "completedJobs",
        (SELECT COUNT(*)::INT FROM reports WHERE status = 'pending')              AS "pendingReports",
        (SELECT COUNT(*)::INT FROM users WHERE status IN ('suspended', 'banned')) AS "suspendedUsers"
    `);

    res.json({ summary: result.rows[0] });
  }),
);

// ─── Users ────────────────────────────────────────────────────────────────────

router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const users = await listAllUsersForAdmin(req.query.search ? String(req.query.search) : '');
    res.json({ users });
  }),
);

router.patch(
  '/users/:userId/status',
  asyncHandler(async (req, res) => {
    const userId = z.string().uuid().safeParse(req.params.userId);
    if (!userId.success) throw new HttpError(400, 'Invalid user id.');

    const payload = z.object({
      status: z.enum(['approved', 'rejected', 'pending', 'suspended', 'banned']),
    }).safeParse(req.body);
    if (!payload.success) throw new HttpError(400, 'Invalid status payload.');

    const user = await findUserById(userId.data);
    if (!user) throw new HttpError(404, 'User not found.');
    if (user.role === 'admin') throw new HttpError(409, 'Admin accounts cannot be changed here.');

    const updated = await updateUserStatus(user.id, payload.data.status);
    res.json({ user: updated });
  }),
);

router.delete(
  '/users/:userId',
  asyncHandler(async (req, res) => {
    const userId = z.string().uuid().safeParse(req.params.userId);
    if (!userId.success) throw new HttpError(400, 'Invalid user id.');

    const pool = getHanapgawaPool();
    if (!pool) throw new HttpError(503, 'Database unavailable.');

    const user = await findUserById(userId.data);
    if (!user) throw new HttpError(404, 'User not found.');
    if (user.role === 'admin') throw new HttpError(403, 'Admin accounts cannot be deleted here.');

    await pool.query('DELETE FROM users WHERE id = $1', [userId.data]);
    res.json({ deleted: true, user });
  }),
);

// ─── Providers ────────────────────────────────────────────────────────────────

router.get(
  '/providers',
  asyncHandler(async (req, res) => {
    const status = req.query.status ? String(req.query.status) : undefined;
    const providers = await listUsersByRoles(['worker', 'agency'], status);
    res.json({ providers });
  }),
);

router.patch(
  '/providers/:userId/status',
  asyncHandler(async (req, res) => {
    const userId = z.string().uuid().safeParse(req.params.userId);
    if (!userId.success) throw new HttpError(400, 'Invalid user id.');

    const payload = z.object({
      status: z.enum(['approved', 'rejected', 'pending']),
    }).safeParse(req.body);
    if (!payload.success) throw new HttpError(400, 'Invalid approval payload.');

    const user = await findUserById(userId.data);
    if (!user) throw new HttpError(404, 'User not found.');
    if (!['worker', 'agency'].includes(user.role)) {
      throw new HttpError(409, 'Only worker and agency accounts can be approved here.');
    }

    const updated = await updateUserStatus(user.id, payload.data.status);
    res.json({ user: updated });
  }),
);

// ─── Bookings ─────────────────────────────────────────────────────────────────

router.get(
  '/bookings',
  asyncHandler(async (req, res) => {
    const bookings = await getAllBookings(req.query.status ? String(req.query.status) : undefined);
    res.json({ bookings });
  }),
);

// ─── Posts (MongoDB) ──────────────────────────────────────────────────────────

router.get(
  '/posts',
  asyncHandler(async (_req, res) => {
    const db = getMongoDb();
    if (!db) return res.json({ posts: [] });

    const docs = await db.collection('social_posts')
      .find({ status: 'active' })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    const posts = docs.map((d) => ({
      id:           d._id.toString(),
      userId:       d.userId,
      userRole:     d.userRole,
      content:      d.content,
      media:        d.media   || [],
      tags:         d.tags    || [],
      municipality: d.municipality || null,
      likeCount:    d.likeCount    || 0,
      commentCount: d.commentCount || 0,
      createdAt:    d.createdAt,
    }));

    res.json({ posts });
  }),
);

router.delete(
  '/posts/:postId',
  asyncHandler(async (req, res) => {
    const db = getMongoDb();
    if (!db) throw new HttpError(503, 'Database unavailable.');

    if (!ObjectId.isValid(req.params.postId)) throw new HttpError(400, 'Invalid post id.');
    const oid = new ObjectId(req.params.postId);

    const post = await db.collection('social_posts').findOne(
      { _id: oid, status: 'active' },
      { projection: { userId: 1 } },
    );
    if (!post) throw new HttpError(404, 'Post not found.');

    await db.collection('social_posts').updateOne(
      { _id: oid },
      { $set: { status: 'deleted', updatedAt: new Date() } },
    );

    // Notify the post owner — non-fatal
    const pool = getHanapgawaPool();
    if (pool && post.userId) {
      createNotification(pool, {
        userId:    post.userId,
        actorId:   req.auth.sub,
        actorName: 'HanapGawa Admin',
        type:      'content_removed',
        title:     'Your post was removed',
        body:      'Your post was removed for violating HanapGawa community guidelines.',
        linkType:  null,
        linkId:    null,
      }).catch(() => {});
    }

    res.json({ deleted: true });
  }),
);

// ─── Reviews ──────────────────────────────────────────────────────────────────

router.get(
  '/reviews',
  asyncHandler(async (_req, res) => {
    const pool = getHanapgawaPool();
    if (!pool) return res.json({ reviews: [] });

    const result = await pool.query(`
      SELECT
        r.id,
        r.booking_id        AS "bookingId",
        r.reviewer_user_id  AS "reviewerUserId",
        ru.full_name        AS "reviewerName",
        r.provider_user_id  AS "reviewedUserId",
        rv.full_name        AS "reviewedName",
        r.rating,
        r.comment,
        r.created_at        AS "createdAt"
      FROM   reviews r
      LEFT   JOIN users ru ON ru.id = r.reviewer_user_id
      LEFT   JOIN users rv ON rv.id = r.provider_user_id
      ORDER  BY r.created_at DESC
      LIMIT  100
    `);

    res.json({ reviews: result.rows });
  }),
);

router.delete(
  '/reviews/:reviewId',
  asyncHandler(async (req, res) => {
    const reviewId = z.string().uuid().safeParse(req.params.reviewId);
    if (!reviewId.success) throw new HttpError(400, 'Invalid review id.');

    const pool = getHanapgawaPool();
    if (!pool) throw new HttpError(503, 'Database unavailable.');

    const result = await pool.query(
      'DELETE FROM reviews WHERE id = $1 RETURNING id',
      [reviewId.data],
    );
    if (!result.rows.length) throw new HttpError(404, 'Review not found.');
    res.json({ deleted: true });
  }),
);

// ─── Categories ───────────────────────────────────────────────────────────────

router.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    const categories = await getCategories(false);
    res.json({ categories });
  }),
);

router.post(
  '/categories',
  asyncHandler(async (req, res) => {
    const payload = z.object({
      name:        z.string().min(2).max(80),
      description: z.string().max(240).optional().default(''),
      icon:        z.string().max(80).optional().default('briefcase-outline'),
    }).safeParse(req.body);
    if (!payload.success) throw new HttpError(400, 'Invalid category payload.', payload.error.flatten());

    const category = await addCategory(payload.data);
    res.status(201).json({ category });
  }),
);

router.patch(
  '/categories/:categoryId',
  asyncHandler(async (req, res) => {
    const categoryId = z.string().uuid().safeParse(req.params.categoryId);
    if (!categoryId.success) throw new HttpError(400, 'Invalid category id.');

    const payload = z.object({
      name:        z.string().min(2).max(80).optional(),
      description: z.string().max(240).optional(),
      icon:        z.string().max(80).optional(),
      active:      z.boolean().optional(),
    }).safeParse(req.body);
    if (!payload.success) throw new HttpError(400, 'Invalid category payload.', payload.error.flatten());

    // Fetch current values so partial updates don't wipe fields
    const existing = await getCategories(false);
    const current  = existing.find((c) => c.id === categoryId.data);
    if (!current) throw new HttpError(404, 'Category not found.');

    const category = await editCategory({
      id:          categoryId.data,
      name:        payload.data.name        ?? current.name,
      description: payload.data.description ?? current.description ?? '',
      icon:        payload.data.icon        ?? current.icon        ?? 'briefcase-outline',
      active:      payload.data.active      ?? current.active,
    });
    res.json({ category });
  }),
);

// ─── Service listings (MongoDB) ───────────────────────────────────────────────

router.get(
  '/service-listings',
  asyncHandler(async (_req, res) => {
    const db = getMongoDb();
    if (!db) return res.json({ listings: [] });

    const docs = await db.collection('service_listings')
      .find({})
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();

    const listings = docs.map((l) => ({
      id:             l._id.toString(),
      providerUserId: l.providerUserId,
      title:          l.title,
      category:       l.category,
      municipality:   l.municipality,
      status:         l.status   || 'active',
      priceMin:       l.priceMin || null,
      priceMax:       l.priceMax || null,
      createdAt:      l.createdAt,
    }));

    res.json({ listings });
  }),
);

router.delete(
  '/service-listings/:listingId',
  asyncHandler(async (req, res) => {
    const db = getMongoDb();
    if (!db) throw new HttpError(503, 'Database unavailable.');

    if (!ObjectId.isValid(req.params.listingId)) throw new HttpError(400, 'Invalid listing id.');
    const result = await db.collection('service_listings')
      .deleteOne({ _id: new ObjectId(req.params.listingId) });

    if (!result.deletedCount) throw new HttpError(404, 'Listing not found.');
    res.json({ deleted: true });
  }),
);

// ─── Jobs ─────────────────────────────────────────────────────────────────────

router.delete(
  '/jobs/:jobId',
  asyncHandler(async (req, res) => {
    const jobId = z.string().uuid().safeParse(req.params.jobId);
    if (!jobId.success) throw new HttpError(400, 'Invalid job id.');

    const pool = getHanapgawaPool();
    if (!pool) throw new HttpError(503, 'Database unavailable.');

    const result = await pool.query(
      'DELETE FROM job_posts WHERE id = $1 RETURNING id',
      [jobId.data],
    );
    if (!result.rows.length) throw new HttpError(404, 'Job post not found.');
    res.json({ deleted: true });
  }),
);

// ─── Reports ──────────────────────────────────────────────────────────────────

router.get(
  '/reports',
  asyncHandler(async (req, res) => {
    const status = req.query.status ? String(req.query.status) : undefined;
    const reports = await listReports(status);
    res.json({ reports });
  }),
);

router.patch(
  '/reports/:reportId',
  asyncHandler(async (req, res) => {
    const reportId = z.string().uuid().safeParse(req.params.reportId);
    if (!reportId.success) throw new HttpError(400, 'Invalid report id.');

    const payload = z.object({
      status: z.enum(['resolved', 'dismissed', 'pending']),
    }).safeParse(req.body);
    if (!payload.success) throw new HttpError(400, 'Invalid report status payload.');

    const report = await updateReportStatus(reportId.data, payload.data.status);
    if (!report) throw new HttpError(404, 'Report not found.');
    res.json({ report });
  }),
);

module.exports = { adminRoutes: router };
