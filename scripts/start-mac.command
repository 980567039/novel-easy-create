#!/bin/bash

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR" || exit 1

echo "========================================"
echo " 小白作家 - macOS 一键启动"
echo "========================================"
echo "项目目录：$PROJECT_DIR"
echo

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "未找到 Node.js 或 npm。请先安装 Node.js 20+："
  echo "https://nodejs.org/"
  read -r -p "按回车键退出..."
  exit 1
fi

echo "Node: $(node --version)"
echo "npm:  $(npm --version)"

if [ ! -d "node_modules" ]; then
  echo
  echo "正在安装项目依赖..."
  npm ci || {
    echo "依赖安装失败。"
    read -r -p "按回车键退出..."
    exit 1
  }
fi

if [ ! -f ".env" ]; then
  echo
  echo "未找到 .env，正在从 .env.example 创建..."
  cp .env.example .env
  echo "已创建 .env；如需使用云端模型，请编辑其中的 AI_API_KEY。"
fi

echo
echo "正在生成 Prisma Client..."
npm run db:generate || {
  echo "Prisma Client 生成失败，无法继续。"
  read -r -p "按回车键退出..."
  exit 1
}

if command -v brew >/dev/null 2>&1 && brew list --versions postgresql@16 >/dev/null 2>&1; then
  brew services start postgresql@16 >/dev/null 2>&1 || true
fi

if command -v pg_isready >/dev/null 2>&1 && pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
  echo "PostgreSQL 已连接，正在同步数据库结构..."
  npm run db:sync || echo "数据库结构同步失败，请检查 .env 中的 DATABASE_URL。"
else
  echo "未检测到 localhost:5432 的 PostgreSQL。"
  echo "前端仍会启动，但项目创建 API 暂时会返回 DATABASE_UNAVAILABLE。"
fi

echo
echo "开发服务器启动中：http://localhost:3000"
echo "关闭此窗口即可停止开发服务器。"
echo
npm run dev

EXIT_CODE=$?
echo
echo "开发服务器已退出（代码：$EXIT_CODE）。"
read -r -p "按回车键关闭窗口..."
exit "$EXIT_CODE"
