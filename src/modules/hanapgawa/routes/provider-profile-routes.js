const express = require('express');
const { z } = require('zod');

const { asyncHandler } = require('../../../lib/async-handler');
const { HttpError } = require('../../../lib/http-error');
const { hanapgawaAuth } = require('../../../middleware/hanapgawa-auth.middleware');
const {
  saveProviderProfile,
  fetchProviderProfile,
  searchProviders,
} = require('../services/provider-profile-service');

const router = express.Router();

const profileSchema = z.object({
  bio:               z.string().max(2000).optional().default(''),
  skills:            z.array(z.string().min(1).max(80)).max(30).default([]),
  certifications:    z.array(z.object({
    name:     z.string().min(1).max(120),
    issuedBy: z.string().max(120).optional().default(''),
    year:     z.number().int().min(1950).max(2100).optional(),
  })).max(20).default([]),
  portfolio:         z.array(z.object({
    imageUrl:    z.string().max(500),
    caption:     z.string().max(160).optional().default(''),
    description: z.string().max(500).optional().default(''),
  })).max(20).default([]),
  languages:         z.array(z.string().min(1).max(60)).max(10).default([]),
  yearsOfExperience: z.coerce.number().int().min(0).max(60).optional(),
  municipalities:    z.array(z.string().min(1).max(80)).max(20).default([]),
  socialLinks:       z.object({
    facebook:  z.string().max(200).optional().default(''),
    instagram: z.string().max(200).optional().default(''),
    website:   z.string().max(200).optional().default(''),
  }).optional().default({}),
});

// GET /providers — public search
// GET /providers/search — alias (Flutter compat)
const handleSearch = asyncHandler(async (req, res) => {
  const providers = await searchProviders({
    municipality: req.query.municipality ? String(req.query.municipality) : undefined,
    skill:        req.query.skill        ? String(req.query.skill)        : undefined,
    keyword:      req.query.keyword      ? String(req.query.keyword)      : undefined,
    category:     req.query.category     ? String(req.query.category)     : undefined,
    service:      req.query.service      ? String(req.query.service)      : undefined,
  });
  res.json({ providers });
});
router.get('/',       handleSearch);
router.get('/search', handleSearch);

// POST /providers — Flutter compat alias for PUT /providers/me/profile
// PUT  /providers/me/profile — canonical
const handleUpsertProfile = [
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    if (req.auth.role === 'admin') throw new HttpError(403, 'Admins do not have provider profiles.');
    const payload = profileSchema.safeParse(req.body);
    if (!payload.success) throw new HttpError(400, 'Invalid profile payload.', payload.error.flatten());
    const profile = await saveProviderProfile(req.auth, payload.data);
    res.status(201).json({ profile });
  }),
];
router.post('/me/profile', ...handleUpsertProfile);
router.put('/me/profile',  ...handleUpsertProfile);
router.post('/',           ...handleUpsertProfile);

// GET /providers/:userId — Flutter compat alias for GET /providers/:userId/profile
// MUST be after /search and /me routes
const handleGetProfile = asyncHandler(async (req, res) => {
  const data = await fetchProviderProfile(req.params.userId);
  res.json(data);
});
router.get('/:userId/profile', handleGetProfile);
router.get('/:userId',         handleGetProfile);

module.exports = { providerProfileRoutes: router };
