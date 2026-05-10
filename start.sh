#!/bin/bash
echo "========================================"
echo "  SiteYeb / P2M CoreAI Workspace"
echo "========================================"
echo ""
echo "Starting backend (port 80)..."
cd backend && .venv311/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 80 --reload &
BACKEND_PID=$!
cd ..
sleep 2
echo "Starting frontend dev server (port 8000)..."
npm run dev &
FRONTEND_PID=$!
echo ""
echo "Services running:"
echo "  App / Backend: http://localhost"
echo "  Frontend dev: http://localhost:8000"
echo ""
echo "Press Ctrl+C to stop all services."
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
