const { HttpError } = require('../../../lib/http-error');
const { findUserById, listUsersByIds } = require('../repositories/user-repository');
const { listReviewSummariesForProviders } = require('../repositories/review-repository');
const {
  upsertProviderProfile,
  getProviderProfile,
  searchProviderProfiles,
} = require('../repositories/provider-profile-repository');
const { safeGet, safeSet, safeDel } = require('../cache/cache-client');
const { KEYS, TTL } = require('../cache/cache-keys');

function assertProviderRole(user) {
  if (!user) throw new HttpError(404, 'User not found.');
  if (!['worker', 'agency'].includes(user.role)) {
    throw new HttpError(403, 'Only workers and agencies can manage provider profiles.');
  }
}

async function saveProviderProfile(auth, fields) {
  const user = await findUserById(auth.sub);
  assertProviderRole(user);

  const profile = await upsertProviderProfile(auth.sub, fields);
  safeDel(KEYS.providerProfile(auth.sub));
  return { ...profile, user: { fullName: user.fullName, role: user.role, status: user.status } };
}

async function fetchProviderProfile(userId) {
  const cacheKey = KEYS.providerProfile(userId);
  const cached = await safeGet(cacheKey);
  if (cached) return cached;

  const user = await findUserById(userId);
  if (!user || !['worker', 'agency'].includes(user.role)) {
    throw new HttpError(404, 'Provider not found.');
  }

  const profile = await getProviderProfile(userId);
  const [summary] = await listReviewSummariesForProviders([userId]);

  const result = {
    user: { id: user.id, fullName: user.fullName, role: user.role, status: user.status },
    profile: profile || null,
    reviewSummary: summary || { reviewCount: 0, avgRating: null },
  };

  safeSet(cacheKey, TTL.PROVIDER_PROFILE, result);
  return result;
}

async function searchProviders({ municipality, skill, keyword } = {}) {
  const profiles = await searchProviderProfiles({ municipality, skill, keyword });
  if (!profiles.length) return [];

  const userIds = profiles.map((p) => p.providerUserId);
  const users = await listUsersByIds(userIds);
  const approvedUsers = new Map(
    users.filter((u) => u.status === 'approved').map((u) => [u.id, u]),
  );

  const visible = profiles.filter((p) => approvedUsers.has(p.providerUserId));
  const summaries = await listReviewSummariesForProviders(visible.map((p) => p.providerUserId));
  const byUserId = new Map(summaries.map((s) => [s.userId, s]));

  return visible.map((p) => {
    const u = approvedUsers.get(p.providerUserId);
    return {
      profile: p,
      user: { id: u.id, fullName: u.fullName, role: u.role },
      reviewSummary: byUserId.get(p.providerUserId) || { reviewCount: 0, avgRating: null },
    };
  });
}

module.exports = { saveProviderProfile, fetchProviderProfile, searchProviders };
