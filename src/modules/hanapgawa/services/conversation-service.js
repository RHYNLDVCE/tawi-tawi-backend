const { HttpError } = require('../../../lib/http-error');
const { findUserById } = require('../repositories/user-repository');
const {
  createConversation,
  findConversationBetweenUsers,
  findConversationById,
  listConversationsForUser,
  addMessage,
  addSystemMessage,
  listMessages,
  editMessage,
  deleteMessage,
  deleteConversation,
  upsertConversationNickname,
  deleteConversationNickname,
  getConversationNicknames,
} = require('../repositories/conversation-repository');

// ─── Internal helpers ─────────────────────────────────────────────────────────

// Fetch and assert a conversation exists.
async function _requireConversation(conversationId) {
  const conversation = await findConversationById(conversationId);
  if (!conversation) throw new HttpError(404, 'Conversation not found.');
  return conversation;
}

// Assert the calling user is a participant, or an admin.
// Admins may read but not mutate on behalf of participants.
function _assertParticipant(conversation, auth) {
  const isParticipant =
    conversation.clientUserId   === auth.sub ||
    conversation.providerUserId === auth.sub;
  if (!isParticipant && auth.role !== 'admin') {
    throw new HttpError(403, 'You do not have access to this conversation.');
  }
}

// Combines _requireConversation + _assertParticipant.
async function _requireAccess(conversationId, auth) {
  const conversation = await _requireConversation(conversationId);
  _assertParticipant(conversation, auth);
  return conversation;
}

// Returns the other participant's id relative to the calling user.
function _otherUserId(conversation, myUserId) {
  return conversation.clientUserId === myUserId
    ? conversation.providerUserId
    : conversation.clientUserId;
}

// ─── Service functions ────────────────────────────────────────────────────────

// Start a new conversation or add the initial message to an existing thread.
// Reuses the existing conversation if one already exists between the two users.
async function startConversation({
  initiatorUserId,
  targetUserId,
  serviceListingId,
  bookingId,
  initialMessage,
}) {
  if (initiatorUserId === targetUserId) {
    throw new HttpError(400, 'You cannot start a conversation with yourself.');
  }

  const target = await findUserById(targetUserId);
  if (!target) throw new HttpError(404, 'User not found.');

  const trimmed = (initialMessage || '').trim();
  if (!trimmed) throw new HttpError(400, 'An initial message is required.');

  // Reuse an existing thread between these two users rather than creating
  // a duplicate conversation pair.
  const existing = await findConversationBetweenUsers(initiatorUserId, targetUserId);
  if (existing) {
    const message = await addMessage({
      conversationId: existing.id,
      senderUserId:   initiatorUserId,
      message:        trimmed,
    });
    return { conversation: existing, message };
  }

  return createConversation({
    clientUserId:    initiatorUserId,
    providerUserId:  targetUserId,
    serviceListingId: serviceListingId || null,
    bookingId:        bookingId        || null,
    initialMessage:   trimmed,
  });
}

// Return all conversations for the calling user, optionally filtered by search.
async function getMyConversations(userId, search = '') {
  return listConversationsForUser(userId, search.trim());
}

// Return a conversation and its messages for an authorized participant.
// Supports cursor-based pagination: beforeMessageId, limit.
async function getConversationMessages(conversationId, auth, { before, limit } = {}) {
  const conversation = await _requireAccess(conversationId, auth);
  const cap = Math.min(limit || 50, 100);
  const messages = await listMessages(conversationId, { before, limit: cap });
  return { conversation, messages };
}

// Send a message from an authorized participant.
// At least one of: message text, image, or voiceMessage must be present.
async function sendConversationMessage({
  conversationId,
  auth,
  message        = '',
  image          = null,
  voiceMessage   = null,
  voiceDuration  = 0,
  replyToMessageId       = null,
  forwardedFromMessageId = null,
}) {
  await _requireAccess(conversationId, auth);

  const trimmedText = message.trim();
  if (!trimmedText && !image && !voiceMessage) {
    throw new HttpError(400, 'A message, image, or voice message is required.');
  }

  return addMessage({
    conversationId,
    senderUserId:   auth.sub,
    message:        trimmedText,
    image,
    voiceMessage,
    voiceDuration:  Number(voiceDuration) || 0,
    replyToMessageId,
    forwardedFromMessageId,
  });
}

// Edit a message's text. Ownership is enforced in the repository WHERE clause.
// Only text can be edited — image and voice messages are immutable.
async function editConversationMessage({ conversationId, messageId, auth, message }) {
  await _requireAccess(conversationId, auth);

  const trimmed = (message || '').trim();
  if (!trimmed) throw new HttpError(400, 'Edited message cannot be empty.');

  return editMessage({ messageId, senderUserId: auth.sub, message: trimmed });
}

// Delete a message. Ownership enforced in repository WHERE clause.
// Admins cannot delete on behalf of a user — sender match is required.
async function deleteConversationMessage({ conversationId, messageId, auth }) {
  await _requireAccess(conversationId, auth);
  await deleteMessage({ messageId, senderUserId: auth.sub });
}

// Delete an entire conversation. Only a participant may delete.
// Admins are not permitted to delete others' conversations.
async function removeConversation({ conversationId, auth }) {
  const conversation = await _requireConversation(conversationId);
  const isParticipant =
    conversation.clientUserId   === auth.sub ||
    conversation.providerUserId === auth.sub;
  if (!isParticipant) {
    throw new HttpError(403, 'Only a conversation participant can delete it.');
  }
  await deleteConversation({ conversationId, userId: auth.sub });
}

// ─── Nickname functions ───────────────────────────────────────────────────────

// Return all nicknames set within a conversation.
async function listNicknames({ conversationId, auth }) {
  await _requireAccess(conversationId, auth);
  return getConversationNicknames(conversationId);
}

// Set or clear a nickname for a participant.
// Empty/blank nickname = clear. Injects a system message on change.
async function setNickname({ conversationId, targetUserId, nickname, auth }) {
  const conversation = await _requireAccess(conversationId, auth);

  const target = await findUserById(targetUserId);
  if (!target) throw new HttpError(404, 'Target user not found.');

  // The nickname target must be a participant in this conversation.
  const targetIsParticipant =
    conversation.clientUserId   === targetUserId ||
    conversation.providerUserId === targetUserId;
  if (!targetIsParticipant) {
    throw new HttpError(400, 'Target user is not a participant in this conversation.');
  }

  const setter    = await findUserById(auth.sub);
  const setterName = setter?.fullName || 'Someone';
  const targetName = target.fullName  || target.email;
  const trimmed    = (nickname || '').trim();

  if (!trimmed) {
    // Empty nickname = clear
    await deleteConversationNickname(conversationId, targetUserId);
    await addSystemMessage({
      conversationId,
      message: `${setterName} cleared ${targetName}'s nickname.`,
    });
    return null;
  }

  const result = await upsertConversationNickname(
    conversationId,
    targetUserId,
    trimmed,
    auth.sub,
  );
  await addSystemMessage({
    conversationId,
    message: `${setterName} set ${targetName}'s nickname to "${trimmed}".`,
  });
  return result;
}

// Remove a nickname explicitly (equivalent to setNickname with empty string,
// but without the system message — used for admin/silent cleanup).
async function removeNickname({ conversationId, targetUserId, auth }) {
  await _requireAccess(conversationId, auth);
  await deleteConversationNickname(conversationId, targetUserId);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
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
};
