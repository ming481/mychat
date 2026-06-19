const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db/index');
const { onlineUsers } = require('../socket/state');
const { generateToken, authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.post('/register', async (req, res) => {
  const { username, password, nickname } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  if (username.length < 3) return res.status(400).json({ error: '用户名至少3个字符' });
  if (password.length < 6) return res.status(400).json({ error: '密码至少6个字符' });

  try {
    const exists = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (exists.rows.length > 0) return res.status(400).json({ error: '用户名已存在' });

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, nickname, status, desired_status, is_logged_in, token_version)
       VALUES ($1, $2, $3, 1, 1, TRUE, 1)
       RETURNING id, username, nickname, avatar_url, status, desired_status, signature, gender, region, token_version`,
      [username, hash, nickname || username]
    );
    const user = result.rows[0];
    const token = generateToken(user.id, user.token_version);
    const { token_version, ...userInfo } = user;
    res.json({ token, user: userInfo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '服务器错误' });
  }
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });

  try {
    const result = await pool.query(
      `SELECT id, username, nickname, avatar_url, password_hash, status, desired_status, signature,
              gender, region, is_logged_in, token_version
       FROM users
       WHERE username = $1`,
      [username]
    );

    if (result.rows.length === 0) return res.status(400).json({ error: '用户名或密码错误' });

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(400).json({ error: '用户名或密码错误' });

    const activeSockets = onlineUsers.get(String(user.id));
    if (user.is_logged_in && activeSockets && activeSockets.size > 0) {
      return res.status(403).json({ error: '该账号正在其他客户端使用，请先在原客户端主动退出登录' });
    }

    const versionResult = await pool.query(
      `UPDATE users
       SET status = COALESCE(NULLIF(desired_status, 0), 1),
           is_logged_in = TRUE,
           token_version = COALESCE(token_version, 0) + 1
       WHERE id = $1
       RETURNING token_version, status`,
      [user.id]
    );

    user.status = versionResult.rows[0].status;
    user.token_version = versionResult.rows[0].token_version;

    const { password_hash, token_version, desired_status, ...userInfo } = user;
    const token = generateToken(user.id, user.token_version);
    res.json({ token, user: userInfo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '服务器错误' });
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, nickname, avatar_url,
              CASE WHEN is_logged_in AND status = 0 THEN COALESCE(NULLIF(desired_status, 0), 1) ELSE status END AS status,
              signature,
              gender, region, is_logged_in, created_at
       FROM users
       WHERE id = $1`,
      [req.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: '用户不存在' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

router.post('/change-password', authMiddleware, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  try {
    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.userId]);
    const user = result.rows[0];
    const valid = await bcrypt.compare(oldPassword, user.password_hash);
    if (!valid) return res.status(400).json({ error: '原密码错误' });

    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      'UPDATE users SET password_hash = $1, token_version = COALESCE(token_version, 0) + 1 WHERE id = $2',
      [hash, req.userId]
    );
    res.json({ message: '密码修改成功' });
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

router.post('/logout', authMiddleware, async (req, res) => {
  try {
    await pool.query(
      `UPDATE users
       SET status = 0,
           is_logged_in = FALSE,
           token_version = COALESCE(token_version, 0) + 1
       WHERE id = $1`,
      [req.userId]
    );
    res.json({ message: '登出成功' });
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

module.exports = router;
