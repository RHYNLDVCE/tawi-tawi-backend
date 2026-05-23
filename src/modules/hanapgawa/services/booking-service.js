const { HttpError } = require('../../../lib/http-error');
const { writeWorkedForRelationship } = require('../graph/graph-writer');
const {
  createBooking,
  findBookingById,
  listAllBookings,
  listBookingsForUser,
  markBookingReposted,
  removeBooking,
  rescheduleBooking,
  updateBookingStatus,
} = require('../repositories/booking-repository');
const { findUserById } = require('../repositories/user-repository');
const { postJob } = require('./job-service');

async function requestBooking({ clientUserId, workerUserId, serviceListingId, serviceCategory, municipality, locationDetails, notes, scheduledAt }) {
  const worker = await findUserById(workerUserId);
  if (!worker) {
    throw new HttpError(404, 'Worker account not found.');
  }
  if (worker.role === 'admin') {
    throw new HttpError(403, 'Cannot book an admin account.');
  }

  return createBooking({
    clientUserId,
    workerUserId,
    serviceListingId,
    serviceCategory,
    municipality,
    locationDetails,
    notes,
    scheduledAt,
    status: 'pending',
    source: 'direct_booking',
  });
}

async function getBookingsForUser(userId, status) {
  const bookings = await listBookingsForUser(userId);
  return status ? bookings.filter((booking) => booking.status === status) : bookings;
}

async function getBookingForUser({ bookingId, auth }) {
  const booking = await findBookingById(bookingId);

  if (!booking) {
    throw new HttpError(404, 'Booking not found.');
  }

  const isParticipant = booking.clientUserId === auth.sub || booking.workerUserId === auth.sub;
  if (!isParticipant && auth.role !== 'admin') {
    throw new HttpError(403, 'You can only view bookings you are part of.');
  }

  return booking;
}

async function changeBookingStatus({ bookingId, status, cancellationReason, auth }) {
  const booking = await findBookingById(bookingId);

  if (!booking) {
    throw new HttpError(404, 'Booking not found.');
  }

  const isAdmin = auth.role === 'admin';
  const isWorkerOwner = booking.workerUserId === auth.sub;
  const isClientOwner = booking.clientUserId === auth.sub;
  // For job_application bookings the client approves; for direct_booking the worker approves
  const approverUserId = booking.source === 'job_application' ? booking.clientUserId : booking.workerUserId;

  if (isAdmin) {
    if (status !== 'cancelled' || booking.status !== 'cancellation_requested') {
      throw new HttpError(403, 'Admins can monitor bookings but cannot participate in booking workflow actions.');
    }
  }

  const workerStatuses = ['in_progress', 'completion_requested'];
  const clientStatuses = ['completed'];

  if (['accepted', 'rejected'].includes(status) && !isAdmin && auth.sub !== approverUserId) {
    throw new HttpError(403, 'Only the booking approver can accept or decline this booking.');
  }

  if (workerStatuses.includes(status) && !isAdmin && !isWorkerOwner) {
    throw new HttpError(403, 'Only the assigned worker or admin can update this booking stage.');
  }

  if (clientStatuses.includes(status) && !isAdmin && !isClientOwner) {
    throw new HttpError(403, 'Only the client or admin can confirm this booking stage.');
  }

  if (status === 'cancellation_requested' && !isAdmin && !isClientOwner && !isWorkerOwner) {
    throw new HttpError(403, 'Only booking participants or admin can request cancellation.');
  }

  if (status === 'cancelled') {
    if (!isAdmin && !(isClientOwner || isWorkerOwner)) {
      throw new HttpError(403, 'Only booking participants or admin can finalize cancellation.');
    }
    if (booking.status !== 'cancellation_requested' && !isAdmin) {
      throw new HttpError(409, 'Cancellation must be requested before it can be finalized.');
    }
  }

  if (status === 'completed' && booking.status !== 'completion_requested' && !isAdmin) {
    throw new HttpError(409, 'Provider must request completion before client confirmation.');
  }

  const updated = await updateBookingStatus({ bookingId: booking.id, status, actorUserId: auth.sub, cancellationReason });
  if (status === 'completed' && updated) {
    writeWorkedForRelationship(booking.workerUserId, booking.clientUserId, booking.id).catch(() => {});
  }
  return updated;
}

async function moveBookingDate({ bookingId, scheduledAt, rescheduleNote, auth }) {
  const booking = await findBookingById(bookingId);
  if (!booking) throw new HttpError(404, 'Booking not found.');

  const isWorker = booking.workerUserId === auth.sub;
  const isClient = booking.clientUserId === auth.sub;

  if (!isWorker && !isClient) {
    throw new HttpError(403, 'You are not a participant of this booking.');
  }

  if (isWorker && booking.status !== 'accepted') {
    throw new HttpError(409, 'Workers can only move the date of accepted bookings.');
  }
  if (isClient && booking.status !== 'pending') {
    throw new HttpError(409, 'Clients can only move the date before the provider accepts.');
  }

  const updated = await rescheduleBooking({ bookingId, scheduledAt, rescheduleNote });
  if (!updated) throw new HttpError(500, 'Reschedule failed.');
  return updated;
}

async function repostBooking({ bookingId, auth, ...jobPayload }) {
  const booking = await findBookingById(bookingId);
  if (!booking) throw new HttpError(404, 'Booking not found.');

  const isParticipant = booking.clientUserId === auth.sub || booking.workerUserId === auth.sub;
  if (!isParticipant) throw new HttpError(403, 'You are not a participant of this booking.');

  const jobPost = await postJob({ auth, ...jobPayload });

  const marked = await markBookingReposted({ bookingId, jobPostId: jobPost.id });
  if (!marked) {
    throw new HttpError(409, 'This booking has already been reposted.');
  }

  return jobPost;
}

async function getAllBookings(status) {
  return listAllBookings(status);
}

async function deleteBookingRecord({ bookingId, auth }) {
  const booking = await findBookingById(bookingId);
  if (!booking) throw new HttpError(404, 'Booking not found.');

  const isParticipant = booking.clientUserId === auth.sub || booking.workerUserId === auth.sub;
  if (!isParticipant && auth.role !== 'admin') {
    throw new HttpError(403, 'You are not a participant of this booking.');
  }

  if (!['completed', 'cancelled', 'rejected'].includes(booking.status)) {
    throw new HttpError(409, 'You can only remove completed or cancelled bookings.');
  }

  await removeBooking(bookingId);
}

module.exports = {
  requestBooking,
  getBookingsForUser,
  getBookingForUser,
  changeBookingStatus,
  moveBookingDate,
  repostBooking,
  getAllBookings,
  deleteBookingRecord,
};
