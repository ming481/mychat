# ChatApp — 全功能即时通讯 Web 应用

基于 **阿里巴巴 ChatUI** + **React** + **Node.js** + **Socket.io** + **PostgreSQL** 构建的全功能聊天应用，支持手机/电脑双端响应式。

---

## 功能概览

| 模块         | 功能                                                    |
| ------------ | ------------------------------------------------------- |
| 用户系统     | 注册/登录、在线状态（在线/忙碌/隐身/请勿打扰）、个人资料（头像/昵称/签名/地区）、修改密码 |
| 好友系统     | 搜索用户、发送/同意/拒绝好友申请、删除好友、设置备注   |
| 单聊         | 文本消息、图片/文件发送、消息撤回（2分钟内）、已读回执、正在输入指示 |
| 群聊         | 创建群聊、邀请/踢出成员、设置管理员、退出/解散群聊、群公告 |
| 文件传输     | 最大10MB上传/下载、图片/文件消息、头像上传              |
| 实时通信     | WebSocket 实时消息、在线状态广播、消息撤回推送          |
| 响应式       | 手机端单面板（会话列表/聊天）切换，PC端双栏布局        |

---

## 技术栈

| 层级       | 技术                                                 |
| ---------- | ---------------------------------------------------- |
| 前端 UI    | React 18 + **@chatui/core** (阿里巴巴 ChatUI)        |
| 状态管理   | Zustand                                              |
| 实时通信   | Socket.io-client                                     |
| HTTP 客户端| Axios                                                |
| 后端       | Node.js + Express + Socket.io                        |
| 数据库     | PostgreSQL                                           |
| 认证       | JWT + bcryptjs                                       |
| 文件存储   | 本地磁盘（≤10MB）                                    |

---

## 目录结构

```
chatapp/
├── server/               # 后端
│   ├── index.js          # 入口
│   ├── db/index.js       # 数据库初始化 + Schema
│   ├── middleware/auth.js # JWT 中间件
│   ├── routes/
│   │   ├── auth.js       # 注册/登录/修改密码
│   │   ├── users.js      # 用户搜索/资料
│   │   ├── friends.js    # 好友管理
│   │   ├── messages.js   # 消息历史/会话
│   │   ├── groups.js     # 群聊管理
│   │   └── files.js      # 文件上传
│   ├── socket/index.js   # Socket.io 实时逻辑
│   ├── uploads/          # 上传文件目录（自动创建）
│   └── .env.example      # 环境变量示例
└── client/               # 前端
    ├── public/index.html
    └── src/
        ├── App.jsx        # 根组件
        ├── index.js       # 入口
        ├── store/index.js # Zustand 全局状态
        ├── hooks/
        │   └── useSocket.js  # Socket.io hook
        ├── utils/
        │   ├── api.js     # Axios API 封装
        │   └── toast.js   # 通知
        ├── pages/
        │   └── AuthPage.jsx  # 登录/注册页
        ├── components/
        │   ├── Sidebar.jsx       # 左侧栏（会话/好友/群组）
        │   ├── ChatWindow.jsx    # 聊天窗口（基于 ChatUI）
        │   ├── SearchModal.jsx   # 搜索/添加好友/创建群聊
        │   └── ProfileModal.jsx  # 个人资料编辑
        └── styles/app.css        # 全局样式（深色主题）
```

---

## 快速启动

### 1. 准备 PostgreSQL

```bash
psql -U postgres
CREATE DATABASE chatapp;
\q
```

### 2. 启动后端

```bash
cd server
npm install
cp .env.example .env
# 编辑 .env，填入你的 PostgreSQL 信息
npm run dev
```

后端默认运行在 `http://localhost:5000`，首次启动会自动建表。

### 3. 启动前端

```bash
cd client
npm install
npm start
```

前端默认运行在 `http://localhost:3000`。

---

## 环境变量说明（server/.env）

```env
PORT=5000
CLIENT_URL=http://localhost:3000

DB_HOST=localhost
DB_PORT=5432
DB_NAME=chatapp
DB_USER=postgres
DB_PASS=your_password

JWT_SECRET=your_very_secret_key_change_this
```

---

## 部署建议

- **前端**：`npm run build` 后部署到 Nginx/CDN
- **后端**：使用 PM2 守护进程，配合 Nginx 反向代理
- **数据库**：生产环境建议使用连接池 + SSL
- **文件存储**：大规模部署建议替换为 OSS/S3
- **HTTPS**：生产环境必须启用 HTTPS，Socket.io 也需要 wss://

---

## 待扩展功能（按优先级）

- [ ] 语音/视频通话（WebRTC）
- [ ] 消息引用（回复指定消息）
- [ ] 表情包/贴图
- [ ] 群文件共享
- [ ] 消息搜索
- [ ] 推送通知（PWA + Web Push）
- [ ] 端到端加密（E2EE）
- [ ] 聊天记录导出
