const { HttpError } = require('../../../lib/http-error');
const { writeReviewedRelationship } = require('../graph/graph-writer');
const { findBookingById } = require('../repositories/booking-repository');
const { findUserById } = require('../repositories/user-repository');
const {
  createReview,
  listReviewsForUser,
  listReviewSummariesForProviders,
} = require('../repositories/review-repository');

async function submitReview({ bookingId, reviewerUserId, reviewedUserId, rating, comment }) {
  const booking = await findBookingById(bookingId);
  if (!booking) throw new HttpError(404, 'Booking not found.');

  if (booking.status !== 'completed') {
    throw new HttpError(409, 'You can only review completed bookings.');
  }

  const isParticipant = booking.clientUserId === reviewerUserId || booking.workerUserId === reviewerUserId;
  if (!isParticipant) {
    throw new HttpError(403, 'You are not a participant of this booking.');
  }

  const isReviewedParticipant = booking.clientUserId === reviewedUserId || booking.workerUserId === reviewedUserId;
  if (!isReviewedParticipant) {
    throw new HttpError(400, 'The reviewed user is not a participant of this booking.');
  }

  if (reviewerUserId === reviewedUserId) {
    throw new HttpError(400, 'You cannot review yourself.');
  }

  const reviewedUser = await findUserById(reviewedUserId);
  if (!reviewedUser) throw new HttpError(404, 'Reviewed user not found.');
  if (reviewedUser.role === 'admin') throw new HttpError(400, 'You cannot review an admin account.');

  const reviewer = await findUserById(reviewerUserId);
  if (reviewer && reviewer.role === 'admin') throw new HttpError(403, 'Admins cannot submit reviews.');

  const review = await createReview({ bookingId, reviewerUserId, reviewedUserId, rating, comment });
  writeReviewedRelationship(reviewerUserId, reviewedUserId, rating, bookingId).catch(() => {});
  return review;
}

async function getProviderReviews(providerUserId) {
  const user = await findUserById(providerUserId);
  if (!user) throw new HttpError(404, 'User not found.');
  return listReviewsForUser(providerUserId);
}

async function getReviewsForUser(userId) {
  const user = await findUserById(userId);
  if (!user) throw new HttpError(404, 'User not found.');
  return listReviewsForUser(userId);
}

module.exports = {
  submitReview,
  getProviderReviews,
  getReviewsForUser,
  listReviewSummariesForProviders,
};
