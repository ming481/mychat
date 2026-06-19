const jwt = require('jsonwebtoken');
const { pool } = require('../db/index');
const { JWT_SECRET } = require('../middleware/auth');
const { onlineUsers } = require('./state');

function getSockets(io, userId) {
  return onlineUsers.get(String(userId)) || new Set();
}

function emitToUser(io, userId, event, data) {
  getSockets(io, userId).forEach(sid => io.to(sid).emit(event, data));
}

async function getOnlineStatusList() {
  const ids = Array.from(onlineUsers.keys()).map(Number).filter(Number.isFinite);
  if (!ids.length) return [];
  const result = await pool.query('SELECT id, status FROM users WHERE id = ANY($1::int[])', [ids]);
  return result.rows.map(row => ({ userId: row.id, status: row.status }));
}

async function upsertConversation(userId, targetId, type, messageId, unreadIncrement) {
  await pool.query(
    `INSERT INTO conversations (user_id, target_id, type, last_message_id, unread_count, group_state, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'active', NOW())
     ON CONFLICT (user_id, target_id, type) DO UPDATE SET
       last_message_id = EXCLUDED.last_message_id,
       unread_count = conversations.unread_count + $5,
       group_state = CASE WHEN $3 = 1 THEN 'active' ELSE conversations.group_state END,
       updated_at = NOW()`,
    [userId, targetId, type, messageId, unreadIncrement]
  );
}

async function createDelivery(messageId, userId, delivered = false) {
  await pool.query(
    `INSERT INTO message_deliveries (message_id, user_id, delivered_at)
     VALUES ($1, $2, CASE WHEN $3 THEN NOW() ELSE NULL END)
     ON CONFLICT (message_id, user_id) DO UPDATE SET
       delivered_at = COALESCE(message_deliveries.delivered_at, EXCLUDED.delivered_at)`,
    [messageId, userId, delivered]
  );
}

async function markDelivered(messageId, userId) {
  await pool.query(
    `UPDATE message_deliveries
     SET delivered_at = NOW()
     WHERE message_id = $1 AND user_id = $2 AND delivered_at IS NULL`,
    [messageId, userId]
  );
}

async function refreshPrivateConversationLastMessage(client, userA, userB) {
  await client.query(
    `WITH latest AS (
       SELECT id, created_at
       FROM messages
       WHERE group_id IS NULL
         AND ((sender_id = $1 AND receiver_id = $2)
           OR (sender_id = $2 AND receiver_id = $1))
       ORDER BY id DESC
       LIMIT 1
     )
     UPDATE conversations
     SET last_message_id = (SELECT id FROM latest),
         updated_at = COALESCE((SELECT created_at FROM latest), updated_at)
     WHERE type = 0
       AND ((user_id = $1 AND target_id = $2)
         OR (user_id = $2 AND target_id = $1))`,
    [userA, userB]
  );
}

async function refreshGroupConversationLastMessage(client, groupId) {
  await client.query(
    `WITH latest AS (
       SELECT id, created_at
       FROM messages
       WHERE group_id = $1
       ORDER BY id DESC
       LIMIT 1
     )
     UPDATE conversations
     SET last_message_id = (SELECT id FROM latest),
         updated_at = COALESCE((SELECT created_at FROM latest), updated_at)
     WHERE type = 1 AND target_id = $1`,
    [groupId]
  );
}

function initSocket(io) {
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('未授权'));
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const result = await pool.query('SELECT is_logged_in, token_version FROM users WHERE id = $1', [decoded.userId]);
      const current = result.rows[0];
      const tokenVersion = Number(decoded.tokenVersion ?? 0);
      if (!current || !current.is_logged_in || Number(current.token_version || 0) !== tokenVersion) {
        return next(new Error('登录状态已失效'));
      }
      socket.userId = decoded.userId;
      next();
    } catch {
      next(new Error('Token无效'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = String(socket.userId);
    console.log(`[Socket] User ${userId} connected: ${socket.id}`);

    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socket.id);

    const statusResult = await pool.query(
      'UPDATE users SET status = COALESCE(NULLIF(desired_status, 0), 1) WHERE id = $1 RETURNING status',
      [userId]
    ).catch(() => ({ rows: [{ status: 1 }] }));
    const currentStatus = statusResult.rows[0]?.status ?? 1;
    io.emit('user:status', { userId, status: currentStatus });

    try {
      const groups = await pool.query('SELECT group_id FROM group_members WHERE user_id = $1', [userId]);
      groups.rows.forEach(r => socket.join(`group:${r.group_id}`));
    } catch {}

    socket.emit('online:list', await getOnlineStatusList().catch(() => Array.from(onlineUsers.keys())));

    socket.on('message:private', async (data, ack) => {
      const { receiverId, type = 0, content, fileName, fileSize, fileUrl, replyTo } = data;
      try {
        const friendship = await pool.query(
          `SELECT 1 FROM friendships
           WHERE status = 1
             AND ((user_id = $1 AND friend_id = $2)
               OR (user_id = $2 AND friend_id = $1))
           LIMIT 1`,
          [socket.userId, receiverId]
        );
        if (!friendship.rows.length) {
          return ack && ack({ success: false, error: 'Not friends' });
        }

        let replyPreview = null;
        if (replyTo) {
          const r = await pool.query(
            'SELECT m.content, u.nickname AS sender FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id=$1',
            [replyTo]
          );
          if (r.rows.length) replyPreview = r.rows[0];
        }

        const result = await pool.query(
          `INSERT INTO messages (sender_id, receiver_id, type, content, file_name, file_size, file_url, reply_to, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1) RETURNING *`,
          [socket.userId, receiverId, type, content || null, fileName || null, fileSize || null, fileUrl || null, replyTo || null]
        );
        const msg = result.rows[0];

        const senderRes = await pool.query('SELECT nickname, avatar_url FROM users WHERE id=$1', [socket.userId]);
        const sender = senderRes.rows[0] || {};
        const fullMsg = { ...msg, sender_nickname: sender.nickname, sender_avatar: sender.avatar_url, reply_preview: replyPreview };

        await upsertConversation(socket.userId, receiverId, 0, msg.id, 0);
        await upsertConversation(receiverId, socket.userId, 0, msg.id, 1);
        await createDelivery(msg.id, receiverId, false);

        const receiverSockets = getSockets(io, receiverId);
        receiverSockets.forEach(sid => io.to(sid).emit('message:private', fullMsg));

        if (receiverSockets.size > 0) {
          await markDelivered(msg.id, receiverId);
          await pool.query('UPDATE messages SET status=2 WHERE id=$1', [msg.id]);
          fullMsg.status = 2;
        }

        ack && ack({ success: true, message: fullMsg });
      } catch (err) {
        console.error('[message:private]', err);
        ack && ack({ success: false, error: '发送失败' });
      }
    });

    socket.on('message:group', async (data, ack) => {
      const { groupId, type = 0, content, fileName, fileSize, fileUrl, replyTo } = data;
      try {
        const memberCheck = await pool.query(
          'SELECT id FROM group_members WHERE group_id=$1 AND user_id=$2',
          [groupId, socket.userId]
        );
        if (!memberCheck.rows.length) return ack && ack({ success: false, error: '非群成员' });

        let replyPreview = null;
        if (replyTo) {
          const r = await pool.query(
            'SELECT m.content, u.nickname AS sender FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id=$1',
            [replyTo]
          );
          if (r.rows.length) replyPreview = r.rows[0];
        }

        const result = await pool.query(
          `INSERT INTO messages (sender_id, group_id, type, content, file_name, file_size, file_url, reply_to, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1) RETURNING *`,
          [socket.userId, groupId, type, content || null, fileName || null, fileSize || null, fileUrl || null, replyTo || null]
        );
        const msg = result.rows[0];

        const senderRes = await pool.query('SELECT nickname, avatar_url FROM users WHERE id=$1', [socket.userId]);
        const sender = senderRes.rows[0] || {};
        const fullMsg = { ...msg, sender_nickname: sender.nickname, sender_avatar: sender.avatar_url, reply_preview: replyPreview };
        const members = await pool.query('SELECT user_id FROM group_members WHERE group_id=$1', [groupId]);
        for (const m of members.rows) {
          const isMe = String(m.user_id) === String(socket.userId);
          await upsertConversation(m.user_id, groupId, 1, msg.id, isMe ? 0 : 1);
          if (!isMe) await createDelivery(msg.id, m.user_id, false);
        }

        for (const m of members.rows) {
          if (String(m.user_id) === String(socket.userId)) continue;
          const memberSockets = getSockets(io, m.user_id);
          memberSockets.forEach(sid => io.to(sid).emit('message:group', fullMsg));
          if (memberSockets.size > 0) await markDelivered(msg.id, m.user_id);
        }

        ack && ack({ success: true, message: fullMsg });
      } catch (err) {
        console.error('[message:group]', err);
        ack && ack({ success: false, error: '发送失败' });
      }
    });

    socket.on('message:recall', async ({ messageId }) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query(
          'SELECT * FROM messages WHERE id=$1 AND sender_id=$2',
          [messageId, socket.userId]
        );
        if (!result.rows.length) {
          await client.query('ROLLBACK');
          return;
        }
        const msg = result.rows[0];
        if ((Date.now() - new Date(msg.created_at).getTime()) / 60000 > 3) {
          await client.query('ROLLBACK');
          return socket.emit('error', { message: '超过2分钟无法撤回' });
        }
        await client.query(
          `UPDATE messages
           SET content = NULL,
               file_name = NULL,
               file_size = NULL,
               file_url = NULL,
               reply_to = NULL,
               is_recalled = TRUE
           WHERE id = $1`,
          [messageId]
        );
        await client.query('COMMIT');
        const senderResult = await pool.query('SELECT nickname, avatar_url FROM users WHERE id=$1', [msg.sender_id]);
        const sender = senderResult.rows[0] || {};
        const payload = {
          messageId,
          groupId: msg.group_id,
          senderId: msg.sender_id,
          receiverId: msg.receiver_id,
          createdAt: msg.created_at,
          senderNickname: sender.nickname,
          senderAvatar: sender.avatar_url,
        };
        if (msg.group_id) {
          io.to(`group:${msg.group_id}`).emit('message:recalled', payload);
        } else {
          socket.emit('message:recalled', payload);
          emitToUser(io, msg.receiver_id, 'message:recalled', payload);
        }
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch {}
        console.error('[recall]', err);
      } finally {
        client.release();
      }
    });

    socket.on('typing:start', ({ targetId, isGroup }) => {
      if (isGroup) socket.to(`group:${targetId}`).emit('typing:start', { userId: socket.userId });
      else emitToUser(io, targetId, 'typing:start', { userId: socket.userId });
    });

    socket.on('typing:stop', ({ targetId, isGroup }) => {
      if (isGroup) socket.to(`group:${targetId}`).emit('typing:stop', { userId: socket.userId });
      else emitToUser(io, targetId, 'typing:stop', { userId: socket.userId });
    });

    socket.on('friend:request', async ({ targetId }) => {
      try {
        const userRes = await pool.query(
          'SELECT id, username, nickname, avatar_url FROM users WHERE id=$1',
          [socket.userId]
        );
        if (!userRes.rows.length) return;
        const fromUser = userRes.rows[0];

        const frRes = await pool.query(
          'SELECT id FROM friendships WHERE user_id=$1 AND friend_id=$2 AND status=0',
          [socket.userId, targetId]
        );
        const frId = frRes.rows[0]?.id;

        emitToUser(io, targetId, 'friend:request', {
          id: frId,
          user_id: fromUser.id,
          username: fromUser.username,
          nickname: fromUser.nickname,
          avatar_url: fromUser.avatar_url,
        });
      } catch (err) {
        console.error('[friend:request]', err);
      }
    });

    socket.on('friend:accepted', async ({ toId }) => {
      emitToUser(io, toId, 'friend:accepted', { byId: socket.userId });
      try {
        const result = await pool.query(
          'SELECT id, status FROM users WHERE id = ANY($1::int[])',
          [[Number(socket.userId), Number(toId)].filter(Number.isFinite)]
        );
        const statusMap = new Map(result.rows.map(row => [String(row.id), row.status]));
        const myStatus = statusMap.get(String(socket.userId));
        const otherStatus = statusMap.get(String(toId));
        if (myStatus != null) emitToUser(io, toId, 'user:status', { userId: socket.userId, status: myStatus });
        if (otherStatus != null) emitToUser(io, socket.userId, 'user:status', { userId: toId, status: otherStatus });
      } catch (err) {
        console.error('[friend:accepted:status]', err);
      }
    });

    socket.on('status:change', async ({ status }) => {
      const nextStatus = Number(status);
      if (![1, 2, 3, 4].includes(nextStatus)) return;
      await pool.query('UPDATE users SET status=$1, desired_status=$1 WHERE id=$2', [nextStatus, userId]).catch(() => {});
      io.emit('user:status', { userId, status: nextStatus });
    });

    socket.on('group:join', ({ groupId }) => socket.join(`group:${groupId}`));
    socket.on('group:leave', ({ groupId }) => socket.leave(`group:${groupId}`));

    socket.on('disconnect', async () => {
      const sockets = onlineUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(userId);
          await pool.query('UPDATE users SET status = 0 WHERE id = $1', [userId]).catch(() => {});
          io.emit('user:status', { userId, status: 0 });
        }
      }
      console.log(`[Socket] User ${userId} disconnected`);
    });
  });
}

module.exports = { initSocket };
