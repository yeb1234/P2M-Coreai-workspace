#!/usr/bin/env bash
# 上线前自检
#
# 用法：./scripts/preflight.sh [http://localhost]
#
# 只做只读检查，不改任何东西。FAIL 必须解决，WARN 要么解决要么能解释清楚。
set -uo pipefail

BASE="${1:-http://localhost}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT}/.env"

PASS=0; FAIL=0; WARN=0
pass() { echo "  PASS  $1"; PASS=$((PASS+1)); }
fail() { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }
warn() { echo "  WARN  $1"; WARN=$((WARN+1)); }

env_get() {
  [ -f "$ENV_FILE" ] || return 1
  grep -E "^${1}=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '\r'
}

code() { curl -s -o /dev/null -w '%{http_code}' -m 12 "$@" 2>/dev/null; }
header() { curl -sI -m 12 "$BASE/" 2>/dev/null | tr -d '\r'; }

echo "== 配置 =="

SECRET="$(env_get JWT_SECRET || echo '')"
if [ ${#SECRET} -lt 32 ]; then
  fail "JWT_SECRET 未设置或短于 32 字符（令牌可被离线爆破）"
elif echo "$SECRET" | grep -qi "change-me\|dev-only\|please-set"; then
  fail "JWT_SECRET 仍是示例值，必须换成随机串"
else
  pass "JWT_SECRET 长度 ${#SECRET}，非默认值"
fi

REG="$(env_get ALLOW_REGISTRATION || echo '')"
if [ "$REG" = "false" ]; then
  pass "注册已关闭（ALLOW_REGISTRATION=false）"
else
  warn "注册仍开放：公网会被灌号。建完账号后建议改成 false"
fi

SECURE_FLAG="$(env_get COOKIE_SECURE || echo '')"
case "$BASE" in
  https://*)
    if [ "$SECURE_FLAG" = "true" ]; then
      pass "HTTPS 部署且 COOKIE_SECURE=true"
    else
      fail "HTTPS 部署但 COOKIE_SECURE 不是 true，Cookie 会明文过网"
    fi
    ;;
  *)
    if [ "$SECURE_FLAG" = "true" ]; then
      fail "COOKIE_SECURE=true 但当前是 http，浏览器不会发送 Cookie，登录会失败"
    else
      warn "当前是 http：仅限内网/本机。公网必须上 HTTPS 并设 COOKIE_SECURE=true"
    fi
    ;;
esac

echo
echo "== 网络暴露 =="

if docker ps --format '{{.Names}}' 2>/dev/null | grep -q p2-siteyeb-postgres-1; then
  DANGER="$(docker ps --format '{{.Names}}\t{{.Ports}}' 2>/dev/null \
    | grep -E 'p2-siteyeb-postgres-1|p2-siteyeb-redis-1' \
    | grep -E '0\.0\.0\.0:(5432|6379)' || true)"
  if [ -n "$DANGER" ]; then
    fail "数据库/Redis 暴露在 0.0.0.0：$(echo "$DANGER" | tr '\n' ' ')"
  else
    pass "5432/6379 未暴露到公网"
  fi
else
  warn "未检测到 p2-siteyeb-postgres-1 容器，跳过端口检查"
fi

echo
echo "== 接口边界 =="

for path in /api/admin/health /api/learning/profile /api/assistant/sessions; do
  C="$(code "$BASE$path")"
  if [ "$C" = "401" ]; then
    pass "未登录访问 $path -> 401"
  else
    fail "未登录访问 $path -> $C（应为 401）"
  fi
done

for path in /health /api/videos?page=1\&page_size=1; do
  C="$(code "$BASE$path")"
  if [ "$C" = "200" ]; then
    pass "公共接口 $path -> 200"
  else
    fail "公共接口 $path -> $C（应为 200）"
  fi
done

C="$(code "$BASE/api/docs")"
[ "$C" = "404" ] && pass "接口文档已关闭 -> 404" || fail "接口文档仍可访问 -> $C"

echo
echo "== 安全响应头 =="

H="$(header)"
check_header() {
  if echo "$H" | grep -qi "^$1:"; then
    pass "响应头 $1 存在"
  else
    fail "响应头 $1 缺失"
  fi
}
check_header "X-Content-Type-Options"
check_header "X-Frame-Options"
check_header "Referrer-Policy"
check_header "Content-Security-Policy"

if echo "$H" | grep -qi "^Server:.*nginx/"; then
  warn "Server 头暴露了 nginx 版本号"
else
  pass "未暴露服务器版本号"
fi

echo
echo "== 数据安全 =="

BACKUP_DIR="${ROOT}/backups"
if [ -d "$BACKUP_DIR" ] && [ -n "$(find "$BACKUP_DIR" -maxdepth 1 -name '*.dump' -mtime -2 2>/dev/null)" ]; then
  pass "48 小时内有数据库备份"
else
  warn "近 48 小时没有备份。跑一次 ./scripts/backup.sh 并配成定时任务"
fi

echo
echo "== 结果 =="
echo "  通过 $PASS / 警告 $WARN / 失败 $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo "  有 FAIL 项，不建议对外发布。"
  exit 1
elif [ "$WARN" -gt 0 ]; then
  echo "  可以发布，但有需要说明的警告项。"
  exit 0
else
  echo "  全部通过。"
  exit 0
fi
