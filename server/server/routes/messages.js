const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db/index');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const FILE_TTL_DAYS = Number(process.env.FILE_TTL_DAYS || 7);

function shouldMarkRead(req) {
  return req.query.markRead !== '0';
}

function mapMessageRows(rows) {
  return rows.map(m => ({
    ...m,
    reply_preview: m.reply_to ? { content: m.reply_content, sender: m.reply_sender } : null,
  }));
}


function lastMessageOf(messages) {
  return messages[messages.length - 1] || null;
}

function conversationFromSync(type, id, name, avatar, messages) {
  const last = lastMessageOf(messages);
  return {
    type,
    target_id: id,
    target_name: name || '',
    target_avatar: avatar || '',
    last_message_id: last?.id || null,
    last_content: last?.content || null,
    last_msg_type: last?.type ?? null,
    last_msg_time: last?.created_at || null,
    updated_at: last?.created_at || null,
    unread_count: 0,
    is_recalled: Boolean(last?.is_recalled),
    messages,
  };
}
async function markDeliveredForRows(userId, rows, client = pool) {
  const ids = rows.map(row => Number(row.id)).filter(Number.isFinite);
  if (!ids.length) return;
  await client.query(
    `UPDATE message_deliveries
     SET delivered_at = NOW()
     WHERE user_id = $1
       AND message_id = ANY($2::int[])
       AND delivered_at IS NULL`,
    [userId, ids]
  );
}

async function getPendingPrivateMessages(userId, friendId, limit) {
  return pool.query(
    `SELECT m.*, u.nickname AS sender_nickname, u.avatar_url AS sender_avatar,
            rm.content AS reply_content, ru.nickname AS reply_sender,
            CASE WHEN m.type IN (1,2)
              AND (m.created_at < NOW() - ($4 * INTERVAL '1 day')
                OR (m.file_url IS NULL AND m.content IS NULL))
            THEN TRUE ELSE FALSE END AS is_expired
     FROM message_deliveries d
     JOIN messages m ON m.id = d.message_id
     JOIN users u ON u.id = m.sender_id
     LEFT JOIN messages rm ON rm.id = m.reply_to
     LEFT JOIN users ru ON ru.id = rm.sender_id
     WHERE d.user_id = $1
       AND d.delivered_at IS NULL
       AND m.sender_id = $2
       AND m.receiver_id = $1
       AND m.group_id IS NULL
     ORDER BY m.id ASC
     LIMIT $3`,
    [userId, friendId, limit, FILE_TTL_DAYS]
  );
}

async function getPendingGroupMessages(userId, groupId, maxMessageId, limit) {
  return pool.query(
    `SELECT m.*, u.nickname AS sender_nickname, u.avatar_url AS sender_avatar,
            rm.content AS reply_content, ru.nickname AS reply_sender,
            CASE WHEN m.type IN (1,2)
              AND (m.created_at < NOW() - ($5 * INTERVAL '1 day')
                OR (m.file_url IS NULL AND m.content IS NULL))
            THEN TRUE ELSE FALSE END AS is_expired
     FROM message_deliveries d
     JOIN messages m ON m.id = d.message_id
     JOIN users u ON u.id = m.sender_id
     LEFT JOIN messages rm ON rm.id = m.reply_to
     LEFT JOIN users ru ON ru.id = rm.sender_id
     WHERE d.user_id = $1
       AND d.delivered_at IS NULL
       AND m.group_id = $2
       AND m.sender_id <> $1
       AND m.id <= $3
     ORDER BY m.id ASC
     LIMIT $4`,
    [userId, groupId, maxMessageId, limit, FILE_TTL_DAYS]
  );
}

router.post('/history-sync', authMiddleware, async (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Password is required' });

  try {
    const userRes = await pool.query('SELECT password_hash FROM users WHERE id=$1', [req.userId]);
    const user = userRes.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(403).json({ error: 'Password incorrect' });

    const conversations = [];
    const syncedMessageIds = [];
    const syncedPrivateIds = [];
    const syncedGroupIds = [];

    const friends = await pool.query(
      `SELECT u.id, u.nickname, u.avatar_url
       FROM friendships f
       JOIN users u ON u.id = f.friend_id
       WHERE f.user_id = $1 AND f.status = 1
       ORDER BY u.nickname`,
      [req.userId]
    );

    for (const friend of friends.rows) {
      const result = await pool.query(
        `SELECT m.*, u.nickname AS sender_nickname, u.avatar_url AS sender_avatar,
                rm.content AS reply_content, ru.nickname AS reply_sender,
                CASE WHEN m.type IN (1,2)
                  AND (m.created_at < NOW() - ($3 * INTERVAL '1 day')
                    OR (m.file_url IS NULL AND m.content IS NULL))
                THEN TRUE ELSE FALSE END AS is_expired
         FROM messages m
         JOIN users u ON u.id = m.sender_id
         LEFT JOIN messages rm ON rm.id = m.reply_to
         LEFT JOIN users ru ON ru.id = rm.sender_id
         WHERE ((m.sender_id = $1 AND m.receiver_id = $2)
             OR (m.sender_id = $2 AND m.receiver_id = $1))
           AND m.group_id IS NULL
         ORDER BY m.id ASC`,
        [req.userId, friend.id, FILE_TTL_DAYS]
      );
      const messages = mapMessageRows(result.rows);
      syncedPrivateIds.push(Number(friend.id));
      syncedMessageIds.push(...messages.map(msg => Number(msg.id)).filter(Number.isFinite));
      conversations.push(conversationFromSync(
        0,
        friend.id,
        friend.nickname,
        friend.avatar_url,
        messages
      ));
    }

    const groups = await pool.query(
      `SELECT g.id, g.name, g.avatar_url
       FROM groups g
       JOIN group_members gm ON gm.group_id = g.id
       WHERE gm.user_id = $1
       ORDER BY g.name`,
      [req.userId]
    );

    for (const group of groups.rows) {
      const result = await pool.query(
        `SELECT m.*, u.nickname AS sender_nickname, u.avatar_url AS sender_avatar,
                rm.content AS reply_content, ru.nickname AS reply_sender,
                CASE WHEN m.type IN (1,2)
                  AND (m.created_at < NOW() - ($2 * INTERVAL '1 day')
                    OR (m.file_url IS NULL AND m.content IS NULL))
                THEN TRUE ELSE FALSE END AS is_expired
         FROM messages m
         JOIN users u ON u.id = m.sender_id
         LEFT JOIN messages rm ON rm.id = m.reply_to
         LEFT JOIN users ru ON ru.id = rm.sender_id
         WHERE m.group_id = $1
         ORDER BY m.id ASC`,
        [group.id, FILE_TTL_DAYS]
      );
      const messages = mapMessageRows(result.rows);
      syncedGroupIds.push(Number(group.id));
      syncedMessageIds.push(...messages.map(msg => Number(msg.id)).filter(Number.isFinite));
      conversations.push(conversationFromSync(
        1,
        group.id,
        group.name,
        group.avatar_url,
        messages
      ));
    }

    const uniqueMessageIds = [...new Set(syncedMessageIds)];
    if (uniqueMessageIds.length) {
      await pool.query(
        `UPDATE message_deliveries
         SET delivered_at = NOW()
         WHERE user_id = $1
           AND message_id = ANY($2::int[])
           AND delivered_at IS NULL`,
        [req.userId, uniqueMessageIds]
      );
    }
    if (syncedPrivateIds.length) {
      await pool.query(
        `UPDATE conversations
         SET unread_count = 0
         WHERE user_id = $1
           AND type = 0
           AND target_id = ANY($2::int[])`,
        [req.userId, syncedPrivateIds]
      );
    }
    if (syncedGroupIds.length) {
      await pool.query(
        `UPDATE conversations
         SET unread_count = 0
         WHERE user_id = $1
           AND type = 1
           AND target_id = ANY($2::int[])`,
        [req.userId, syncedGroupIds]
      );
    }

    res.json({ conversations });
  } catch (err) {
    console.error('[messages:history-sync]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 鈹€鈹€ 鑾峰彇浼氳瘽鍒楄〃 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
router.get('/conversations', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*,
        CASE WHEN c.type = 0 THEN u.nickname ELSE COALESCE(g.name, c.target_name_snapshot) END AS target_name,
        CASE WHEN c.type = 0 THEN u.avatar_url ELSE COALESCE(g.avatar_url, c.target_avatar_snapshot) END AS target_avatar,
        CASE WHEN c.type = 0 THEN u.status ELSE NULL END AS target_status,
        m.content AS last_content,
        m.type AS last_msg_type,
        m.created_at AS last_msg_time,
        m.is_recalled
       FROM conversations c
       LEFT JOIN users u ON c.type = 0 AND u.id = c.target_id
       LEFT JOIN groups g ON c.type = 1 AND g.id = c.target_id
       LEFT JOIN group_members gm ON c.type = 1 AND gm.group_id = c.target_id AND gm.user_id = c.user_id
       LEFT JOIN messages m ON m.id = c.last_message_id
       WHERE c.user_id = $1
         AND (c.type = 0 OR gm.id IS NOT NULL OR c.group_state IN ('kicked', 'dissolved'))
       ORDER BY c.is_pinned DESC, c.updated_at DESC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 鈹€鈹€ 鑾峰彇鍗曡亰鍘嗗彶 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
router.get('/private/:friendId', authMiddleware, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 50;
  const offset = (page - 1) * limit;
  try {
    const result = await pool.query(
      `SELECT m.*, u.nickname AS sender_nickname, u.avatar_url AS sender_avatar,
              rm.content AS reply_content, ru.nickname AS reply_sender,
              CASE WHEN m.type IN (1,2)
                AND (m.created_at < NOW() - ($5 * INTERVAL '1 day')
                  OR (m.file_url IS NULL AND m.content IS NULL))
              THEN TRUE ELSE FALSE END AS is_expired
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       LEFT JOIN messages rm ON rm.id = m.reply_to
       LEFT JOIN users ru ON ru.id = rm.sender_id
       WHERE ((m.sender_id = $1 AND m.receiver_id = $2)
           OR (m.sender_id = $2 AND m.receiver_id = $1))
         AND m.group_id IS NULL
       ORDER BY m.created_at DESC
       LIMIT $3 OFFSET $4`,
      [req.userId, req.params.friendId, limit, offset, FILE_TTL_DAYS]
    );
    if (shouldMarkRead(req)) {
      await pool.query(
        `UPDATE conversations SET unread_count = 0
         WHERE user_id = $1 AND target_id = $2 AND type = 0`,
        [req.userId, req.params.friendId]
      );
    }

    // Add reply_preview field
    const msgs = mapMessageRows(result.rows.reverse());
    res.json(msgs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 鈹€鈹€ 鑾峰彇缇よ亰鍘嗗彶 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
router.get('/private/:friendId/sync', authMiddleware, async (req, res) => {
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 200));
  try {
    const result = await getPendingPrivateMessages(req.userId, req.params.friendId, limit);
    await markDeliveredForRows(req.userId, result.rows);
    if (shouldMarkRead(req)) {
      await pool.query(
        `UPDATE conversations SET unread_count = 0
         WHERE user_id = $1 AND target_id = $2 AND type = 0`,
        [req.userId, req.params.friendId]
      );
    }
    res.json(mapMessageRows(result.rows));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/private/:friendId/unread', authMiddleware, async (req, res) => {
  try {
    const result = await getPendingPrivateMessages(req.userId, req.params.friendId, 200);
    if (!result.rows.length) return res.json([]);
    await markDeliveredForRows(req.userId, result.rows);
    if (shouldMarkRead(req)) {
      await pool.query(
        `UPDATE conversations SET unread_count = 0
         WHERE user_id = $1 AND target_id = $2 AND type = 0`,
        [req.userId, req.params.friendId]
      );
    }
    res.json(mapMessageRows(result.rows));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/group/:groupId', authMiddleware, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 50;
  const offset = (page - 1) * limit;
  try {
    const member = await pool.query(
      'SELECT id FROM group_members WHERE group_id=$1 AND user_id=$2',
      [req.params.groupId, req.userId]
    );
    const conv = await pool.query(
      `SELECT group_state, last_message_id FROM conversations
       WHERE user_id=$1 AND target_id=$2 AND type=1`,
      [req.userId, req.params.groupId]
    );
    const inactive = ['kicked', 'dissolved'].includes(conv.rows[0]?.group_state);
    if (!member.rows.length && !inactive) return res.status(403).json({ error: 'Not a group member' });
    const maxMessageId = inactive ? Number(conv.rows[0]?.last_message_id || 0) : 2147483647;

    const result = await pool.query(
      `SELECT m.*, u.nickname AS sender_nickname, u.avatar_url AS sender_avatar,
              rm.content AS reply_content, ru.nickname AS reply_sender,
              CASE WHEN m.type IN (1,2)
                AND (m.created_at < NOW() - ($4 * INTERVAL '1 day')
                  OR (m.file_url IS NULL AND m.content IS NULL))
              THEN TRUE ELSE FALSE END AS is_expired
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       LEFT JOIN messages rm ON rm.id = m.reply_to
       LEFT JOIN users ru ON ru.id = rm.sender_id
       WHERE m.group_id = $1
         AND m.id <= $5
       ORDER BY m.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.params.groupId, limit, offset, FILE_TTL_DAYS, maxMessageId]
    );
    if (shouldMarkRead(req) && member.rows.length) {
      await pool.query(
        `UPDATE conversations SET unread_count = 0
         WHERE user_id = $1 AND target_id = $2 AND type = 1`,
        [req.userId, req.params.groupId]
      );
    }
    const msgs = mapMessageRows(result.rows.reverse());
    res.json(msgs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 鈹€鈹€ 鎾ゅ洖娑堟伅 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
router.get('/group/:groupId/sync', authMiddleware, async (req, res) => {
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 200));
  try {
    const member = await pool.query(
      'SELECT id FROM group_members WHERE group_id=$1 AND user_id=$2',
      [req.params.groupId, req.userId]
    );
    const conv = await pool.query(
      `SELECT group_state, last_message_id FROM conversations
       WHERE user_id=$1 AND target_id=$2 AND type=1`,
      [req.userId, req.params.groupId]
    );
    const inactive = ['kicked', 'dissolved'].includes(conv.rows[0]?.group_state);
    if (!member.rows.length && !inactive) return res.status(403).json({ error: 'Not a group member' });
    const maxMessageId = inactive ? Number(conv.rows[0]?.last_message_id || 0) : 2147483647;

    const result = await getPendingGroupMessages(req.userId, req.params.groupId, maxMessageId, limit);
    await markDeliveredForRows(req.userId, result.rows);
    if (shouldMarkRead(req) && member.rows.length) {
      await pool.query(
        `UPDATE conversations SET unread_count = 0
         WHERE user_id = $1 AND target_id = $2 AND type = 1`,
        [req.userId, req.params.groupId]
      );
    }
    res.json(mapMessageRows(result.rows));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/group/:groupId/unread', authMiddleware, async (req, res) => {
  try {
    const member = await pool.query(
      'SELECT id FROM group_members WHERE group_id=$1 AND user_id=$2',
      [req.params.groupId, req.userId]
    );
    const conv = await pool.query(
      `SELECT group_state, last_message_id FROM conversations
       WHERE user_id=$1 AND target_id=$2 AND type=1`,
      [req.userId, req.params.groupId]
    );
    const inactive = ['kicked', 'dissolved'].includes(conv.rows[0]?.group_state);
    if (!member.rows.length && !inactive) return res.status(403).json({ error: 'Not a group member' });
    const maxMessageId = inactive ? Number(conv.rows[0]?.last_message_id || 0) : 2147483647;

    const result = await getPendingGroupMessages(req.userId, req.params.groupId, maxMessageId, 200);
    if (!result.rows.length) return res.json([]);
    await markDeliveredForRows(req.userId, result.rows);
    if (shouldMarkRead(req) && member.rows.length) {
      await pool.query(
        `UPDATE conversations SET unread_count = 0
         WHERE user_id = $1 AND target_id = $2 AND type = 1`,
        [req.userId, req.params.groupId]
      );
    }
    res.json(mapMessageRows(result.rows));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id/recall', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM messages WHERE id = $1 AND sender_id = $2',
      [req.params.id, req.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: '消息不存在' });
    const msg = result.rows[0];
    const elapsed = (Date.now() - new Date(msg.created_at).getTime()) / 1000 / 60;
    if (elapsed > 3) return res.status(400).json({ error: '超过3分钟无法撤回' });
    await pool.query(
      `UPDATE messages
       SET content = NULL,
           file_name = NULL,
           file_size = NULL,
           file_url = NULL,
           reply_to = NULL,
           is_recalled = TRUE
       WHERE id = $1`,
      [req.params.id]
    );
    res.json({ message: 'ok' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 鈹€鈹€ 娓呴櫎鏈 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
router.put('/conversations/:targetId/read', authMiddleware, async (req, res) => {
  const type = parseInt(req.query.type) || 0;
  try {
    await pool.query(
      'UPDATE conversations SET unread_count = 0 WHERE user_id = $1 AND target_id = $2 AND type = $3',
      [req.userId, req.params.targetId, type]
    );
    res.json({ message: 'ok' });
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// 鈹€鈹€ 鍒犻櫎鍗曟潯娑堟伅 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query(
      `UPDATE messages
       SET content = NULL,
           file_name = NULL,
           file_size = NULL,
           file_url = NULL,
           reply_to = NULL,
           is_recalled = TRUE
       WHERE id = $1 AND sender_id = $2`,
      [req.params.id, req.userId]
    );
    res.json({ message: 'ok' });
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

module.exports = router;


