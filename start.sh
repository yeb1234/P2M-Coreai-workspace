#!/usr/bin/env bash
# ===========================================================================
#  P2 Learning OS - launcher (non-interactive, for WSL / macOS / Linux)
#
#  Everything runs in Docker now. The old version started uvicorn and
#  `npm run dev` directly on the host; that no longer works because the app
#  needs pgvector + Redis + ffmpeg, which the compose stack provides.
#
#  Usage:
#    ./start.sh            full stack (with AI worker)
#    ./start.sh web        web only (no AI worker)
#    ./start.sh backend    rebuild + restart backend & worker
#    ./start.sh frontend   rebuild + restart frontend
#    ./start.sh stop       stop everything (volumes kept)
#    ./start.sh status     show containers + probe
#    ./start.sh logs       follow backend log
# ===========================================================================
set -euo pipefail
cd "$(dirname "$0")"

CMD="${1:-full}"

if ! docker info >/dev/null 2>&1; then
    echo "[ERROR] Docker is not running." >&2
    exit 1
fi

wait_healthy() {
    echo -n "  waiting for backend"
    for _ in $(seq 1 30); do
        status=$(docker inspect -f '{{.State.Health.Status}}' p2-siteyeb-backend-1 2>/dev/null || echo "missing")
        if [ "$status" = "healthy" ]; then
            echo " -> healthy"
            return 0
        fi
        echo -n "."
        sleep 4
    done
    echo
    echo "  [WARN] backend not healthy after ~2 minutes; check: ./start.sh logs"
    return 1
}

case "$CMD" in
    full)
        docker compose up -d
        wait_healthy || true
        echo "  http://localhost"
        ;;
    web)
        # redis still starts: backend declares depends_on: redis healthy.
        # Worker is excluded on purpose - nothing consumes AI jobs then.
        docker compose up -d postgres redis backend frontend
        wait_healthy || true
        echo "  http://localhost"
        ;;
    backend)
        docker compose up -d --build backend worker
        wait_healthy || true
        ;;
    frontend)
        docker compose up -d --build frontend
        ;;
    stop)
        docker compose down
        echo "  stopped (volumes kept)"
        ;;
    status)
        docker compose ps
        echo
        for path in /health /ready; do
            code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://localhost$path" || echo "000")
            echo "  $path  HTTP $code"
        done
        echo
        echo "  /ready 503 usually means the embedding server is down"
        echo "  (LM Studio on the host; see EMBEDDING_BASE_URL in .env)."
        ;;
    logs)
        docker logs -f --tail 60 p2-siteyeb-backend-1
        ;;
    *)
        echo "unknown command: $CMD" >&2
        echo "usage: ./start.sh [full|web|backend|frontend|stop|status|logs]" >&2
        exit 2
        ;;
esac
