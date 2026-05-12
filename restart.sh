#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "========================================"
echo "  SiteYeb / P2M CoreAI Workspace"
echo "========================================"
echo ""
echo "Restarting backend and frontend..."
echo ""

echo "Stopping backend/frontend if they are running..."
if command -v lsof >/dev/null 2>&1; then
  lsof -ti tcp:80 2>/dev/null | xargs -r kill -9 2>/dev/null || true
  lsof -ti tcp:8000 2>/dev/null | xargs -r kill -9 2>/dev/null || true
fi
pkill -f "uvicorn app.main:app" 2>/dev/null || true
pkill -f "npm run dev" 2>/dev/null || true
pkill -f "vite.*8000" 2>/dev/null || true

sleep 2

echo "Starting backend (port 80)..."
cd "$ROOT/backend"
.venv311/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 80 --reload &
BACKEND_PID=$!

sleep 2

echo "Starting frontend dev server (port 8000)..."
cd "$ROOT"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "Restart complete."
echo "  App / Backend: http://localhost"
echo "  Frontend dev: http://localhost:8000"
echo ""
echo "Press Ctrl+C to stop all services."
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
