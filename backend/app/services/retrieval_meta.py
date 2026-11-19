"""检索元数据：把磁盘路径 / 文件名变成「可检索、可展示」的线索。

## 为什么需要这个模块

向量只对 content_chunks.text（字幕正文）做，词法只 ILIKE `content_chunks.text`。
也就是说：**一个视频叫什么、属于哪门课、在第几章第几节，检索时完全看不见。**

实测（60,307 块 / 8,785 个已索引视频，2026-11）：

    Q「黑马前端 jQuery 第五章」→ top5 全落在「黑马前端8.0 / 03、ajax全部」
    与「JS基础」，一条 jQuery 的都没有 —— 而库里实际有 117 个 jQuery 相关视频
    Q「什么是 GC 算法」→ top5 是 AIGC 相关片段（"C" 字母撞上），
    真正叫《3、什么是GC算法》的那个视频一次都没出现

这两类查询（"查某类课程"）靠字幕正文是救不回来的：课程名、章名、
课时名只存在于路径里。

## 设计约束（很重要）

1. **不改库、不重建向量**。本模块全部是纯函数 + 只读查询，算出来的东西
   只在单次请求内使用。换来的好处是可以随时回滚：把开关关掉即恢复原行为。
2. **清洗只做高置信度的删除**（复用 textclean.clean_video_title），
   宁可不干净也不能把课程名改错 —— 标题是用户认视频的唯一依据。
3. **不做分词**。检索场景下多召回几个词比漏召回好；真正决定精度的是
   调用方（lexical.meta_search）的文档频率过滤。

## 短文件名为什么要靠上层目录

`02-获取位置.mp4`、`03.mp4`、`2.mp4` 单独看没有任何信息量。它们的语义
全部来自父目录：`5-5 jQuery动画 / 02-获取位置` 才等于
「jQuery 动画这一节里获取元素位置」。

所以 meta_text 取的是「最近 3 层目录 + 课时名」，而不是整条路径：
再往上（阶段三 / 01、视频）对区分度没有贡献，只会稀释向量和词法匹配。

## 同目录序号是顺序线索

`02` → `03` 隐含「先看 02 再看 03」。这不是检索词，是**阅读顺序**，
所以不拼进 meta_text（会污染文本匹配），而是单独作为结构化字段
（lesson_no / position / total / prev / next）挂在结果上，
由前端或 agent 决定要不要展示 "第 2 / 7 节 · 下一节：03-滚动距离"。

## 开关

    RETRIEVAL_META_ENABLED=0     关闭全部元数据能力（回到 3.0 原行为）
    RETRIEVAL_META_CHANNEL=0     只关「元数据检索通道」，展示字段保留
    RETRIEVAL_META_SEQUENCE=0    只关同目录顺序（prev/next/第 N 节）

默认全开。关掉任何一个都不会影响已有向量和块数据。
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass, field

from app.utils.textclean import clean_video_title

logger = logging.getLogger(__name__)


def _flag(name: str, default: str = "1") -> bool:
    return os.getenv(name, default).strip().lower() not in {"0", "false", "off", "no", ""}


ENABLED = _flag("RETRIEVAL_META_ENABLED")
# 元数据检索通道（独立的第三路召回）。关掉只是少一路召回，排名回退到
# 词法 + 向量两路融合，和 3.0 一致。
CHANNEL_ENABLED = ENABLED and _flag("RETRIEVAL_META_CHANNEL")
# 同目录顺序（prev/next/第 N 节）。纯展示字段，不参与排序，默认开。
SEQUENCE_ENABLED = ENABLED and _flag("RETRIEVAL_META_SEQUENCE")

# 拼进 meta_text 的目录层数。3 层是实测折中：
#   「黑马前端V7.6 / 第五章 jQuery / 5-5 jQuery动画 / 02-获取位置」
# 再往上多一层就只剩「阶段三 / 01、视频」这种零信息量的层级。
META_LEVELS = 3

# 检索根前缀。容器内是 /videos，本机直跑是 D:\ITJC（沿用 paths._ROOT_PREFIXES）。
_ROOT_PREFIXES = ("/videos/", "/itjc/", "d:/itjc/")

# 只承担「装东西」作用的目录名：视频 / 01、视频 / 02-视频 / 4.视频。
# 这类层级既不能当课程名，也不该参与词法匹配（每个视频都有，df 极高）。
_NOISE_LEVEL_RE = re.compile(
    r"^(?:\d{1,2}\s*[、.．\-_]\s*)?(?:视频|视频教程|课程视频|录播|回放|直播回放)$"
)

# 资料库根节点（第一层目录里属于「分类」而不是「课程」的）。
# 取自实测数据（14,327 个视频的路径首段）：前端 6230 / Python 3665 /
# 产品经理 995 / mksz 720 —— 其余首段都是具体课程名。
# 这层信息只用于「课程名猜得准不准」，猜不出也不影响检索，
# 所以允许用环境变量覆盖，不追求完备。
_LIBRARY_ROOTS = {
    item.strip()
    for item in os.getenv(
        "RETRIEVAL_META_LIBRARY_ROOTS", "前端,Python,产品经理,mksz,后端,设计,学习资料"
    ).split(",")
    if item.strip()
}

# 课时序号的三种写法：02-xxx / 第2节 xxx / 纯数字 02
_SEQ_PATTERNS = (
    re.compile(r"^\s*(\d{1,3})\s*[、.．:：\-_]"),
    re.compile(r"^\s*第\s*(\d{1,3})\s*[节讲课章]"),
    re.compile(r"^\s*(\d{1,3})\s*$"),
)


@dataclass
class VideoMeta:
    """一个视频的路径线索。全部由 filepath 推导，不落库。"""

    # 清洗后的完整目录链（已去掉根前缀和「视频」这类噪音层）
    chain: list[str] = field(default_factory=list)
    # 课程名：目录链第一层。取不到时退化成空串
    course: str = ""
    # 最近 META_LEVELS 层目录，用于拼 meta_text
    recent: list[str] = field(default_factory=list)
    # 课时名（标题，优先用 videos.title）
    lesson: str = ""
    # 课时序号（解析出来的数字，解析不到为 None）
    lesson_no: int | None = None
    # 拼给向量/词法用的单行文本
    meta_text: str = ""
    # 给用户看的层级（不含文件名、不含系统路径）
    display: str = ""

    def as_dict(self) -> dict:
        return {
            "course": self.course,
            "lesson": self.lesson,
            "lesson_no": self.lesson_no,
            "meta_text": self.meta_text,
            "display": self.display,
            "chain": self.chain,
        }


def strip_root(filepath: str) -> str:
    """切掉检索根前缀，保留原始大小写（FastAPI 不能变成 fastapi）。"""
    if not filepath:
        return ""
    normalized = re.sub(r"/+", "/", filepath.replace("\\", "/"))
    lowered = normalized.lower()
    for prefix in _ROOT_PREFIXES:
        if lowered.startswith(prefix):
            return normalized[len(prefix):]
    return normalized.lstrip("/")


def folder_parts(filepath: str) -> list[str]:
    """目录链（清洗 + 去掉噪音层），不含文件名。"""
    relative = strip_root(filepath)
    if not relative:
        return []
    parts = [p for p in relative.split("/") if p]
    parts = parts[:-1] if parts else []  # 最后一段是文件名
    out: list[str] = []
    for part in parts:
        cleaned = clean_video_title(part).strip()
        if not cleaned or _NOISE_LEVEL_RE.match(cleaned):
            continue
        out.append(cleaned)
    return out


def parse_lesson_no(stem: str) -> int | None:
    """从文件名里解析课时序号。解析不到就返回 None（不要瞎猜）。"""
    if not stem:
        return None
    for pattern in _SEQ_PATTERNS:
        match = pattern.match(stem)
        if match:
            try:
                return int(match.group(1))
            except ValueError:
                return None
    return None


def _fallback_lesson(stem: str) -> str:
    """文件名的兜底展示名：去掉站名/重复后缀后，纯数字的换成「第 N 节」。"""
    cleaned = clean_video_title(stem).strip()
    if re.fullmatch(r"\d{1,3}", cleaned):
        return f"第 {int(cleaned)} 节"
    return cleaned


def build_meta(filepath: str | None, title: str | None = None) -> VideoMeta:
    """从 filepath + title 推导检索/展示用的元数据。纯函数，不查库。

    title 优先用库里的 videos.title（已清洗过，且可能被用户改过），
    文件名只在没有 title 时兜底。
    """
    if not filepath:
        return VideoMeta(lesson=(title or "").strip())

    relative = strip_root(filepath)
    filename_stem = relative.split("/")[-1].rsplit(".", 1)[0] if relative else ""
    chain = folder_parts(filepath)

    lesson = (title or "").strip() or _fallback_lesson(filename_stem)
    lesson_no = parse_lesson_no(filename_stem)
    # 文件名只有序号时（"2.mp4"），纯数字当课时名没有意义，
    # 必须由父目录补足语义 —— 展示成「第 2 节」才不至于让用户点进去才发现是啥
    if lesson and re.fullmatch(r"\d{1,3}", lesson):
        lesson = f"第 {int(lesson)} 节"

    recent = chain[-META_LEVELS:] if chain else []
    # meta_text 去重：课时名已包含最后一层目录时不再重复（如「5-5 jQuery动画」+「jQuery动画」）
    pieces = list(recent)
    if lesson and (not pieces or lesson not in pieces[-1]):
        pieces.append(lesson)
    meta_text = " / ".join(pieces)

    # 课程名：跳过「前端 / Python / 产品经理」这类资料库分类层。
    # /videos/前端/黑马前端V7.6/... → 黑马前端V7.6
    # /videos/尚硅谷-xxx/...        → 尚硅谷-xxx
    library = chain[0] if chain and chain[0] in _LIBRARY_ROOTS else ""
    rest = chain[1:] if library else chain
    course = rest[0] if rest else library

    # 展示层级：资料库 / 课程 / 最近一层目录，最多三段。
    # 再长前端卡片放不下，而且「阶段三 / 01、视频」这类中间层对用户没有意义。
    display_parts: list[str] = []
    for part in (library, course, recent[-1] if recent else ""):
        if part and part not in display_parts:
            display_parts.append(part)

    return VideoMeta(
        chain=chain,
        course=course,
        recent=recent,
        lesson=lesson,
        lesson_no=lesson_no,
        meta_text=meta_text,
        display=" / ".join(display_parts),
    )


def meta_terms(query: str, *, max_terms: int = 6) -> list[str]:
    """把查询拆成「可能出现在路径/标题里」的词。

    与 lexical.extract_tokens / extract_cjk_terms 的区别：
      - 额外保留**去空格的整串**（"什么是 GC 算法" → "什么是GC算法"）。
        课程名的写法常常是「GC算法」连写，而分词会把它切成 算法/GC 两个
        高 df 的泛词，反而命中不了《3、什么是GC算法》这种标题。
      - 中文串按疑问词切掉尾巴（复用 lexical 的停用词表由调用方负责，
        这里只保证长度可用）。

    注意：这里不做文档频率过滤，那是调用方（metadata_channel）的事。
    """
    from app.services.lexical import extract_cjk_terms, extract_tokens

    query = (query or "").strip()
    if not query:
        return []

    terms: list[str] = []
    compact = re.sub(r"\s+", "", query)
    if 2 <= len(compact) <= 24:
        terms.append(compact)

    for term in extract_cjk_terms(query, max_terms=max_terms):
        if term not in terms:
            terms.append(term)

    for token in extract_tokens(query, max_code_tokens=max_terms, min_latin_len=2):
        if token not in terms:
            terms.append(token)

    return terms[:max_terms]


def attach_sequence(hits, *, engine=None) -> None:
    """给最终结果补「同目录第几节 / 上一节 / 下一节」。

    只在**最终 top_k** 上跑一次查询（8 条左右，通常落在 3-5 个目录里），
    按目录分组后在本目录内按 sort_key 排序。

    不参与排序 —— 只是让模型/用户知道「这条后面还有 03-滚动距离」这类
    顺序信息。同目录序号是真实存在的学习顺序线索，但它是**关系**，
    拼进向量文本只会让同一目录的所有块向量都变相似。
    """
    if not SEQUENCE_ENABLED or not hits:
        return

    from sqlalchemy import text as sql_text

    if engine is None:
        from app.database import engine as _engine

        engine = _engine

    # 目录直接从原始 filepath 推导（保留各部署的根前缀），
    # 不要用 strip_root 之后的相对路径去拼 /videos/ —— 本机直跑是 D:/ITJC。
    dirs: set[str] = set()
    for hit in hits:
        filepath = getattr(hit, "filepath", None)
        if not filepath:
            continue
        normalized = re.sub(r"/+", "/", filepath.replace("\\", "/"))
        directory = re.sub(r"[^/]*$", "", normalized)
        if directory and directory != "/":
            dirs.add(directory)
    if not dirs:
        return

    sql = """
        SELECT v.id, v.title, v.filepath, v.sort_key
        FROM videos v
        WHERE regexp_replace(v.filepath, '[^/]*$', '') = ANY(:dirs)
        ORDER BY v.sort_key
    """
    try:
        with engine.connect() as conn:
            rows = conn.execute(sql_text(sql), {"dirs": list(dirs)}).fetchall()
    except Exception as exc:  # noqa: BLE001
        logger.warning("顺序线索查询失败，跳过: %s", exc)
        return

    grouped: dict[str, list] = {}
    for row in rows:
        directory = re.sub(r"[^/]*$", "", row.filepath)
        grouped.setdefault(directory, []).append(row)

    index_of: dict[int, dict] = {}
    for directory, items in grouped.items():
        total = len(items)
        for position, row in enumerate(items):
            index_of[row.id] = {
                "position": position + 1,
                "total": total,
                "prev": (
                    {"video_id": items[position - 1].id, "title": items[position - 1].title}
                    if position > 0
                    else None
                ),
                "next": (
                    {"video_id": items[position + 1].id, "title": items[position + 1].title}
                    if position + 1 < total
                    else None
                ),
            }

    for hit in hits:
        info = index_of.get(getattr(hit, "video_id", None))
        if not info:
            continue
        meta = getattr(hit, "meta", None) or {}
        meta = dict(meta)
        meta.update(info)
        hit.meta = meta
