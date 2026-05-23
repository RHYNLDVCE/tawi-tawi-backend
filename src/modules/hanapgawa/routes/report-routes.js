const express = require('express');
const { z } = require('zod');

const { asyncHandler } = require('../../../lib/async-handler');
const { HttpError } = require('../../../lib/http-error');
const { hanapgawaAuth } = require('../../../middleware/hanapgawa-auth.middleware');
const { createReport } = require('../repositories/report-repository');

const router = express.Router();

const reportSchema = z.object({
  providerUserId: z.string().uuid().optional(),
  bookingId:      z.string().uuid().optional(),
  contentType:    z.enum(['social_post']).optional(),
  contentId:      z.string().max(64).optional(),
  reason:         z.string().min(3).max(160),
  details:        z.string().max(1500).optional().default(''),
}).refine(
  (d) => d.providerUserId || d.bookingId || (d.contentType && d.contentId),
  { message: 'Report must target a provider, booking, or content item.' },
);

// POST /reports — any authenticated user may file a report
router.post(
  '/',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const payload = reportSchema.safeParse(req.body);
    if (!payload.success) throw new HttpError(400, 'Invalid report payload.', payload.error.flatten());

    const report = await createReport({
      reporterUserId: req.auth.sub,
      providerUserId: payload.data.providerUserId,
      bookingId:      payload.data.bookingId,
      contentType:    payload.data.contentType,
      contentId:      payload.data.contentId,
      reason:         payload.data.reason,
      details:        payload.data.details,
    });

    res.status(201).json({ report });
  }),
);

module.exports = { reportRoutes: router };
