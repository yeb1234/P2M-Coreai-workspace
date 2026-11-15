from contextlib import asynccontextmanager
from pathlib import Path
import logging
import subprocess
import sys
import threading
import time

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from sqlalchemy import func

from app.core.csrf import CSRFGuardMiddleware
from app.core.errors import register_exception_handlers
from app.core.observability import RequestContextMiddleware, configure_logging
from app.database import Base, SessionLocal, engine, ensure_runtime_schema, settings
from app.models import AiJob, Category, Video, WatchHistory
from app.routers import admin, ai_jobs, assistant, auth, calendar_events, categories, learning, memory_admin, notes, schedule_items, search, user_data, videos, watch_events
from app.schemas import StatsOut
from app.services.file_scanner import scan_video_library, start_file_watcher, stop_file_watcher

DIST_DIR = Path(__file__).resolve().parents[2] / "dist"
APP_STARTED_AT = time.time()

configure_logging()
logger = logging.getLogger(__name__)


def run_startup_scan() -> None:
    try:
        result = scan_video_library()
        logger.info("Startup video scan finished: %s", result)
    except Exception:
        logger.exception("Startup video scan failed")


def _run_background_thumbnails() -> None:
    """空闲时补缩略图/雪碧图。

    两个开关都关着时直接返回，不要每 2 秒空转一次 —— 一个什么都不做的
    死循环线程除了费电，还会让人误以为后台任务在跑。
    """
    import time

    if not settings.thumbnail_background_enabled and not settings.sprite_background_enabled:
        return

    idle_cycles = 0
    while True:
        time.sleep(max(1, settings.ai_worker_poll_interval or 2))
        idle_cycles += 1
        thumbnail_cycles = max(1, int(settings.thumbnail_background_idle_cycles or 10))
        thumbnail_limit = max(1, int(settings.thumbnail_background_limit or 1))
        if idle_cycles % thumbnail_cycles != 0:
            continue
        # 单次失败不能让整条后台链路死掉：ffmpeg 偶尔会因文件被占用报错
        if settings.thumbnail_background_enabled:
            try:
                from app.services.file_scanner import generate_missing_thumbnails

                generate_missing_thumbnails(limit=thumbnail_limit)
            except Exception:
                logger.exception("后台生成缩略图失败，跳过本轮")
        if settings.sprite_background_enabled:
            try:
                from app.services.file_scanner import generate_missing_sprites

                generate_missing_sprites(limit=thumbnail_limit)
            except Exception:
                logger.exception("后台生成雪碧图失败，跳过本轮")


def _drain_worker_stdout(proc: subprocess.Popen) -> None:
    """Consume worker subprocess stdout to prevent PIPE deadlock."""
    try:
        if proc.stdout is None:
            return
        for line in proc.stdout:
            print(f"[worker] {line}", end="", file=sys.stderr, flush=True)
    except Exception:
        pass


class WorkerSupervisor:
    """托管 AI 转写 worker 子进程。

    为什么要有它：worker 是独立进程（faster-whisper 崩溃不能带走 API），
    但早期只在启动时 Popen 一次，进程死了没人知道 —— AI 任务会一直排队，
    前端看到「排队中」永远不动。这里加一个监督线程，退出就重拉。
    """

    RESTART_DELAY_S = 5

    def __init__(self, backend_dir: str):
        self.backend_dir = backend_dir
        self._stop = threading.Event()
        self._proc: subprocess.Popen | None = None
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._thread = threading.Thread(
            target=self._run, name="ai-worker-supervisor", daemon=True
        )
        self._thread.start()

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                proc = subprocess.Popen(
                    [sys.executable, "-m", "app.worker"],
                    cwd=self.backend_dir,
                    encoding="utf-8",
                    errors="replace",
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                )
            except Exception:
                logger.exception("AI worker 启动失败，%s 秒后重试", self.RESTART_DELAY_S)
                self._stop.wait(self.RESTART_DELAY_S)
                continue

            self._proc = proc
            logger.info("AI worker 已启动 pid=%s", proc.pid)
            threading.Thread(
                target=_drain_worker_stdout, args=(proc,), name="worker-stdout-drain", daemon=True
            ).start()

            code = proc.wait()
            if self._stop.is_set():
                break
            logger.error(
                "AI worker 退出 code=%s，%s 秒后重启（期间 AI 任务不会被消费）",
                code,
                self.RESTART_DELAY_S,
            )
            self._stop.wait(self.RESTART_DELAY_S)

    def stop(self) -> None:
        self._stop.set()
        proc = self._proc
        if proc is not None and proc.poll() is None:
            try:
                proc.terminate()
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
            except Exception:
                logger.exception("停止 AI worker 失败")


def _warmup_retrieval() -> None:
    """预热 embedding 模型。

    LM Studio 首次加载 bge-m3 约 2 秒，不预热的话第一个查询会莫名很慢，
    用户会以为检索卡死了。
    """
    try:
        from app.services.embeddings import get_embedding_client

        started = time.time()
        get_embedding_client().embed(["预热"])
        logger.info("embedding 预热完成 %.2fs", time.time() - started)
    except Exception as exc:
        logger.warning("embedding 预热失败（检索将退化为纯词法）: %s", exc)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(bind=engine)
    ensure_runtime_schema()
    start_file_watcher()
    threading.Thread(target=run_startup_scan, name="startup-video-scan", daemon=True).start()
    threading.Thread(target=_warmup_retrieval, name="embedding-warmup", daemon=True).start()
    # Start background thumbnail/sprite worker thread
    threading.Thread(target=_run_background_thumbnails, name="thumbnail-worker", daemon=True).start()
    # AI 转写 worker：独立进程 + 监督线程，崩了自动重拉
    backend_dir = str(Path(__file__).resolve().parent.parent)
    supervisor = WorkerSupervisor(backend_dir)
    supervisor.start()
    yield
    stop_file_watcher()
    supervisor.stop()


app = FastAPI(
    title="P2 Learning OS API",
    version="3.0.0",
    lifespan=lifespan,
    docs_url="/api/docs" if settings.enable_docs else None,
    openapi_url="/api/openapi.json" if settings.enable_docs else None,
)

# 显式来源：allow_origins=["*"] 与 allow_credentials=True 是无效组合，
# 浏览器会直接拒绝，而且等于关闭了同源保护。
# 用 Cookie 会话必须 allow_credentials=True，前端才能带上 HttpOnly Cookie。
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
    expose_headers=["X-Sprite-Meta", "X-Request-ID"],
)
# CSRF 在 CORS 之内：Cookie 会话的写请求必须来源可信
app.add_middleware(CSRFGuardMiddleware)
# 放最外层，保证 CORS 预检与 CSRF 拒绝也带上 request_id
app.add_middleware(RequestContextMiddleware)

register_exception_handlers(app)

app.include_router(auth.router)
app.include_router(user_data.router)
app.include_router(schedule_items.router)
app.include_router(videos.router)
app.include_router(categories.router)
app.include_router(ai_jobs.router)
app.include_router(assistant.router)
app.include_router(search.router)
app.include_router(memory_admin.router)
app.include_router(learning.router)
app.include_router(watch_events.router)
app.include_router(notes.router)
app.include_router(calendar_events.router)
app.include_router(admin.router)

app.mount("/output", StaticFiles(directory=settings.output_dir), name="output")
app.mount("/thumbnails", StaticFiles(directory=settings.thumbnail_dir), name="thumbnails")
app.mount("/sprites", StaticFiles(directory=settings.sprite_dir), name="sprites")

if (DIST_DIR / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=DIST_DIR / "assets"), name="static-assets")


@app.get("/sounds/{full_path:path}")
async def serve_sound_asset(full_path: str):
    sounds_dir = DIST_DIR / "sounds"
    sound_path = (sounds_dir / full_path).resolve()
    if not sounds_dir.is_dir() or not sound_path.is_file() or sounds_dir.resolve() not in sound_path.parents:
        return Response(status_code=404)
    return FileResponse(
        sound_path,
        headers={
            "Cache-Control": "public, max-age=604800",
        },
    )


@app.get("/health")
def health():
    """存活探针：只验证进程与数据库连通，必须快速返回。

    详细指标（向量覆盖率、LLM 可达性）在 /ready 和 /api/admin/health。
    """
    from app.database import check_database

    try:
        db_info = check_database(deep=False)
        db_ok = True
    except Exception as exc:
        logger.error("健康检查数据库失败: %s", exc)
        db_info = {"error": str(exc)[:200]}
        db_ok = False

    return {
        "status": "ok" if db_ok else "degraded",
        "uptime_sec": round(time.time() - APP_STARTED_AT, 1),
        "database": db_info,
    }


@app.get("/ready")
def ready():
    """就绪探针：检索链路可用才返回 200，用于发布前判断。"""
    from fastapi.responses import JSONResponse
    from app.database import check_database
    from app.migrations import embedding_stats
    from app.services.embeddings import get_embedding_client
    from app.services.llm import llm_health

    checks: dict = {}
    try:
        check_database()
        checks["database"] = "ok"
    except Exception as exc:
        checks["database"] = f"fail: {str(exc)[:120]}"

    try:
        stats = embedding_stats(engine)
        checks["vectors"] = stats
    except Exception as exc:
        checks["vectors"] = f"fail: {str(exc)[:120]}"

    checks["embedding_model"] = get_embedding_client().health()
    checks["llm"] = llm_health()

    ok = checks.get("database") == "ok" and checks["embedding_model"].get("ok")
    return JSONResponse(status_code=200 if ok else 503, content={"ready": ok, "checks": checks})


@app.get("/api/stats", response_model=StatsOut)
def get_stats():
    db = SessionLocal()
    try:
        total_videos = db.query(Video).count()
        total_categories = db.query(Category).count()
        total_watch_time = db.query(func.coalesce(func.sum(WatchHistory.duration), 0.0)).scalar() or 0.0
        completed_videos = (
            db.query(func.count(func.distinct(WatchHistory.video_id)))
            .filter(WatchHistory.completed.is_(True))
            .scalar()
            or 0
        )
        ai_completed = db.query(AiJob).filter(AiJob.status == "completed").count()

        return StatsOut(
            total_videos=total_videos,
            total_categories=total_categories,
            total_watch_time=total_watch_time,
            completed_videos=completed_videos,
            ai_completed=ai_completed,
        )
    finally:
        db.close()


@app.get("/{full_path:path}")
async def serve_spa(request: Request, full_path: str):
    if (
        full_path.startswith("api/")
        or full_path.startswith("output/")
        or full_path.startswith("thumbnails/")
        or full_path.startswith("sprites/")
        or full_path.startswith("assets/")
        or full_path.startswith("sounds/")
    ):
        from fastapi.responses import JSONResponse
        return JSONResponse({"detail": "Not Found"}, status_code=404)
    index = DIST_DIR / "index.html"
    if index.is_file():
        return FileResponse(
            index,
            headers={
                "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
                "Pragma": "no-cache",
            },
        )
    return {"message": "P2 Learning OS API", "video_folder": settings.video_folder}
