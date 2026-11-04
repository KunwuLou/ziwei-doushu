#!/bin/bash
# ============================================================
#  紫微斗数 · 一键启动
#  双击即可：自动检查环境 → 启动本地服务 → 自动打开浏览器
#  关闭：在本终端窗口按 Ctrl+C
# ============================================================

set -uo pipefail

# ---- 定位项目目录（支持放在项目内或项目外一层）----
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$HERE/package.json" ]; then
  APP_DIR="$HERE"
elif [ -f "$HERE/ziwei-doushu/package.json" ]; then
  APP_DIR="$HERE/ziwei-doushu"
else
  echo "❌ 找不到项目目录（需要包含 package.json 的 ziwei-doushu 文件夹）"
  echo "   当前脚本位置：$HERE"
  echo
  read -r -n 1 -s -p "按任意键关闭…"; echo; exit 1
fi

cd "$APP_DIR" || exit 1

LOG="/tmp/ziwei-doushu-dev.log"
PREFERRED_PORT=3000

echo "============================================================"
echo "  紫微斗数 · 本地启动"
echo "  项目目录：$APP_DIR"
echo "============================================================"
echo

# ---- Node.js 环境 ----
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo "❌ 未找到 Node.js。"
  echo "   请先安装（推荐：brew install node，或到 https://nodejs.org 下载 LTS），然后重试。"
  echo
  read -r -n 1 -s -p "按任意键关闭…"; echo; exit 1
fi
echo "✓ Node.js $(node --version) / npm $(npm --version)"

# ---- 判断是否已在运行 ----
# 注意：不要写成 curl | grep -q，grep 提前退出会让 curl 收到 SIGPIPE，
# 在 pipefail 下会把成功的检测误判为失败。
is_ours() { # $1=端口
  local html
  html="$(curl -fsS -m 2 "http://127.0.0.1:$1/" 2>/dev/null)" || return 1
  case "$html" in
    *紫微*) return 0 ;;
    *) return 1 ;;
  esac
}

for p in $(seq "$PREFERRED_PORT" $((PREFERRED_PORT + 9))); do
  if is_ours "$p"; then
    echo "✓ 服务已在运行：http://localhost:$p"
    echo "  正在打开浏览器…"
    open "http://localhost:$p"
    echo
    echo "已有实例在后台运行，本窗口 3 秒后关闭。"
    sleep 3
    exit 0
  fi
done

# ---- 选一个空闲端口 ----
PORT=""
for p in $(seq "$PREFERRED_PORT" $((PREFERRED_PORT + 9))); do
  if ! lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
    PORT="$p"; break
  fi
done
if [ -z "$PORT" ]; then
  echo "❌ 端口 3000-3009 都被占用了，无法启动。"
  echo
  read -r -n 1 -s -p "按任意键关闭…"; echo; exit 1
fi

# ---- 依赖检查 ----
if [ ! -d "node_modules" ]; then
  echo "→ 首次运行，正在安装依赖（约 1-2 分钟）…"
  if ! npm ci --no-audit --no-fund; then
    echo "  npm ci 失败，改用 npm install 重试…"
    npm install --no-audit --no-fund || {
      echo "❌ 依赖安装失败，请检查网络后重试。"
      read -r -n 1 -s -p "按任意键关闭…"; echo; exit 1
    }
  fi
  echo "✓ 依赖安装完成"
fi

# ---- 环境变量文件 ----
if [ ! -f ".env.local" ] && [ -f ".env.example" ]; then
  cp .env.example .env.local
  echo "✓ 已生成 .env.local（排盘功能无需填写任何 Key）"
fi

# ---- 启动服务 ----
cleanup() {
  if [ -n "${SERVER_PID:-}" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    echo
    echo "→ 正在关闭服务…"
    kill "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null
  fi
  echo "已停止。"
}
trap cleanup EXIT INT TERM

echo "→ 正在启动服务（端口 ${PORT}，日志：${LOG}）…"
: > "$LOG"
npm run dev -- -p "$PORT" >> "$LOG" 2>&1 &
SERVER_PID=$!

# ---- 等待就绪 ----
READY=0
for _ in $(seq 1 90); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then break; fi
  if is_ours "$PORT"; then READY=1; break; fi
  sleep 1
done

if [ "$READY" -ne 1 ]; then
  echo "❌ 服务启动失败，日志如下："
  echo "------------------------------------------------------------"
  tail -30 "$LOG"
  echo "------------------------------------------------------------"
  echo
  read -r -n 1 -s -p "按任意键关闭…"; echo; exit 1
fi

URL="http://localhost:$PORT"
echo
echo "============================================================"
echo "  ✅ 已启动：$URL"
echo "  关闭服务：在本窗口按 Ctrl+C"
echo "============================================================"
echo
open "$URL"

# 前台跟踪日志，Ctrl+C 时由 trap 关闭服务
tail -f "$LOG" &
TAIL_PID=$!
wait "$SERVER_PID"
kill "$TAIL_PID" 2>/dev/null
