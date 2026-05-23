const express = require('express');
const { z } = require('zod');

const { asyncHandler } = require('../../../lib/async-handler');
const { HttpError } = require('../../../lib/http-error');
const { hanapgawaAuth } = require('../../../middleware/hanapgawa-auth.middleware');
const {
  publishPost,
  getFeed,
  getPost,
  deletePost,
  likePost,
  addComment,
  getComments,
  deleteComment,
} = require('../services/social-post-service');

const router = express.Router();

const postSchema = z.object({
  content:      z.string().min(1).max(2000),
  media:        z.array(z.object({
    imageUrl: z.string().max(500),
    caption:  z.string().max(160).optional().default(''),
  })).max(10).default([]),
  tags:         z.array(z.string().min(1).max(60)).max(10).default([]),
  municipality: z.string().max(80).optional(),
});

const commentSchema = z.object({
  content: z.string().min(1).max(1000),
});

// GET /posts — public feed
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const posts = await getFeed({
      municipality: req.query.municipality ? String(req.query.municipality) : undefined,
      tag:          req.query.tag          ? String(req.query.tag)          : undefined,
      userId:       req.query.userId       ? String(req.query.userId)       : undefined,
      before:       req.query.before       ? String(req.query.before)       : undefined,
      limit,
    });
    res.json({ posts });
  }),
);

// POST /posts — auth required
router.post(
  '/',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const payload = postSchema.safeParse(req.body);
    if (!payload.success) throw new HttpError(400, 'Invalid post payload.', payload.error.flatten());
    const post = await publishPost(req.auth, payload.data);
    res.status(201).json({ post });
  }),
);

// GET /posts/:id — public
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const post = await getPost(req.params.id);
    res.json({ post });
  }),
);

// DELETE /posts/:id — own post or admin
router.delete(
  '/:id',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    await deletePost(req.params.id, req.auth);
    res.status(204).send();
  }),
);

// POST /posts/:id/like — toggle like, auth required
router.post(
  '/:id/like',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const result = await likePost(req.params.id, req.auth);
    res.json(result);
  }),
);

// GET /posts/:id/comments — public
router.get(
  '/:id/comments',
  asyncHandler(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const comments = await getComments(req.params.id, {
      before: req.query.before ? String(req.query.before) : undefined,
      limit,
    });
    res.json({ comments });
  }),
);

// POST /posts/:id/comments — auth required
router.post(
  '/:id/comments',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    const payload = commentSchema.safeParse(req.body);
    if (!payload.success) throw new HttpError(400, 'Invalid comment payload.', payload.error.flatten());
    const comment = await addComment(req.params.id, req.auth, payload.data.content);
    res.status(201).json({ comment });
  }),
);

// DELETE /posts/:id/comments/:commentId — own comment or admin
router.delete(
  '/:id/comments/:commentId',
  hanapgawaAuth,
  asyncHandler(async (req, res) => {
    await deleteComment(req.params.id, req.params.commentId, req.auth);
    res.status(204).send();
  }),
);

module.exports = { socialPostRoutes: router };
