from contextlib import asynccontextmanager
from pathlib import Path
import logging
import subprocess
import sys
import threading

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from sqlalchemy import func

from app.database import Base, SessionLocal, engine, ensure_runtime_schema, settings
from app.models import AiJob, Category, Video, WatchHistory
from app.routers import admin, ai_jobs, assistant, auth, calendar_events, categories, notes, schedule_items, user_data, videos
from app.schemas import StatsOut
from app.services.file_scanner import scan_video_library, start_file_watcher, stop_file_watcher

DIST_DIR = Path(__file__).resolve().parents[2] / "dist"


logger = logging.getLogger(__name__)


def run_startup_scan() -> None:
    try:
        result = scan_video_library()
        logger.info("Startup video scan finished: %s", result)
    except Exception:
        logger.exception("Startup video scan failed")


def _run_background_thumbnails() -> None:
    import time
    idle_cycles = 0
    while True:
        time.sleep(max(1, settings.ai_worker_poll_interval or 2))
        idle_cycles += 1
        thumbnail_cycles = max(1, int(settings.thumbnail_background_idle_cycles or 10))
        thumbnail_limit = max(1, int(settings.thumbnail_background_limit or 1))
        if settings.thumbnail_background_enabled and idle_cycles % thumbnail_cycles == 0:
            from app.services.file_scanner import generate_missing_thumbnails
            generate_missing_thumbnails(limit=thumbnail_limit)
        if settings.sprite_background_enabled and idle_cycles % thumbnail_cycles == 0:
            from app.services.file_scanner import generate_missing_sprites
            generate_missing_sprites(limit=thumbnail_limit)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(bind=engine)
    ensure_runtime_schema()
    start_file_watcher()
    threading.Thread(target=run_startup_scan, name="startup-video-scan", daemon=True).start()
    # Start background thumbnail/sprite worker thread
    threading.Thread(target=_run_background_thumbnails, name="thumbnail-worker", daemon=True).start()
    # Start AI RQ worker as a subprocess (independent process, can be killed)
    backend_dir = str(Path(__file__).resolve().parent.parent)
    worker_proc = subprocess.Popen(
        [sys.executable, "-m", "app.worker"],
        cwd=backend_dir,
    )
    print(f"AI RQ worker subprocess started: pid={worker_proc.pid}", file=sys.stderr, flush=True)
    yield
    stop_file_watcher()
    try:
        worker_proc.terminate()
        worker_proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        worker_proc.kill()


app = FastAPI(
    title="P2 Learning OS API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Sprite-Meta"],
)

app.include_router(auth.router)
app.include_router(user_data.router)
app.include_router(schedule_items.router)
app.include_router(videos.router)
app.include_router(categories.router)
app.include_router(ai_jobs.router)
app.include_router(assistant.router)
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
