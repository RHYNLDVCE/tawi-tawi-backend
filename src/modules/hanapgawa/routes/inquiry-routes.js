const express = require('express');
const { z } = require('zod');

const { asyncHandler } = require('../../../lib/async-handler');
const { HttpError } = require('../../../lib/http-error');
const { hanapgawaAuth } = require('../../../middleware/hanapgawa-auth.middleware');
const {
  startConversation,
  getMyConversations,
  getConversationMessages,
  sendConversationMessage,
  editConversationMessage,
  deleteConversationMessage,
  removeConversation,
  listNicknames,
  setNickname,
  removeNickname,
} = require('../services/conversation-service');

const router = express.Router();
router.use(hanapgawaAuth);

// ─── Validation schemas ───────────────────────────────────────────────────────

const uuidParam = (name) => z.string().uuid(`Invalid ${name}.`);

const startSchema = z.object({
  providerUserId:   z.string().uuid(),
  serviceListingId: z.string().optional(),
  bookingId:        z.string().uuid().optional(),
  initialMessage:   z.string().min(1).max(1000),
});

const messageSchema = z.object({
  message:               z.string().max(2000).default(''),
  image:                 z.string().optional(),
  voiceMessage:          z.string().optional(),
  voiceDuration:         z.coerce.number().int().nonnegative().default(0),
  replyToMessageId:      z.string().uuid().optional(),
  forwardedFromMessageId: z.string().uuid().optional(),
}).refine(
  (d) => d.message.trim().length > 0 || d.image || d.voiceMessage,
  { message: 'A message, image, or voice message is required.' },
);

const nicknameSchema = z.object({
  targetUserId: z.string().uuid(),
  nickname:     z.string().max(60).default(''),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

// POST /inquiries — start or reuse a conversation
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const payload = startSchema.safeParse(req.body);
    if (!payload.success) throw new HttpError(400, 'Invalid inquiry payload.', payload.error.flatten());

    const result = await startConversation({
      initiatorUserId:  req.auth.sub,
      targetUserId:     payload.data.providerUserId,
      serviceListingId: payload.data.serviceListingId,
      bookingId:        payload.data.bookingId,
      initialMessage:   payload.data.initialMessage,
    });

    res.status(201).json(result);
  }),
);

// GET /inquiries — list caller's conversations
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const search = (req.query.q || '').toString().trim();
    const conversations = await getMyConversations(req.auth.sub, search);
    res.json({ conversations });
  }),
);

// GET /inquiries/:conversationId/messages — must be before /:conversationId
router.get(
  '/:conversationId/messages',
  asyncHandler(async (req, res) => {
    const convId = uuidParam('conversation id').safeParse(req.params.conversationId);
    if (!convId.success) throw new HttpError(400, 'Invalid conversation id.');

    const limit  = req.query.limit  ? parseInt(req.query.limit, 10)  : 50;
    const before = req.query.before ? String(req.query.before)        : undefined;

    const result = await getConversationMessages(convId.data, req.auth, { before, limit });
    res.json(result);
  }),
);

// POST /inquiries/:conversationId/messages
router.post(
  '/:conversationId/messages',
  asyncHandler(async (req, res) => {
    const convId = uuidParam('conversation id').safeParse(req.params.conversationId);
    if (!convId.success) throw new HttpError(400, 'Invalid conversation id.');

    const payload = messageSchema.safeParse(req.body);
    if (!payload.success) {
      throw new HttpError(400, payload.error.errors[0]?.message || 'Invalid message payload.');
    }

    const message = await sendConversationMessage({
      conversationId:        convId.data,
      auth:                  req.auth,
      message:               payload.data.message,
      image:                 payload.data.image                 || null,
      voiceMessage:          payload.data.voiceMessage          || null,
      voiceDuration:         payload.data.voiceDuration         || 0,
      replyToMessageId:      payload.data.replyToMessageId      || null,
      forwardedFromMessageId: payload.data.forwardedFromMessageId || null,
    });

    res.status(201).json({ message });
  }),
);

// PATCH /inquiries/:conversationId/messages/:messageId — edit message text
router.patch(
  '/:conversationId/messages/:messageId',
  asyncHandler(async (req, res) => {
    const convId = uuidParam('conversation id').safeParse(req.params.conversationId);
    const msgId  = uuidParam('message id').safeParse(req.params.messageId);
    if (!convId.success) throw new HttpError(400, 'Invalid conversation id.');
    if (!msgId.success)  throw new HttpError(400, 'Invalid message id.');

    const text = (req.body.message || '').toString().trim();
    if (!text) throw new HttpError(400, 'Edited message cannot be empty.');

    const message = await editConversationMessage({
      conversationId: convId.data,
      messageId:      msgId.data,
      auth:           req.auth,
      message:        text,
    });

    res.json({ message });
  }),
);

// DELETE /inquiries/:conversationId/messages/:messageId
router.delete(
  '/:conversationId/messages/:messageId',
  asyncHandler(async (req, res) => {
    const convId = uuidParam('conversation id').safeParse(req.params.conversationId);
    const msgId  = uuidParam('message id').safeParse(req.params.messageId);
    if (!convId.success) throw new HttpError(400, 'Invalid conversation id.');
    if (!msgId.success)  throw new HttpError(400, 'Invalid message id.');

    await deleteConversationMessage({
      conversationId: convId.data,
      messageId:      msgId.data,
      auth:           req.auth,
    });

    res.json({ deleted: true });
  }),
);

// GET /inquiries/:conversationId/nicknames
router.get(
  '/:conversationId/nicknames',
  asyncHandler(async (req, res) => {
    const convId = uuidParam('conversation id').safeParse(req.params.conversationId);
    if (!convId.success) throw new HttpError(400, 'Invalid conversation id.');

    const nicknames = await listNicknames({ conversationId: convId.data, auth: req.auth });
    res.json({ nicknames });
  }),
);

// PUT /inquiries/:conversationId/nicknames — set or clear a nickname
router.put(
  '/:conversationId/nicknames',
  asyncHandler(async (req, res) => {
    const convId = uuidParam('conversation id').safeParse(req.params.conversationId);
    if (!convId.success) throw new HttpError(400, 'Invalid conversation id.');

    const payload = nicknameSchema.safeParse(req.body);
    if (!payload.success) throw new HttpError(400, 'Invalid nickname payload.');

    const nickname = await setNickname({
      conversationId: convId.data,
      targetUserId:   payload.data.targetUserId,
      nickname:       payload.data.nickname,
      auth:           req.auth,
    });

    res.json({ nickname });
  }),
);

// DELETE /inquiries/:conversationId/nicknames/:targetUserId
router.delete(
  '/:conversationId/nicknames/:targetUserId',
  asyncHandler(async (req, res) => {
    const convId  = uuidParam('conversation id').safeParse(req.params.conversationId);
    const userId  = uuidParam('target user id').safeParse(req.params.targetUserId);
    if (!convId.success) throw new HttpError(400, 'Invalid conversation id.');
    if (!userId.success) throw new HttpError(400, 'Invalid target user id.');

    await removeNickname({
      conversationId: convId.data,
      targetUserId:   userId.data,
      auth:           req.auth,
    });

    res.json({ deleted: true });
  }),
);

// DELETE /inquiries/:conversationId — delete entire conversation
router.delete(
  '/:conversationId',
  asyncHandler(async (req, res) => {
    const convId = uuidParam('conversation id').safeParse(req.params.conversationId);
    if (!convId.success) throw new HttpError(400, 'Invalid conversation id.');

    await removeConversation({ conversationId: convId.data, auth: req.auth });
    res.json({ deleted: true });
  }),
);

module.exports = { inquiryRoutes: router };
