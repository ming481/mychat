const express = require('express');
const { pool } = require('../db/index');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
let _io = null;
function setIO(io) { _io = io; }

// 搜索用户
router.get('/search', authMiddleware, async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);
  try {
    const result = await pool.query(
      `SELECT id, username, nickname, avatar_url, status, signature 
       FROM users WHERE (username ILIKE $1 OR nickname ILIKE $1) AND id != $2 LIMIT 20`,
      [`%${q}%`, req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取用户信息
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, nickname, avatar_url, status, signature, gender, region FROM users WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: '用户不存在' });
    const updated = result.rows[0];
    if (_io && updated) {
      const friends = await pool.query(
        'SELECT user_id FROM friendships WHERE friend_id = $1 AND status = 1',
        [req.userId]
      );
      friends.rows.forEach(row => {
        _io.sockets.sockets.forEach(socket => {
          if (String(socket.userId) === String(row.user_id)) {
            socket.emit('user:profile_updated', updated);
          }
        });
      });
      _io.sockets.sockets.forEach(socket => {
        if (String(socket.userId) === String(req.userId)) {
          socket.emit('user:profile_updated', updated);
        }
      });
    }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// 更新个人资料
router.put('/profile', authMiddleware, async (req, res) => {
  const { nickname, signature, gender, region, avatar_url } = req.body;
  try {
    const result = await pool.query(
      `UPDATE users SET nickname = COALESCE($1, nickname), signature = COALESCE($2, signature),
       gender = COALESCE($3, gender), region = COALESCE($4, region),
       avatar_url = COALESCE($5, avatar_url) WHERE id = $6
       RETURNING id, username, nickname, avatar_url, status, signature, gender, region`,
      [nickname, signature, gender, region, avatar_url, req.userId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// 更新在线状态
router.put('/status', authMiddleware, async (req, res) => {
  const status = Number(req.body.status); // 1:在线 2:忙碌 3:隐身 4:请勿打扰
  if (![1, 2, 3, 4].includes(status)) return res.status(400).json({ error: '无效状态' });
  try {
    const result = await pool.query(
      `UPDATE users
       SET status = $1, desired_status = $1
       WHERE id = $2
       RETURNING id, username, nickname, avatar_url, status, signature, gender, region`,
      [status, req.userId]
    );
    if (_io) _io.emit('user:status', { userId: req.userId, status });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

module.exports = router;
module.exports.setIO = setIO;
