"""通用后台任务的具体处理函数。

每个 handler 都必须是**幂等**的 —— 恢复机制会让任务被重复执行。

当前注册的 kind 只有一个：

  chunk_index  给单个视频建语义块 + 向量化（转写完成后自动投递；
               中断后由扫描重新发现，index_video 自身幂等）

## 2026-11 清理时删掉了 thumbnail handler

它通过 @register_task("thumbnail") 注册，但全项目从来没有
`enqueue_task("thumbnail", ...)` —— 装饰器让它「活着」，运行时永远不可达。
缩略图实际有另外两条路径：
  - ThumbnailWorker（进程内线程池，真正在跑的那个）
  - file_scanner.generate_missing_thumbnails（rescan 时补几张）
留着一个永远收不到任务的 handler，只会让人以为「缩略图任务走队列」。

以后要加新 kind，就在这里写：

  @register_task("embedding")
  def handle_embedding(task):
      video_id = task.target_id
      # 1. 先查这条视频是否已经有完整的向量，有就直接返回（幂等）
      # 2. 没有就重新算
      # 3. 写回时用 upsert，不要 insert（避免重复执行报主键冲突）
"""

from __future__ import annotations

import logging

from app.models import BackgroundTask
from app.services.background_tasks import TaskHandler, register_task

logger = logging.getLogger(__name__)


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


def register_all() -> None:
    """确保所有 handler 被导入注册。worker 启动时调用一次。

    这个模块本身就是注册表，import 即注册 —— 函数体只需要打一行日志，
    证明 worker 确实把它 import 进来了。

    **注意：不要给它加 @register_task 装饰器。**
    2026-11 删 handle_thumbnail 时，删除脚本把装饰器行一起吞掉了，
    结果 @register_task("thumbnail") 落到了这个函数头上 ——
    注册表里出现一个叫 thumbnail、实际行为是「打一行日志」的 handler。
    """
    logger.debug("后台任务 handler 已注册: %s", ", ".join(TaskHandler.kinds()))
