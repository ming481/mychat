const express = require('express');
const { pool } = require('../db/index');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
let _io = null;

function setIO(io) {
  _io = io;
}

function emitToUser(userId, event, data) {
  if (!_io) return;
  _io.sockets.sockets.forEach(socket => {
    if (String(socket.userId) === String(userId)) {
      socket.emit(event, data);
    }
  });
}

router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.nickname, u.avatar_url, u.status, u.signature,
              f.remark, f.group_name, f.id AS friendship_id
       FROM friendships f
       JOIN users u ON u.id = f.friend_id
       WHERE f.user_id = $1 AND f.status = 1
       ORDER BY f.group_name, u.nickname`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[friends:list]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/request', authMiddleware, async (req, res) => {
  const { friendId } = req.body;
  if (String(friendId) === String(req.userId)) {
    return res.status(400).json({ error: 'Cannot add yourself' });
  }

  try {
    const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [friendId]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const exists = await pool.query(
      'SELECT id, status FROM friendships WHERE user_id = $1 AND friend_id = $2',
      [req.userId, friendId]
    );

    if (exists.rows.length > 0) {
      if (exists.rows[0].status === 1) return res.status(400).json({ error: 'Already friends' });
      if (exists.rows[0].status === 0) return res.status(400).json({ error: 'Request already sent' });
      await pool.query('UPDATE friendships SET status = 0, created_at = NOW() WHERE id = $1', [exists.rows[0].id]);
    } else {
      await pool.query(
        'INSERT INTO friendships (user_id, friend_id, status) VALUES ($1, $2, 0)',
        [req.userId, friendId]
      );
    }

    res.json({ message: 'ok' });
  } catch (err) {
    console.error('[friends:request]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/requests', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT f.id, f.user_id, f.created_at,
              u.username, u.nickname, u.avatar_url, u.signature
       FROM friendships f
       JOIN users u ON u.id = f.user_id
       WHERE f.friend_id = $1 AND f.status = 0
       ORDER BY f.created_at DESC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[friends:requests]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/request/:id', authMiddleware, async (req, res) => {
  const { action } = req.body;
  if (!['accept', 'reject', 'ignore'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const reqResult = await client.query(
      'SELECT * FROM friendships WHERE id = $1 AND friend_id = $2 AND status = 0',
      [req.params.id, req.userId]
    );
    if (reqResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Request not found' });
    }

    const fr = reqResult.rows[0];
    if (action === 'accept') {
      await client.query('UPDATE friendships SET status = 1 WHERE id = $1', [fr.id]);
      await client.query(
        `INSERT INTO friendships (user_id, friend_id, status)
         VALUES ($1, $2, 1)
         ON CONFLICT (user_id, friend_id) DO UPDATE SET status = 1`,
        [req.userId, fr.user_id]
      );
      await client.query(
        `UPDATE conversations
         SET group_state='active'
         WHERE type=0
           AND ((user_id=$1 AND target_id=$2)
             OR (user_id=$2 AND target_id=$1))`,
        [req.userId, fr.user_id]
      );
    } else {
      const statusMap = { reject: 2, ignore: 3 };
      await client.query('UPDATE friendships SET status = $1 WHERE id = $2', [statusMap[action], fr.id]);
    }

    await client.query('COMMIT');
    res.json({ message: 'ok' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[friends:handle-request]', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

router.delete('/:friendId', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE friendships
       SET status = 3
       WHERE (user_id = $1 AND friend_id = $2)
          OR (user_id = $2 AND friend_id = $1)`,
      [req.userId, req.params.friendId]
    );
    const users = await client.query(
      'SELECT id, nickname, avatar_url FROM users WHERE id = ANY($1::int[])',
      [[Number(req.userId), Number(req.params.friendId)].filter(Number.isFinite)]
    );
    const userMap = new Map(users.rows.map(user => [String(user.id), user]));
    const me = userMap.get(String(req.userId)) || {};
    const friend = userMap.get(String(req.params.friendId)) || {};
    await client.query(
      `UPDATE conversations
       SET group_state='unfriended',
           target_name_snapshot = CASE
             WHEN user_id = $1 THEN $3
             WHEN user_id = $2 THEN $5
             ELSE target_name_snapshot
           END,
           target_avatar_snapshot = CASE
             WHEN user_id = $1 THEN $4
             WHEN user_id = $2 THEN $6
             ELSE target_avatar_snapshot
           END,
           updated_at=NOW()
       WHERE type = 0
         AND ((user_id = $1 AND target_id = $2)
           OR (user_id = $2 AND target_id = $1))`,
      [
        req.userId,
        req.params.friendId,
        friend.nickname || '',
        friend.avatar_url || '',
        me.nickname || '',
        me.avatar_url || '',
      ]
    );
    await client.query('COMMIT');

    emitToUser(req.userId, 'friend:deleted', { friendId: Number(req.params.friendId), friend });
    emitToUser(req.params.friendId, 'friend:deleted', { friendId: Number(req.userId), friend: me });
    res.json({ message: 'ok' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[friends:delete]', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

router.put('/:friendId/remark', authMiddleware, async (req, res) => {
  const { remark } = req.body;
  try {
    await pool.query(
      'UPDATE friendships SET remark = $1 WHERE user_id = $2 AND friend_id = $3',
      [remark, req.userId, req.params.friendId]
    );
    res.json({ message: 'ok' });
  } catch (err) {
    console.error('[friends:remark]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
module.exports.setIO = setIO;
