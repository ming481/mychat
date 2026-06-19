#!/bin/bash
set -e

echo "=== ChatApp 启动脚本 ==="

# 1. 检查 Node.js
node --version >/dev/null 2>&1 || { echo "❌ 请先安装 Node.js (>=16)"; exit 1; }

# 2. 检查 PostgreSQL
psql --version >/dev/null 2>&1 || { echo "⚠️  未检测到 psql 命令，请确保 PostgreSQL 已运行"; }

# 3. 安装依赖
echo "📦 安装后端依赖..."
cd server && npm install
echo "📦 安装前端依赖..."
cd ../client && npm install
cd ..

# 4. 提示配置
if [ ! -f server/.env ]; then
  cp server/.env.example server/.env
  echo "⚠️  已创建 server/.env，请编辑填入数据库密码和 JWT_SECRET"
  echo "   然后重新运行此脚本"
  exit 0
fi

echo ""
echo "✅ 依赖安装完成"
echo ""
echo "启动方式："
echo "  终端1: cd server && npm run dev   (后端 :5000)"
echo "  终端2: cd client && npm start      (前端 :3000)"
echo ""
echo "或使用 concurrently 同时启动："
echo "  npm install -g concurrently"
echo "  concurrently \"cd server && npm run dev\" \"cd client && npm start\""
