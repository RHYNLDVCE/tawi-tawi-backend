const { HttpError } = require('../../../lib/http-error');
const { findUserById } = require('../repositories/user-repository');
const { listReviewSummariesForProviders } = require('../repositories/review-repository');
const {
  createServiceListing,
  listServiceListings,
  getServiceListingById,
  listServiceListingsForProvider,
  deleteServiceListingById,
} = require('../repositories/service-listing-repository');
const { safeGet, safeSet, safeDel, safeDelPattern } = require('../cache/cache-client');
const { KEYS, TTL } = require('../cache/cache-keys');

function assertProviderEligible(user) {
  if (!user) throw new HttpError(404, 'User not found.');
  if (!['worker', 'agency'].includes(user.role)) {
    throw new HttpError(403, 'Only workers and agencies can manage service listings.');
  }
  if (user.status !== 'approved') {
    throw new HttpError(403, 'Your account must be approved before publishing service listings.');
  }
}

function attachReviewSummaries(listings, summaries) {
  const byUserId = new Map(summaries.map((s) => [s.userId, s]));
  return listings.map((listing) => ({
    ...listing,
    reviewSummary: byUserId.get(listing.providerUserId) || { reviewCount: 0, avgRating: null },
  }));
}

async function publishServiceListing({ auth, ...payload }) {
  if (auth.role === 'admin') throw new HttpError(403, 'Admins cannot create service listings.');
  const user = await findUserById(auth.sub);
  assertProviderEligible(user);

  const listing = await createServiceListing({
    providerUserId: auth.sub,
    providerRole:   user.role,
    ...payload,
  });

  // Invalidate all search caches — new listing changes results
  safeDelPattern(KEYS.listingSearch('*').replace('*', '') + '*');
  safeDel(KEYS.listingsForProvider(auth.sub));

  return listing;
}

async function searchServiceListings({ category, municipality, keyword } = {}) {
  const cacheKey = KEYS.listingSearch({ category: category || '', municipality: municipality || '', keyword: keyword || '' });

  const cached = await safeGet(cacheKey);
  if (cached) return cached;

  const listings = await listServiceListings({ category, municipality, keyword });

  // Filter: only show listings from approved providers
  const providerIds = [...new Set(listings.map((l) => l.providerUserId))];
  const users = providerIds.length ? await Promise.all(providerIds.map(findUserById)) : [];
  const approvedIds = new Set(users.filter((u) => u && u.status === 'approved').map((u) => u.id));
  const visible = listings.filter((l) => approvedIds.has(l.providerUserId));

  // Enrich with review summaries from PostgreSQL
  const summaries = await listReviewSummariesForProviders(visible.map((l) => l.providerUserId));
  const result = attachReviewSummaries(visible, summaries);

  safeSet(cacheKey, TTL.LISTING_SEARCH, result);
  return result;
}

async function fetchServiceListingById(id) {
  const cacheKey = KEYS.listingDetail(id);
  const cached = await safeGet(cacheKey);
  if (cached) return cached;

  const listing = await getServiceListingById(id);
  if (!listing) throw new HttpError(404, 'Service listing not found.');

  const provider = await findUserById(listing.providerUserId);
  if (!provider || provider.status !== 'approved') {
    throw new HttpError(404, 'Service listing not found.');
  }

  const [summary] = await listReviewSummariesForProviders([listing.providerUserId]);
  const result = { ...listing, reviewSummary: summary || { reviewCount: 0, avgRating: null } };

  safeSet(cacheKey, TTL.LISTING_DETAIL, result);
  return result;
}

async function fetchMyListings(auth) {
  const listings = await listServiceListingsForProvider(auth.sub);
  const summaries = await listReviewSummariesForProviders(listings.map((l) => l.providerUserId));
  return attachReviewSummaries(listings, summaries);
}

async function removeServiceListing(id, auth) {
  if (auth.role !== 'admin') throw new HttpError(403, 'Admin access required.');
  const deleted = await deleteServiceListingById(id);
  if (!deleted) throw new HttpError(404, 'Service listing not found.');

  safeDel(KEYS.listingDetail(id));
  safeDelPattern(KEYS.listingSearch('*').replace('*', '') + '*');
}

module.exports = {
  publishServiceListing,
  searchServiceListings,
  fetchServiceListingById,
  fetchMyListings,
  removeServiceListing,
};
