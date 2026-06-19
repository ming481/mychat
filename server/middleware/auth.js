const jwt = require('jsonwebtoken');
const { pool } = require('../db/index');

const JWT_SECRET = process.env.JWT_SECRET || 'chatapp_secret_2024';

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未授权', kick: true });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query(
      'SELECT is_logged_in, token_version FROM users WHERE id = $1',
      [decoded.userId]
    );
    const current = result.rows[0];
    const tokenVersion = Number(decoded.tokenVersion ?? 0);
    const currentVersion = Number(current?.token_version ?? 0);

    if (!current || !current.is_logged_in || currentVersion !== tokenVersion) {
      return res.status(401).json({ error: '登录状态已失效，请重新登录', kick: true });
    }

    req.userId = decoded.userId;
    req.tokenVersion = tokenVersion;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token无效', kick: true });
  }
}

function generateToken(userId, tokenVersion = 0) {
  return jwt.sign({ userId, tokenVersion: Number(tokenVersion || 0) }, JWT_SECRET);
}

module.exports = { authMiddleware, generateToken, JWT_SECRET };
