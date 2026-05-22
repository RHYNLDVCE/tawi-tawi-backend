function serializeUser(userNode) {
  if (!userNode) return null;

  const user = userNode.properties ? userNode.properties : userNode;

  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

module.exports = {
  serializeUser,
};