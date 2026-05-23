const express = require('express');

const { asyncHandler } = require('../../../lib/async-handler');
const { getCategories } = require('../services/category-service');

const router = express.Router();

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const categories = await getCategories(true);
    res.json({ categories });
  }),
);

module.exports = { categoryRoutes: router };
