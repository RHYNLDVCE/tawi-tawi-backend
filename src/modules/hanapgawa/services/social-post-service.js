const { HttpError } = require('../../../lib/http-error');
const { findUserById, listUsersByIds } = require('../repositories/user-repository');
const {
  createPost,
  listPosts,
  getPostById,
  softDeletePost,
  toggleLike,
  createComment,
  listComments,
  softDeleteComment,
} = require('../repositories/social-post-repository');

async function enrichPostsWithUsers(posts) {
  if (!posts.length) return [];
  const userIds = [...new Set(posts.map((p) => p.userId))];
  const users = await listUsersByIds(userIds);
  const byId = new Map(users.map((u) => [u.id, { fullName: u.fullName, role: u.role }]));
  return posts.map((p) => ({ ...p, author: byId.get(p.userId) || null }));
}

async function publishPost(auth, { content, media, tags, municipality }) {
  const post = await createPost({
    userId:       auth.sub,
    userRole:     auth.role,
    content,
    media,
    tags,
    municipality,
  });
  const user = await findUserById(auth.sub);
  return { ...post, author: user ? { fullName: user.fullName, role: user.role } : null };
}

async function getFeed({ municipality, tag, userId, before, limit } = {}) {
  const posts = await listPosts({ municipality, tag, userId, before, limit });
  return enrichPostsWithUsers(posts);
}

async function getPost(id) {
  const post = await getPostById(id);
  if (!post) throw new HttpError(404, 'Post not found.');
  const [enriched] = await enrichPostsWithUsers([post]);
  return enriched;
}

async function deletePost(id, auth) {
  const post = await getPostById(id);
  if (!post) throw new HttpError(404, 'Post not found.');
  if (post.userId !== auth.sub && auth.role !== 'admin') {
    throw new HttpError(403, 'You can only delete your own posts.');
  }
  await softDeletePost(id);
}

async function likePost(id, auth) {
  const result = await toggleLike(id, auth.sub);
  if (!result) throw new HttpError(404, 'Post not found.');
  return result;
}

async function addComment(postId, auth, content) {
  const post = await getPostById(postId);
  if (!post) throw new HttpError(404, 'Post not found.');
  const comment = await createComment({ postId, userId: auth.sub, userRole: auth.role, content });
  const user = await findUserById(auth.sub);
  return { ...comment, author: user ? { fullName: user.fullName, role: user.role } : null };
}

async function getComments(postId, { before, limit } = {}) {
  const comments = await listComments(postId, { before, limit });
  if (!comments.length) return [];
  const userIds = [...new Set(comments.map((c) => c.userId))];
  const users = await listUsersByIds(userIds);
  const byId = new Map(users.map((u) => [u.id, { fullName: u.fullName, role: u.role }]));
  return comments.map((c) => ({ ...c, author: byId.get(c.userId) || null }));
}

async function deleteComment(postId, commentId, auth) {
  const post = await getPostById(postId);
  if (!post) throw new HttpError(404, 'Post not found.');
  const comments = await listComments(postId);
  const comment = comments.find((c) => c.id === commentId);
  if (!comment) throw new HttpError(404, 'Comment not found.');
  if (comment.userId !== auth.sub && auth.role !== 'admin') {
    throw new HttpError(403, 'You can only delete your own comments.');
  }
  await softDeleteComment(commentId, postId);
}

module.exports = { publishPost, getFeed, getPost, deletePost, likePost, addComment, getComments, deleteComment };
