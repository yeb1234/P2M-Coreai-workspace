"""保留策略与统计信息维护。

默认只做 dry-run：打印「按当前策略会删多少行」，不删任何数据。
确认后再加 --apply。

示例：
    python scripts/maintenance.py
    python scripts/maintenance.py --apply
    python scripts/maintenance.py --analyze
    python scripts/maintenance.py --apply --analyze

策略：
  background_tasks: done 超过 7 天、failed 超过 30 天
  ai_jobs: completed / failed / cancelled 超过 30 天
  永远不删 queued / running / cancelling，避免把正在跑的任务清掉。
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import and_, or_, text

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.database import SessionLocal, engine  # noqa: E402
from app.models import AiJob, BackgroundTask  # noqa: E402

ANALYZE_TABLES = (
    "videos",
    "subtitle_segments",
    "content_chunks",
    "ai_jobs",
    "background_tasks",
)


def _bg_filter(done_cutoff: datetime, failed_cutoff: datetime):
    return or_(
        and_(BackgroundTask.status == "done", BackgroundTask.created_at < done_cutoff),
        and_(BackgroundTask.status == "failed", BackgroundTask.created_at < failed_cutoff),
    )


def _ai_filter(cutoff: datetime):
    return and_(
        AiJob.status.in_(("completed", "failed", "cancelled")),
        AiJob.created_at < cutoff,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="保留清理与 ANALYZE")
    parser.add_argument("--apply", action="store_true", help="真正执行删除；默认只统计")
    parser.add_argument("--done-days", type=int, default=7, help="done 任务保留天数")
    parser.add_argument("--failed-days", type=int, default=30, help="failed 任务保留天数")
    parser.add_argument("--ai-days", type=int, default=30, help="ai_jobs 历史保留天数")
    parser.add_argument("--analyze", action="store_true", help="执行 ANALYZE")
    args = parser.parse_args()

    now = datetime.now()
    done_cutoff = now - timedelta(days=max(1, args.done_days))
    failed_cutoff = now - timedelta(days=max(1, args.failed_days))
    ai_cutoff = now - timedelta(days=max(1, args.ai_days))

    db = SessionLocal()
    try:
        bg_query = db.query(BackgroundTask).filter(_bg_filter(done_cutoff, failed_cutoff))
        ai_query = db.query(AiJob).filter(_ai_filter(ai_cutoff))
        bg_count = bg_query.count()
        ai_count = ai_query.count()

        print(
            f"[{'APPLY' if args.apply else 'DRY-RUN'}] "
            f"background_tasks 可清理 {bg_count} 行 "
            f"(done<{done_cutoff:%Y-%m-%d}, failed<{failed_cutoff:%Y-%m-%d})"
        )
        print(
            f"[{'APPLY' if args.apply else 'DRY-RUN'}] "
            f"ai_jobs 可清理 {ai_count} 行 (completed/failed/cancelled<{ai_cutoff:%Y-%m-%d})"
        )

        if args.apply and bg_count:
            deleted = bg_query.delete(synchronize_session=False)
            print(f"background_tasks 已删除 {deleted} 行")
        if args.apply and ai_count:
            deleted = ai_query.delete(synchronize_session=False)
            print(f"ai_jobs 已删除 {deleted} 行")
        if args.apply:
            db.commit()
    finally:
        db.close()

    if args.analyze:
        with engine.connect() as conn:
            conn = conn.execution_options(isolation_level="AUTOCOMMIT")
            for table in ANALYZE_TABLES:
                conn.execute(text(f"ANALYZE {table}"))
                print(f"ANALYZE {table} 完成")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
