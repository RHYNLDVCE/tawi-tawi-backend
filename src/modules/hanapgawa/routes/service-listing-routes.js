const express = require('express');
const { z } = require('zod');

const { asyncHandler } = require('../../../lib/async-handler');
const { HttpError } = require('../../../lib/http-error');
const { hanapgawaAuth } = require('../../../middleware/hanapgawa-auth.middleware');
const {
  publishServiceListing,
  searchServiceListings,
  fetchServiceListingById,
  fetchMyListings,
  removeServiceListing,
} = require('../services/service-listing-service');

const router = express.Router();

const listingSchema = z.object({
  title:             z.string().min(3).max(120),
  category:          z.string().min(2).max(80),
  municipality:      z.string().min(2).max(80),
  description:       z.string().min(10).max(1500),
  priceMin:          z.coerce.number().nonnegative().optional(),
  priceMax:          z.coerce.number().nonnegative().optional(),
  estimatedDuration: z.string().max(120).optional().default(''),
  requirements:      z.array(z.string().min(1).max(160)).max(20).default([]),
  availability:      z.array(z.string().min(1).max(120)).max(12).default([]),
  media:             z.array(z.object({
    imageUrl: z.string().max(500),
    caption:  z.string().max(160).optional().default(''),
  })).max(20).default([]),
  allowDirectBooking: z.boolean().default(false),
});

// GET /service-listings/mine — auth required; MUST be before /:id
router.get(
  '/mine',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    if (req.auth.role === 'admin') throw new HttpError(403, 'Admins do not have service listings.');
    const listings = await fetchMyListings(req.auth);
    res.json({ listings });
  }),
);

// GET /service-listings — public
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const listings = await searchServiceListings({
      category:     req.query.category    ? String(req.query.category)    : undefined,
      municipality: req.query.municipality ? String(req.query.municipality) : undefined,
      keyword:      req.query.keyword      ? String(req.query.keyword)      : undefined,
    });
    res.json({ listings });
  }),
);

// POST /service-listings — auth required
router.post(
  '/',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const payload = listingSchema.safeParse(req.body);
    if (!payload.success) throw new HttpError(400, 'Invalid service listing payload.', payload.error.flatten());
    const listing = await publishServiceListing({ auth: req.auth, ...payload.data });
    res.status(201).json({ listing });
  }),
);

// GET /service-listings/:id — public
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const listing = await fetchServiceListingById(req.params.id);
    res.json({ listing });
  }),
);

// DELETE /service-listings/:id — admin only
router.delete(
  '/:id',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    await removeServiceListing(req.params.id, req.auth);
    res.status(204).send();
  }),
);

module.exports = { serviceListingRoutes: router };
