const express = require("express");
const { getHanapgawaPool } = require("../../database/hanapgawa-postgres");
const { driver: neo4jDriver } = require("../../database/neo4j");
const { getMongoDb } = require("../../database/mongodb");
const { getRedisClient } = require("../../database/redis");

const router = express.Router();

router.get("/health", async (req, res) => {
  const pool = getHanapgawaPool();
  let pgStatus = "not configured";
  let neo4jStatus = "not configured";
  let mongoStatus = "not configured";
  let redisStatus = "not configured";

  if (pool) {
    try {
      await pool.query("SELECT 1");
      pgStatus = "connected";
    } catch {
      pgStatus = "error";
    }
  }

  try {
    await neo4jDriver.verifyConnectivity();
    neo4jStatus = "connected";
  } catch {
    neo4jStatus = "error";
  }

  const mongoDb = getMongoDb();
  if (mongoDb) {
    try {
      await mongoDb.command({ ping: 1 });
      mongoStatus = "connected";
    } catch {
      mongoStatus = "error";
    }
  }

  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.ping();
      redisStatus = "connected";
    } catch {
      redisStatus = "error";
    }
  }

  res.json({
    success: true,
    message: "HanapGawa API is running.",
    version: "api/v1",
    timestamp: new Date().toISOString(),
    databases: { postgres: pgStatus, neo4j: neo4jStatus, mongodb: mongoStatus, redis: redisStatus },
  });
});

const { categoryRoutes } = require("../../modules/hanapgawa/routes/category-routes");
router.use("/categories", categoryRoutes);

const { authRoutes } = require("../../modules/hanapgawa/routes/auth-routes");
router.use("/auth", authRoutes);

const { userRoutes } = require("../../modules/hanapgawa/routes/user-routes");
router.use("/users", userRoutes);

const { jobRoutes } = require("../../modules/hanapgawa/routes/job-routes");
router.use("/jobs", jobRoutes);

const { bookingRoutes } = require("../../modules/hanapgawa/routes/booking-routes");
router.use("/bookings", bookingRoutes);

const { reviewRoutes } = require("../../modules/hanapgawa/routes/review-routes");
router.use("/reviews", reviewRoutes);

const { notificationRoutes } = require("../../modules/hanapgawa/routes/notification-routes");
router.use("/notifications", notificationRoutes);

const { serviceListingRoutes } = require("../../modules/hanapgawa/routes/service-listing-routes");
router.use("/service-listings", serviceListingRoutes);
router.use("/services", serviceListingRoutes); // Flutter compat alias

const { providerProfileRoutes } = require("../../modules/hanapgawa/routes/provider-profile-routes");
router.use("/providers", providerProfileRoutes);

const { socialPostRoutes } = require("../../modules/hanapgawa/routes/social-post-routes");
router.use("/posts", socialPostRoutes);

const { inquiryRoutes } = require("../../modules/hanapgawa/routes/inquiry-routes");
router.use("/inquiries", inquiryRoutes);

const { reportRoutes } = require("../../modules/hanapgawa/routes/report-routes");
router.use("/reports", reportRoutes);

const { adminRoutes } = require("../../modules/hanapgawa/routes/admin-routes");
router.use("/admin", adminRoutes);

const { storyRoutes } = require("../../modules/hanapgawa/routes/story-routes");
router.use("/stories", storyRoutes);

const { feedRoutes } = require("../../modules/hanapgawa/routes/feed-routes");
router.use("/feed", feedRoutes);

const { agencyRoutes } = require("../../modules/hanapgawa/routes/agency-routes");
router.use("/agency", agencyRoutes);

const { feedbackRoutes } = require("../../modules/hanapgawa/routes/feedback-routes");
router.use("/feedback", feedbackRoutes);

const { aiRoutes } = require("../../modules/hanapgawa/routes/ai-routes");
router.use("/ai", aiRoutes);

const { mediaRoutes } = require("../../modules/hanapgawa/routes/media-routes");
router.use("/media", mediaRoutes);

module.exports = router;
