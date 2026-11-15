"""通用后台任务的具体处理函数。

每个 handler 都必须是**幂等**的 —— 恢复机制会让任务被重复执行。
这里注册的 kind：

  thumbnail    给单个视频补缩略图（批量补齐走定时扫描，这个是单点重试用）
  chunk_index  给单个视频建语义块 + 向量化（转写完成后自动投递；
               中断后由扫描重新发现，index_video 自身幂等）

以后要加向量化，就在这里写：

  @register_task("embedding")
  def handle_embedding(task):
      video_id = task.target_id
      # 1. 先查这条视频是否已经有完整的向量，有就直接返回（幂等）
      # 2. 没有就重新算
      # 3. 写回时用 upsert，不要 insert（避免重复执行报主键冲突）
"""

from __future__ import annotations

import logging

from app.database import SessionLocal
from app.models import BackgroundTask, Video
from app.services.background_tasks import TaskHandler, register_task
from app.utils.files import resolve_media_path

logger = logging.getLogger(__name__)


@register_task("thumbnail")
def handle_thumbnail(task: BackgroundTask) -> None:
    """补单个缩略图。幂等：已有缩略图直接跳过。

    和 thumbnail_worker._run_one 同样的三段式：读 → ffmpeg → 写。
    DB 事务绝不跨越 ffmpeg —— 否则 videos 表被 ACCESS SHARE 压住，
    迁移里的 ALTER TABLE videos 会一直等锁。
    """
    from app.services.file_scanner import generate_thumbnail

    video_id = int(task.target_id)

    # ① 短事务读
    db = SessionLocal()
    try:
        row = db.query(Video.filepath, Video.thumbnail).filter(Video.id == video_id).first()
        if row is None:
            raise ValueError(f"视频不存在 id={video_id}")
        if row.thumbnail:
            return
        filepath = row.filepath
    finally:
        db.close()

    # ② 无事务
    result = generate_thumbnail(str(resolve_media_path(filepath)), video_id)
    if not result:
        raise RuntimeError(f"缩略图生成失败 video_id={video_id}")

    # ③ 短事务写
    db = SessionLocal()
    try:
        db.query(Video).filter(Video.id == video_id).update(
            {"thumbnail": result}, synchronize_session=False
        )
        db.commit()
    finally:
        db.close()


def register_all() -> None:
    """确保所有 handler 被导入注册。worker 启动时调用一次。"""
    # 这个模块本身就是注册表，import 即注册
    logger.debug("后台任务 handler 已注册: thumbnail")


@register_task("chunk_index")
def handle_chunk_index(task: BackgroundTask) -> None:
    """建块 + 向量化。幂等由 index_video 内部保证：

    - 块和向量都齐 → 直接返回
    - 块齐了向量没齐（上次崩在向量化中间）→ 只补向量，不重建
    - 字幕变过 → 重建

    所以这个 handler 被重复执行是安全的，恢复机制可以放心重投。
    """
    from app.services.embedding_pipeline import index_video

    result = index_video(int(task.target_id))
    logger.info("索引完成 video=%s %s", task.target_id, result)


def _register_all() -> None:
    """占位：所有 handler 在 import 时通过装饰器注册。"""
