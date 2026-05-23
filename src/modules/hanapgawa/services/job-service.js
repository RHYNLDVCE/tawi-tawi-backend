const { HttpError } = require('../../../lib/http-error');
const { mergeJobNode, writeHiredRelationship, deleteJobNode } = require('../graph/graph-writer');
const { createBooking } = require('../repositories/booking-repository');
const {
  acceptJobOffer,
  createJobOffer,
  createJobPost,
  declineJobOffer,
  deleteJobPost,
  findJobOfferById,
  findJobPostById,
  listJobPosts,
  listOffersForJob,
  listOffersForProvider,
  updateJobPost,
} = require('../repositories/job-repository');
const { findUserById } = require('../repositories/user-repository');

async function postJob({ auth, ...payload }) {
  if (auth.role === 'admin') {
    throw new HttpError(403, 'Admins cannot create marketplace job posts.');
  }

  const job = await createJobPost({ clientUserId: auth.sub, ...payload });
  mergeJobNode({ id: job.id, title: job.title, category: job.category, municipality: job.municipality, clientUserId: auth.sub }).catch(() => {});
  return job;
}

async function getJobs({ auth, status }) {
  return listJobPosts({ userId: auth.sub, role: auth.role, status });
}

async function getJobDetail({ jobPostId, auth }) {
  const jobPost = await findJobPostById(jobPostId, { userId: auth.sub, role: auth.role });
  if (!jobPost) {
    throw new HttpError(404, 'Job post not found.');
  }

  const canViewOffers = auth.role === 'admin' || jobPost.clientUserId === auth.sub;
  const offers = canViewOffers
    ? await listOffersForJob(jobPostId)
    : (await listOffersForProvider(auth.sub)).filter((offer) => offer.jobPostId === jobPostId);

  return { jobPost, offers };
}

async function editJob({ jobPostId, auth, ...payload }) {
  const jobPost = await findJobPostById(jobPostId, { userId: auth.sub, role: auth.role });
  if (!jobPost) {
    throw new HttpError(404, 'Job post not found.');
  }

  if (jobPost.clientUserId !== auth.sub && auth.role !== 'admin') {
    throw new HttpError(403, 'Only the post owner can edit this post.');
  }

  const updated = await updateJobPost(jobPostId, payload);
  if (!updated) {
    throw new HttpError(404, 'Job post not found.');
  }

  return updated;
}

async function removeJob({ jobPostId, auth }) {
  const jobPost = await findJobPostById(jobPostId, { userId: auth.sub, role: auth.role });
  if (!jobPost) {
    throw new HttpError(404, 'Job post not found.');
  }

  if (jobPost.clientUserId !== auth.sub && auth.role !== 'admin') {
    throw new HttpError(403, 'Only the post owner can delete this post.');
  }

  await deleteJobPost(jobPostId);
  deleteJobNode(jobPostId).catch(() => {});
}

async function sendOffer({ jobPostId, auth, message, proposedPrice, media }) {
  if (auth.role === 'admin') {
    throw new HttpError(403, 'Admins cannot apply to jobs or send offers.');
  }

  const provider = await findUserById(auth.sub);
  if (!provider) {
    throw new HttpError(404, 'User not found.');
  }

  const jobPost = await findJobPostById(jobPostId, { userId: auth.sub, role: auth.role });
  if (!jobPost) {
    throw new HttpError(404, 'Job post not found.');
  }

  if (jobPost.status !== 'open') {
    throw new HttpError(409, 'Offers can only be sent to open jobs.');
  }

  if (jobPost.clientUserId === auth.sub) {
    throw new HttpError(409, 'You cannot send an offer to your own job.');
  }

  return createJobOffer({ jobPostId, providerUserId: auth.sub, message, proposedPrice, media });
}

async function getMyOffers(auth) {
  if (auth.role === 'admin') {
    return [];
  }

  return listOffersForProvider(auth.sub);
}

async function chooseOffer({ jobPostId, offerId, auth }) {
  const jobPost = await findJobPostById(jobPostId, { userId: auth.sub, role: auth.role });
  if (!jobPost) {
    throw new HttpError(404, 'Job post not found.');
  }

  if (auth.role === 'admin' || jobPost.clientUserId !== auth.sub) {
    throw new HttpError(403, 'Only the job owner can accept an offer.');
  }

  if (jobPost.status !== 'open') {
    throw new HttpError(409, 'This job already has enough accepted workers.');
  }

  const existingOffer = await findJobOfferById(offerId);
  if (!existingOffer || existingOffer.jobPostId !== jobPostId) {
    throw new HttpError(404, 'Offer not found for this job.');
  }

  const result = await acceptJobOffer({ jobPostId, offerId });
  if (!result) {
    throw new HttpError(409, 'Could not accept this offer.');
  }

  const isSeekingClient = result.jobPost.postType === 'offering_service';
  const booking = await createBooking({
    clientUserId: isSeekingClient ? result.offer.providerUserId : result.jobPost.clientUserId,
    workerUserId: isSeekingClient ? result.jobPost.clientUserId : result.offer.providerUserId,
    serviceCategory: result.jobPost.category,
    municipality: result.jobPost.municipality,
    locationDetails: result.jobPost.locationDetails,
    notes: result.jobPost.description,
    scheduledAt: result.jobPost.scheduledAt,
    status: 'accepted',
    source: isSeekingClient ? 'service_booking' : 'job_application',
    jobPostId,
  });

  writeHiredRelationship(booking.clientUserId, booking.workerUserId, booking.id).catch(() => {});
  return { ...result, booking: { ...booking, jobTitle: result.jobPost.title } };
}

async function rejectOffer({ jobPostId, offerId, auth }) {
  const jobPost = await findJobPostById(jobPostId, { userId: auth.sub, role: auth.role });
  if (!jobPost) throw new HttpError(404, 'Job post not found.');
  if (auth.role === 'admin' || jobPost.clientUserId !== auth.sub) {
    throw new HttpError(403, 'Only the job owner can decline an offer.');
  }
  const result = await declineJobOffer({ jobPostId, offerId });
  if (!result) throw new HttpError(409, 'Could not decline this offer.');
  return result;
}

module.exports = {
  chooseOffer,
  editJob,
  getJobDetail,
  getJobs,
  getMyOffers,
  postJob,
  rejectOffer,
  removeJob,
  sendOffer,
};
