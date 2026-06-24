const onlineUsers = new Map(); // userId(string) -> Set<socketId>

function isUserOnline(userId) {
  const sockets = onlineUsers.get(String(userId));
  return sockets && sockets.size > 0;
}

module.exports = { onlineUsers, isUserOnline };
