"""把磁盘路径转成可以展示给用户看的「文件夹层级」。

## 为什么要单独做

相关片段现在只有视频标题和时间戳。用户看《01、01-【基础认知】...》
不知道它属于哪门课、在哪个目录下 —— 尤其标题前缀相似时（各种
「01、01-」），根本分不清来自哪套课程。

但**绝不能把系统路径直接显示出来**：
    D:\\ITJC\\产品经理\\Y亚慧ai产品经理课【itjc8.com】\\01、xxx.mp4
    /videos/产品经理/Y亚慧ai产品经理课【itjc8.com】/01、xxx.mp4

既有安全风险（暴露服务器目录结构、用户名），又难看。

所以只取「根前缀之后的相对层级」，并且只取前几层，
每层再过一遍标题清洗（去掉 itjc8.com 这种来源标记）。
"""

from __future__ import annotations

import re
from pathlib import PurePosixPath

from app.utils.textclean import clean_video_title

# 扫描根前缀。两种都出现过：本机直跑是 D:\ITJC，Docker 是 /videos。
_ROOT_PREFIXES = ("/videos/", "d:/itjc/", "/itjc/")


def _strip_root(filepath: str) -> str:
    """只切掉根前缀，保留原始大小写（FastAPI 不能变成 fastapi）。"""
    # 合并连续斜杠：有些老记录是双反斜杠转义过的，不合并会匹配不上根前缀
    normalized = re.sub(r"/+", "/", filepath.replace("\\", "/"))
    lowered = normalized.lower()
    for prefix in _ROOT_PREFIXES:
        if lowered.startswith(prefix):
            return normalized[len(prefix) :]
    return normalized


def display_folder_path(filepath: str | None, *, levels: int = 2) -> str:
    """返回「课程目录 / 子目录」，不含文件名和系统根前缀。

        /videos/产品经理/Y亚慧ai产品经理课【itjc8.com】/01、AI产品经理.mp4
        → 产品经理 / Y亚慧ai产品经理课

    取不到任何层级时返回空串，让调用方决定要不要显示。
    """
    if not filepath:
        return ""

    parts = [p for p in PurePosixPath(_strip_root(filepath)).parts if p]
    # 最后一段是文件名，去掉
    parts = parts[:-1] if parts else []
    if not parts:
        return ""

    cleaned = (clean_video_title(p) for p in parts[: max(1, levels)])
    return " / ".join(name for name in cleaned if name)
