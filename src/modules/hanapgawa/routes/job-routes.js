const express = require('express');
const { z } = require('zod');

const { asyncHandler } = require('../../../lib/async-handler');
const { HttpError } = require('../../../lib/http-error');
const { hanapgawaAuth } = require('../../../middleware/hanapgawa-auth.middleware');
const { getHanapgawaPool } = require('../../../database/hanapgawa-postgres');
const { createNotification } = require('../../../lib/notifications');
const {
  chooseOffer,
  editJob,
  getJobDetail,
  getJobs,
  getMyOffers,
  postJob,
  rejectOffer,
  removeJob,
  sendOffer,
} = require('../services/job-service');

const router = express.Router();

const jobPostSchema = z.object({
  postType: z.enum(['looking_for_worker', 'offering_service']).default('looking_for_worker'),
  title: z.string().trim().min(2).max(120),
  category: z.preprocess((value) => (String(value || '').trim() || 'General'), z.string().min(2).max(80)),
  municipality: z.string().min(2).max(80),
  locationDetails: z.string().max(240).optional().default(''),
  description: z.preprocess((value) => (String(value || '').trim() || 'No additional details provided.'), z.string().min(3).max(1500)),
  budgetMin: z.coerce.number().min(0).optional(),
  budgetMax: z.coerce.number().min(0).optional(),
  workersNeeded: z.coerce.number().int().min(1).max(50).default(1),
  scheduledAt: z.iso.datetime().optional(),
  allowDirectBooking: z.boolean().default(false),
});

const offerSchema = z.object({
  message: z.string().min(1).max(1000),
  proposedPrice: z.number().min(0).optional(),
  media: z
    .array(
      z.object({
        imageUrl: z.string().min(1).max(2000000),
        caption: z.string().max(160).optional().default(''),
      }),
    )
    .max(3)
    .default([]),
});

// POST /jobs
router.post(
  '/',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const payload = jobPostSchema.safeParse(req.body);
    if (!payload.success) {
      throw new HttpError(400, 'Invalid job post payload.', payload.error.flatten());
    }
    const jobPost = await postJob({ auth: req.auth, ...payload.data });
    res.status(201).json({ jobPost });
  }),
);

// GET /jobs
router.get(
  '/',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const jobs = await getJobs({ auth: req.auth, status: req.query.status ? String(req.query.status) : undefined });
    res.json({ jobs });
  }),
);

// GET /jobs/offers/mine — must come before /:jobPostId
router.get(
  '/offers/mine',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const offers = await getMyOffers(req.auth);
    res.json({ offers });
  }),
);

// GET /jobs/:jobPostId
router.get(
  '/:jobPostId',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const jobPostId = z.uuid().safeParse(req.params.jobPostId);
    if (!jobPostId.success) throw new HttpError(400, 'Invalid job post id.');
    const data = await getJobDetail({ jobPostId: jobPostId.data, auth: req.auth });
    res.json(data);
  }),
);

// PUT /jobs/:jobPostId
router.put(
  '/:jobPostId',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const jobPostId = z.uuid().safeParse(req.params.jobPostId);
    if (!jobPostId.success) throw new HttpError(400, 'Invalid job post id.');
    const payload = jobPostSchema.safeParse(req.body);
    if (!payload.success) throw new HttpError(400, 'Invalid job post payload.', payload.error.flatten());
    const jobPost = await editJob({ jobPostId: jobPostId.data, auth: req.auth, ...payload.data });
    res.json({ jobPost });
  }),
);

// DELETE /jobs/:jobPostId
router.delete(
  '/:jobPostId',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const jobPostId = z.uuid().safeParse(req.params.jobPostId);
    if (!jobPostId.success) throw new HttpError(400, 'Invalid job post id.');
    await removeJob({ jobPostId: jobPostId.data, auth: req.auth });
    res.status(204).send();
  }),
);

// POST /jobs/:jobPostId/offers
router.post(
  '/:jobPostId/offers',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const jobPostId = z.uuid().safeParse(req.params.jobPostId);
    if (!jobPostId.success) throw new HttpError(400, 'Invalid job post id.');
    const payload = offerSchema.safeParse(req.body);
    if (!payload.success) throw new HttpError(400, 'Invalid offer payload.', payload.error.flatten());

    const offer = await sendOffer({ jobPostId: jobPostId.data, auth: req.auth, ...payload.data });

    // Notify the job poster — async, non-fatal
    (async () => {
      try {
        const pool = getHanapgawaPool();
        if (pool) {
          const providerRow = await pool.query(`SELECT full_name FROM users WHERE id = $1`, [req.auth.sub]);
          const providerName = providerRow.rows[0]?.full_name || 'Someone';
          const jobRow = await pool.query(`SELECT client_user_id FROM job_posts WHERE id = $1`, [offer.jobPostId]);
          if (jobRow.rows.length && jobRow.rows[0].client_user_id !== req.auth.sub) {
            await createNotification(pool, {
              userId: jobRow.rows[0].client_user_id,
              actorId: req.auth.sub,
              actorName: providerName,
              type: 'job_offer',
              title: `${providerName} sent you a job offer`,
              body: payload.data.message ? payload.data.message.slice(0, 100) : '',
              linkType: 'job',
              linkId: offer.jobPostId,
            });
          }
        }
      } catch { /* non-fatal */ }
    })();

    res.status(201).json({ offer });
  }),
);

// PATCH /jobs/:jobPostId/offers/:offerId/accept
router.patch(
  '/:jobPostId/offers/:offerId/accept',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const jobPostId = z.uuid().safeParse(req.params.jobPostId);
    const offerId = z.uuid().safeParse(req.params.offerId);
    if (!jobPostId.success || !offerId.success) throw new HttpError(400, 'Invalid job or offer id.');

    const result = await chooseOffer({ jobPostId: jobPostId.data, offerId: offerId.data, auth: req.auth });

    // Notify offer sender — async, non-fatal
    (async () => {
      try {
        const pool = getHanapgawaPool();
        if (pool && result.offer && result.jobPost) {
          const clientRow = await pool.query(`SELECT full_name FROM users WHERE id = $1`, [req.auth.sub]);
          const clientName = clientRow.rows[0]?.full_name || 'Someone';
          await createNotification(pool, {
            userId: result.offer.providerUserId,
            actorId: req.auth.sub,
            actorName: clientName,
            type: 'offer_accepted',
            title: `${clientName} accepted your offer`,
            body: `Your offer on "${result.jobPost.title}" was accepted.`,
            linkType: 'job',
            linkId: result.jobPost.id,
          });
        }
      } catch { /* non-fatal */ }
    })();

    res.json(result);
  }),
);

// PATCH /jobs/:jobPostId/offers/:offerId/decline
router.patch(
  '/:jobPostId/offers/:offerId/decline',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const jobPostId = z.uuid().safeParse(req.params.jobPostId);
    const offerId = z.uuid().safeParse(req.params.offerId);
    if (!jobPostId.success || !offerId.success) throw new HttpError(400, 'Invalid job or offer id.');
    const result = await rejectOffer({ jobPostId: jobPostId.data, offerId: offerId.data, auth: req.auth });
    res.json({ offer: result });
  }),
);

// PATCH /jobs/:jobPostId/reopen
router.patch(
  '/:jobPostId/reopen',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const jobPostId = z.uuid().safeParse(req.params.jobPostId);
    if (!jobPostId.success) throw new HttpError(400, 'Invalid job post id.');

    const pool = getHanapgawaPool();
    if (!pool) throw new HttpError(503, 'Database unavailable.');

    const ownerCheck = await pool.query(
      `SELECT id, client_user_id, status FROM job_posts WHERE id = $1`,
      [jobPostId.data],
    );
    if (!ownerCheck.rows.length) throw new HttpError(404, 'Job post not found.');
    const job = ownerCheck.rows[0];
    if (job.client_user_id !== req.auth.sub) throw new HttpError(403, 'Only the job owner can reopen it.');
    if (!['cancelled', 'assigned', 'rejected'].includes(job.status)) {
      throw new HttpError(400, `Cannot reopen a job with status "${job.status}".`);
    }

    await pool.query(
      `UPDATE job_posts SET status = 'open', assigned_provider_user_id = NULL, updated_at = NOW() WHERE id = $1`,
      [jobPostId.data],
    );
    await pool.query(
      `UPDATE job_offers SET status = 'pending', updated_at = NOW() WHERE job_post_id = $1 AND status IN ('accepted', 'rejected')`,
      [jobPostId.data],
    );

    const updated = await pool.query(`SELECT id, status FROM job_posts WHERE id = $1`, [jobPostId.data]);
    res.json({ jobPost: updated.rows[0] });
  }),
);

module.exports = { jobRoutes: router };
