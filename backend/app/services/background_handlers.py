"""通用后台任务的具体处理函数。

每个 handler 都必须是**幂等**的 —— 恢复机制会让任务被重复执行。
这里注册的 kind：

  thumbnail  给单个视频补缩略图（批量补齐走定时扫描，这个是单点重试用）

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
from app.services.background_tasks import register_task
from app.utils.files import resolve_media_path

logger = logging.getLogger(__name__)


@register_task("thumbnail")
def handle_thumbnail(task: BackgroundTask) -> None:
    """补单个缩略图。幂等：已有缩略图直接跳过。"""
    from app.services.file_scanner import generate_thumbnail

    db = SessionLocal()
    try:
        video = db.query(Video).filter(Video.id == int(task.target_id)).first()
        if video is None:
            raise ValueError(f"视频不存在 id={task.target_id}")
        if video.thumbnail:
            return

        resolved = resolve_media_path(video.filepath)
        result = generate_thumbnail(str(resolved), video.id)
        if not result:
            raise RuntimeError(f"缩略图生成失败 video_id={video.id}")
        video.thumbnail = result
        db.commit()
    finally:
        db.close()


def register_all() -> None:
    """确保所有 handler 被导入注册。worker 启动时调用一次。"""
    # 这个模块本身就是注册表，import 即注册
    logger.debug("后台任务 handler 已注册: thumbnail")
