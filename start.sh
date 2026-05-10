#!/bin/bash
echo "========================================"
echo "  SiteYeb / P2M CoreAI Workspace"
echo "========================================"
echo ""
echo "Starting backend (port 5200)..."
cd backend && .venv311/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 5200 --reload &
BACKEND_PID=$!
cd ..
sleep 2
echo "Starting frontend (port 5173)..."
npm run dev &
FRONTEND_PID=$!
echo ""
echo "Services running:"
echo "  Frontend: http://localhost:5173"
echo "  Backend:  http://127.0.0.1:5200"
echo ""
echo "Press Ctrl+C to stop all services."
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
