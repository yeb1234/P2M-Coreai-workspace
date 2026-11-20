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
from app.core.observability import RequestContextMiddleware, setup_from_settings
from app.database import SessionLocal, engine, ensure_runtime_schema, settings
from app.models import AiJob, Category, Video, WatchHistory
from app.routers import admin, agent_actions, ai_jobs, assistant, auth, calendar_events, categories, interview, learning, mcp, memory_admin, notes, ops, schedule_items, search, user_data, videos, watch_events
from app.routers import asset_registry
from app.schemas import StatsOut
from app.services.file_scanner import scan_video_library, start_file_watcher, stop_file_watcher

DIST_DIR = Path(__file__).resolve().parents[2] / "dist"
APP_STARTED_AT = time.time()

setup_from_settings("backend")
logger = logging.getLogger(__name__)


def run_startup_scan() -> None:
    try:
        result = scan_video_library()
        logger.info("Startup video scan finished: %s", result)
    except Exception:
        logger.exception("Startup video scan failed")


def _run_background_sprites() -> None:
    """空闲时补雪碧图。

    缩略图已经迁到 app.services.thumbnail_worker（线程池并发），
    这里只留雪碧图 —— 雪碧图要抽多帧再拼图，比缩略图重得多，
    保持慢节奏反而合适。
    """
    import time

    if not settings.sprite_background_enabled:
        return

    idle_cycles = 0
    while True:
        time.sleep(max(1, settings.ai_worker_poll_interval or 2))
        idle_cycles += 1
        cycles = max(1, int(settings.thumbnail_background_idle_cycles or 10))
        limit = max(1, int(settings.thumbnail_background_limit or 1))
        if idle_cycles % cycles != 0:
            continue
        if settings.sprite_background_enabled:
            try:
                from app.services.file_scanner import generate_missing_sprites

                generate_missing_sprites(limit=limit)
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
    ensure_runtime_schema()
    start_file_watcher()
    threading.Thread(target=run_startup_scan, name="startup-video-scan", daemon=True).start()
    threading.Thread(target=_warmup_retrieval, name="embedding-warmup", daemon=True).start()
    # 缩略图补齐：进程内单例 worker（线程池 + 去重 + 自动扫描）。
    #
    # 替换掉原来的 _run_background_thumbnails：那个是一次生成 1 张、
    # 每 20 秒一轮，一小时最多 180 张。库里两万多条视频，
    # 全缺的话要跑 160 小时，体感就是「永远补不完」。
    #
    # 现在 4 个线程并发 + 每 5 分钟扫一次库，单批最多 200 个，
    # 实际吞吐取决于 ffmpeg 速度（单张约 0.3-2 秒）。
    from app.services.thumbnail_worker import get_thumbnail_worker

    get_thumbnail_worker().start_auto_scan()
    if settings.sprite_background_enabled:
        threading.Thread(target=_run_background_sprites, name="sprite-worker", daemon=True).start()
    # AI 转写 worker：独立进程 + 监督线程，崩了自动重拉。
    #
    # 只在「没有外部 worker」时启用。docker compose 里 worker 是独立服务，
    # 再在内嵌一个就是两个 worker 抢同一个队列，还会互相清对方注册。
    supervisor: WorkerSupervisor | None = None
    if settings.ai_worker_embedded:
        backend_dir = str(Path(__file__).resolve().parent.parent)
        supervisor = WorkerSupervisor(backend_dir)
        supervisor.start()
    else:
        logger.info("内嵌 worker 已关闭（由外部 worker 服务消费队列）")

    yield
    stop_file_watcher()
    if supervisor is not None:
        supervisor.stop()


app = FastAPI(
    title="P2 Learning OS API",
    version="7.0.0",
    lifespan=lifespan,
    docs_url="/api/docs" if settings.enable_docs else None,
    openapi_url="/api/openapi.json" if settings.enable_docs else None,
)


@app.middleware("http")
async def client_type_middleware(request: Request, call_next):
    """识别桌面客户端，仅用于 UI 分流，绝不参与鉴权。

    浏览器默认 web；桌面壳带 X-Client-Type: desktop-exe。
    即使有人在浏览器里伪造这个 header，也只能拿到桌面精简视图，
    后端权限仍按登录用户/角色判断，不会因此开放任何 IPC 或特权接口。
    """
    raw = (request.headers.get("X-Client-Type") or "web").strip().lower()
    request.state.client_type = "desktop-exe" if raw == "desktop-exe" else "web"
    return await call_next(request)


@app.get("/api/client-info")
async def client_info(request: Request):
    """给桌面/网页自测用：确认 header 是否被识别。"""
    client_type = getattr(request.state, "client_type", "web")
    return {"client_type": client_type, "ui_mode": client_type}


# 显式来源：allow_origins=["*"] 与 allow_credentials=True 是无效组合，
# 浏览器会直接拒绝，而且等于关闭了同源保护。
# 用 Cookie 会话必须 allow_credentials=True，前端才能带上 HttpOnly Cookie。
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID", "X-Client-Type"],
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
app.include_router(agent_actions.router)
app.include_router(calendar_events.router)
app.include_router(mcp.router)
app.include_router(interview.router)
app.include_router(admin.router)
app.include_router(ops.router)
app.include_router(asset_registry.router)

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


_tx_warn_state: bool = False


@app.get("/health")
def health():
    """存活探针：验证进程与数据库连通，外加事务健康度。必须快速返回。

    详细指标（向量覆盖率、LLM 可达性）在 /ready 和 /api/admin/health。

    ## 为什么探针里要查事务

    2026-11-16 实际故障：长事务压住 videos 表，迁移的 ALTER TABLE
    等了 12 分半，后端卡在启动阶段，整站 502。整个过程**应用日志里零线索**。

    docker 会把健康探针的输出存进 `.State.Health.Log`，所以把这个指标
    放进 /health 之后，出问题可以一条命令看到：

        docker inspect -f '{{json .State.Health.Log}}' p2-siteyeb-backend-1

    ## 注意：warn 不回 503

    长事务会让探针变 degraded，但**故意仍然返回 200**。
    探针挂掉会触发编排重启，而重启恰恰解决不了锁等待
    （持锁的是别的连接），只会让问题看起来更像「进程不稳定」。
    这里要的是「看得见」，不是「自动重启」。
    """
    global _tx_warn_state

    from app.database import check_database, check_transactions

    try:
        db_info = check_database(deep=False)
        db_ok = True
    except Exception as exc:
        logger.error("健康检查数据库失败: %s", exc)
        db_info = {"error": str(exc)[:200]}
        db_ok = False

    try:
        tx_info = check_transactions()
    except Exception as exc:  # noqa: BLE001
        tx_info = {"level": "ok", "error": str(exc)[:120]}

    # 只在状态翻转时记日志：探针每 30 秒跑一次，每次都打就是刷屏
    if tx_info.get("level") == "warn":
        if not _tx_warn_state:
            _tx_warn_state = True
            logger.warning("事务健康度异常：%s", "; ".join(tx_info.get("warnings") or []))
    elif _tx_warn_state:
        _tx_warn_state = False
        logger.info("事务健康度已恢复")

    degraded = not db_ok or tx_info.get("level") == "warn"
    return {
        "status": "degraded" if degraded else "ok",
        "uptime_sec": round(time.time() - APP_STARTED_AT, 1),
        "database": db_info,
        "transactions": tx_info,
    }


@app.get("/ready")
def ready():
    """就绪探针：检索链路可用才返回 200，用于发布前判断。"""
    from fastapi.responses import JSONResponse
    from app.database import check_database, check_transactions
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

    # 长事务不参与 ready 判定（它不是「不能服务」，而是「会拖住 schema 变更」），
    # 但必须在这里可见，否则排查时又要连数据库
    try:
        checks["transactions"] = check_transactions()
    except Exception as exc:  # noqa: BLE001
        checks["transactions"] = f"fail: {str(exc)[:120]}"

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

