const express = require('express');
const { z } = require('zod');

const { asyncHandler } = require('../../../lib/async-handler');
const { HttpError } = require('../../../lib/http-error');
const { hanapgawaAuth } = require('../../../middleware/hanapgawa-auth.middleware');
const { submitReview, getProviderReviews, getReviewsForUser } = require('../services/review-service');

const router = express.Router();

const reviewSchema = z.object({
  bookingId: z.uuid(),
  reviewedUserId: z.uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

// POST /reviews
router.post(
  '/',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    if (req.auth.role === 'admin') {
      throw new HttpError(403, 'Admins cannot submit reviews.');
    }

    const payload = reviewSchema.safeParse(req.body);
    if (!payload.success) {
      throw new HttpError(400, 'Invalid review payload.', payload.error.flatten());
    }

    const review = await submitReview({
      bookingId: payload.data.bookingId,
      reviewerUserId: req.auth.sub,
      reviewedUserId: payload.data.reviewedUserId,
      rating: payload.data.rating,
      comment: payload.data.comment,
    });

    res.status(201).json({ review });
  }),
);

// GET /reviews/provider/:providerUserId — public
router.get(
  '/provider/:providerUserId',
  asyncHandler(async (req, res) => {
    const providerUserId = z.uuid().safeParse(req.params.providerUserId);
    if (!providerUserId.success) throw new HttpError(400, 'Invalid provider user id.');

    const data = await getProviderReviews(providerUserId.data);
    res.json(data);
  }),
);

// GET /reviews/user/:userId — public
router.get(
  '/user/:userId',
  asyncHandler(async (req, res) => {
    const userId = z.uuid().safeParse(req.params.userId);
    if (!userId.success) throw new HttpError(400, 'Invalid user id.');

    const data = await getReviewsForUser(userId.data);
    res.json(data);
  }),
);

module.exports = { reviewRoutes: router };
