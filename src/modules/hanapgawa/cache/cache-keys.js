// TTL constants (seconds)
const TTL = {
  CATEGORIES:           60 * 60,       // 1 hour  — rarely changes
  LISTING_SEARCH:       60 * 5,        // 5 min   — search results
  LISTING_DETAIL:       60 * 10,       // 10 min  — single listing
  PROVIDER_SEARCH:      60 * 5,        // 5 min   — provider search
  PROVIDER_PROFILE:     60 * 10,       // 10 min  — provider detail page
  JOBS_OPEN:            60 * 2,        // 2 min   — open job listings
  NOTIF_UNREAD_COUNT:   30,            // 30 sec  — unread badge
  USER_PROFILE:         60 * 10,       // 10 min  — public user profile
  REVIEW_SUMMARY:       60 * 10,       // 10 min  — provider rating summary
};

// Key builders
// All search/filter keys encode params to base64 to keep keys clean and collision-free.
function _encode(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

const KEYS = {
  categoriesAll:          () => 'categories:all',
  listingSearch:   (filters) => `listings:search:${_encode(filters)}`,
  listingDetail:       (id) => `listing:${id}`,
  listingsForProvider: (id) => `listings:provider:${id}`,
  providerSearch:  (filters) => `providers:search:${_encode(filters)}`,
  providerProfile:     (id) => `provider:profile:${id}`,
  jobsOpen:   (municipality) => `jobs:open:${municipality || 'all'}`,
  notifUnreadCount: (userId) => `notifs:unread:${userId}`,
  userProfile:       (userId) => `user:profile:${userId}`,
  reviewSummary:     (userId) => `review_summary:${userId}`,
};

module.exports = { TTL, KEYS };
