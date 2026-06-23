require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const authRoutes    = require('./routes/auth');
const userRoutes    = require('./routes/users');
const friendRoutes  = require('./routes/friends');
const messageRoutes = require('./routes/messages');
const groupRoutes   = require('./routes/groups');
const fileRoutes    = require('./routes/files');
const { initSocket } = require('./socket/index');
const { initDB, pool }    = require('./db/index');
const { scheduleFileCleanup } = require('./utils/fileCleanup');

const app    = express();
const server = http.createServer(app);

const corsOptions = {
  origin: (origin, callback) => callback(null, true), // 开发环境全放行
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
};

const io = new Server(server, {
  cors: corsOptions,
  maxHttpBufferSize: 10 * 1024 * 1024,
  pingTimeout: 60000, // 增加到 60秒，防止手机选文件时断连
  pingInterval: 25000,
});


// 把 io 注入到 groups 路由（用于群创建后实时通知）
groupRoutes.setIO(io);
userRoutes.setIO(io);
groupRoutes.setIO(io);
friendRoutes.setIO(io);

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/auth',     authRoutes);
app.use('/api/users',    userRoutes);
app.use('/api/friends',  friendRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/groups',   groupRoutes);
app.use('/api/files',    fileRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

initSocket(io);

const PORT = process.env.PORT || 5000;
const FILE_TTL_DAYS = Number(process.env.FILE_TTL_DAYS || 7);
const FILE_CLEANUP_INTERVAL_MS = Number(process.env.FILE_CLEANUP_INTERVAL_MS || 6 * 60 * 60 * 1000);

async function start() {
  try {
    await initDB();
    scheduleFileCleanup({
      pool,
      uploadDir: path.join(__dirname, 'uploads'),
      ttlDays: FILE_TTL_DAYS,
      intervalMs: FILE_CLEANUP_INTERVAL_MS,
    });
    server.listen(PORT, '0.0.0.0', () => {
      console.log('');
      console.log('🚀 ChatApp 服务器已启动');
      console.log('─────────────────────────────');
      console.log(`   本机:   http://localhost:${PORT}`);
      console.log('─────────────────────────────');
    });
  } catch (err) {
    console.error('启动失败:', err);
    process.exit(1);
  }
}

start();
