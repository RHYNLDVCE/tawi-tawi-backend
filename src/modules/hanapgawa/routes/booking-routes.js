const express = require('express');
const { z } = require('zod');

const { asyncHandler } = require('../../../lib/async-handler');
const { HttpError } = require('../../../lib/http-error');
const { hanapgawaAuth } = require('../../../middleware/hanapgawa-auth.middleware');
const {
  requestBooking,
  getBookingsForUser,
  getBookingForUser,
  changeBookingStatus,
  moveBookingDate,
  repostBooking,
  getAllBookings,
  deleteBookingRecord,
} = require('../services/booking-service');

const router = express.Router();

const bookingSchema = z.object({
  workerUserId: z.uuid(),
  serviceListingId: z.string().optional(),
  serviceCategory: z.string().min(2).max(80),
  municipality: z.string().min(2).max(80),
  locationDetails: z.string().max(240).optional().default(''),
  notes: z.string().max(1000).optional().default(''),
  scheduledAt: z.iso.datetime().optional(),
});

const bookingStatusSchema = z.object({
  status: z.enum(['accepted', 'rejected', 'in_progress', 'completion_requested', 'completed', 'cancellation_requested', 'cancelled']),
  cancellationReason: z.string().max(500).optional(),
});

const rescheduleSchema = z.object({
  scheduledAt: z.iso.datetime(),
  rescheduleNote: z.string().max(500).optional().default(''),
});

const repostSchema = z.object({
  postType: z.enum(['looking_for_worker', 'offering_service']),
  title: z.string().trim().min(2).max(120),
  category: z.preprocess((v) => (String(v || '').trim() || 'General'), z.string().min(2).max(80)),
  municipality: z.string().min(2).max(80),
  locationDetails: z.string().max(240).optional().default(''),
  description: z.preprocess((v) => (String(v || '').trim() || 'No details provided.'), z.string().min(3).max(1500)),
  workersNeeded: z.coerce.number().int().min(1).max(50).default(1),
});

// POST /bookings
router.post(
  '/',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const payload = bookingSchema.safeParse(req.body);
    if (!payload.success) {
      throw new HttpError(400, 'Invalid booking payload.', payload.error.flatten());
    }

    if (req.auth.role === 'admin') {
      throw new HttpError(403, 'Admins cannot create bookings.');
    }

    const booking = await requestBooking({
      clientUserId: req.auth.sub,
      workerUserId: payload.data.workerUserId,
      serviceListingId: payload.data.serviceListingId,
      serviceCategory: payload.data.serviceCategory,
      municipality: payload.data.municipality,
      locationDetails: payload.data.locationDetails,
      notes: payload.data.notes,
      scheduledAt: payload.data.scheduledAt,
    });

    res.status(201).json({ booking });
  }),
);

// GET /bookings
router.get(
  '/',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const bookings = await getBookingsForUser(
      req.auth.sub,
      req.query.status ? String(req.query.status) : undefined,
    );
    res.json({ bookings });
  }),
);

// GET /bookings/all — admin only; MUST be before /:bookingId
router.get(
  '/all',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    if (req.auth.role !== 'admin') {
      throw new HttpError(403, 'Admin access required.');
    }
    const bookings = await getAllBookings(
      req.query.status ? String(req.query.status) : undefined,
    );
    res.json({ bookings });
  }),
);

// GET /bookings/:bookingId
router.get(
  '/:bookingId',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const bookingId = z.uuid().safeParse(req.params.bookingId);
    if (!bookingId.success) throw new HttpError(400, 'Invalid booking id.');

    const booking = await getBookingForUser({ bookingId: bookingId.data, auth: req.auth });
    res.json({ booking });
  }),
);

// PATCH /bookings/:bookingId/status
router.patch(
  '/:bookingId/status',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const bookingId = z.uuid().safeParse(req.params.bookingId);
    if (!bookingId.success) throw new HttpError(400, 'Invalid booking id.');

    const payload = bookingStatusSchema.safeParse(req.body);
    if (!payload.success) {
      throw new HttpError(400, 'Invalid booking status payload.', payload.error.flatten());
    }

    const booking = await changeBookingStatus({
      bookingId: bookingId.data,
      status: payload.data.status,
      cancellationReason: payload.data.cancellationReason,
      auth: req.auth,
    });

    res.json({ booking });
  }),
);

// PATCH /bookings/:bookingId/reschedule
router.patch(
  '/:bookingId/reschedule',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const bookingId = z.uuid().safeParse(req.params.bookingId);
    if (!bookingId.success) throw new HttpError(400, 'Invalid booking id.');

    const payload = rescheduleSchema.safeParse(req.body);
    if (!payload.success) {
      throw new HttpError(400, 'Invalid reschedule payload.', payload.error.flatten());
    }

    const booking = await moveBookingDate({
      bookingId: bookingId.data,
      scheduledAt: payload.data.scheduledAt,
      rescheduleNote: payload.data.rescheduleNote,
      auth: req.auth,
    });

    res.json({ booking });
  }),
);

// POST /bookings/:bookingId/repost
router.post(
  '/:bookingId/repost',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const bookingId = z.uuid().safeParse(req.params.bookingId);
    if (!bookingId.success) throw new HttpError(400, 'Invalid booking id.');

    if (req.auth.role === 'admin') {
      throw new HttpError(403, 'Admins cannot repost bookings.');
    }

    const payload = repostSchema.safeParse(req.body);
    if (!payload.success) {
      throw new HttpError(400, 'Invalid repost payload.', payload.error.flatten());
    }

    const jobPost = await repostBooking({
      bookingId: bookingId.data,
      auth: req.auth,
      ...payload.data,
    });

    res.status(201).json({ jobPost });
  }),
);

// DELETE /bookings/:bookingId
router.delete(
  '/:bookingId',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const bookingId = z.uuid().safeParse(req.params.bookingId);
    if (!bookingId.success) throw new HttpError(400, 'Invalid booking id.');

    await deleteBookingRecord({ bookingId: bookingId.data, auth: req.auth });
    res.status(204).send();
  }),
);

module.exports = { bookingRoutes: router };
