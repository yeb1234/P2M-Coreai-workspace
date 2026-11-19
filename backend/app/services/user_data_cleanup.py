"""用户数据生命周期：删除笔记/用户时清理磁盘文件。

为什么单独一层
--------------
`Note` 的私有内容同时存在于 DB 和 `work_dir/user-notes/{user_id}/note-{id}.md`。
如果只删 DB 行，文件会永久留在磁盘；如果只删目录，DB 行又会变成指向空文件的
僵尸记录。删除必须两边都覆盖，而且路径必须来自服务端计算，不能信任 DB 里可能
被写坏的 `markdown_path`。

另一个约束：`output_dir` 曾被 mount 成公开静态目录，旧版私有笔记曾落在这里。
历史文件要一并清掉，但只能删 `user-notes/{user_id}` 这一层，不能对任意路径
做递归删除。
"""

from __future__ import annotations

import logging
import shutil
from pathlib import Path

from app.database import settings

logger = logging.getLogger(__name__)


def _under(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except (OSError, ValueError):
        return False


def _unlink_private_file(path: Path, root: Path) -> None:
    if not _under(path, root):
        logger.warning("拒绝删除越界私有笔记文件 path=%s root=%s", path, root)
        return
    try:
        if path.is_file():
            path.unlink()
            logger.info("已删除私有笔记文件 path=%s", path)
    except OSError:
        logger.warning("删除私有笔记文件失败 path=%s", path, exc_info=True)


def delete_private_note_files(note_id: int, user_id: int | None) -> None:
    """删除一条私有笔记的当前文件和旧公开目录残留。"""
    if user_id is None:
        logger.warning("私有笔记缺少 user_id，跳过文件清理 note=%s", note_id)
        return

    work_root = Path(settings.work_dir)
    output_root = Path(settings.output_dir)
    _unlink_private_file(
        work_root / "user-notes" / str(user_id) / f"note-{note_id}.md",
        work_root,
    )
    # 旧版私有笔记曾落在 output_dir（公开静态目录）下，必须一并清掉。
    _unlink_private_file(
        output_root / "user-notes" / str(user_id) / f"note-{note_id}.md",
        output_root,
    )


def _remove_user_dir(root: Path, user_id: int) -> None:
    target = root / "user-notes" / str(user_id)
    if not target.exists():
        return
    if not _under(target, root):
        logger.warning("拒绝删除越界用户笔记目录 target=%s root=%s", target, root)
        return
    try:
        shutil.rmtree(target)
        logger.info("已删除用户笔记目录 path=%s", target)
    except OSError:
        logger.warning("删除用户笔记目录失败 path=%s", target, exc_info=True)


def delete_user_files(user_id: int) -> None:
    """删除用户的私有笔记目录（当前 work_dir + 旧 output_dir）。"""
    _remove_user_dir(Path(settings.work_dir), user_id)
    _remove_user_dir(Path(settings.output_dir), user_id)
