"""语义块索引管线：建块 + 向量化。幂等、可中断、可续跑。

## 这条管线为什么必须有

转写完成后，原来的流程就结束了 —— 建块和向量化要靠人工跑两个脚本
（`scripts/build_content_chunks.py` / `scripts/backfill_chunk_embeddings.py`）。

结果是「新转写的视频在检索里搜不到」，而且**没人知道漏了哪些**。
实测 8,819 个有字幕的视频恰好都索引完了，是因为有人手工跑过；
如果再转写 100 个，就会有 100 个搜不到，而日志里没有任何异常。

## 和缩略图不一样：派生数据无法自证新鲜

缩略图的恢复信号是 `thumbnail IS NULL` —— 完整、精确、不需要额外标记。

语义块不行：视频重转过、字幕变了，旧块还在、旧向量也在。
扫 `content_chunks` 只能看出「有没有」，看不出「是不是旧的」。

所以分两层判断：

1. `videos.chunk_indexed_at` —— 最后一次「块和向量都齐了」的时间。
   扫描用它做快速筛选（NULL = 从没做过）。
2. `min(content_chunks.created_at) >= max(subtitle_segments.created_at)`
   —— 块是不是基于**当前这版字幕**生成的。

第 2 条是必须的：重建块之后、向量算完之前进程被杀，块是新的但向量是空的。
如果只靠 `chunk_indexed_at` 判断，下次会认为「没做过」→ 再重建一次 →
把已经算好的向量全冲掉，永远算不完。

## 续跑的三个层次

    整条没做过            → 建块 + 向量化
    块建好了、向量没齐    → 只补向量（不重建）
    块和向量齐了但字幕变了 → 重建

杀进程、重启、Redis 丢队列都不影响：扫描会重新发现，索引从断点继续。
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime

from sqlalchemy import func

from app.database import SessionLocal
from app.models import SubtitleSegment, Video
from app.services.chunker import split_into_chunks
from app.services.subtitle_cleaner import clean_segments
from app.services.vector_version import VECTOR_VERSION

logger = logging.getLogger(__name__)

# 一次补齐多少块。太小 → 请求次数多；太大 → 中断时浪费的进度多。
# 单块约 565 字，64 块一次约 3.6 万字，本地 bge-m3 大约 1 秒。
EMBED_BATCH_SIZE = 64

# 扫描间隔（秒）。只在 worker 进程里跑。
SCAN_INTERVAL_SECONDS = 300
# 单轮最多投递多少个视频。
# 200 而不是更大：单个索引任务只有几次查询（已索引过的视频只需写一个标记），
# 200 个任务的额外开销可以忽略，又不至于一次性把队列灌满。
SCAN_BATCH = 200


def _vector_literal(vec: list[float]) -> str:
    """halfvec 接受文本格式 [1,2,3]。5 位小数对半精度足够（半精度本身只有约 3 位有效数字）。"""
    return "[" + ",".join(f"{x:.5f}" for x in vec) + "]"


def _chunk_state(video_id: int) -> tuple[int, int, datetime | None, int]:
    """返回 (块数, 缺向量的块数, 最早块的创建时间, 非当前版本的块数)。"""
    from sqlalchemy import text

    from app.database import engine

    with engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT count(*), "
                "count(*) FILTER (WHERE embedding IS NULL), "
                "min(created_at), "
                "count(*) FILTER (WHERE vector_version <> :version) "
                "FROM content_chunks WHERE video_id = :vid"
            ),
            {"vid": video_id, "version": VECTOR_VERSION},
        ).first()
    if not row:
        return 0, 0, None, 0
    return int(row[0] or 0), int(row[1] or 0), row[2], int(row[3] or 0)


def _latest_subtitle_at(db, video_id: int) -> datetime | None:
    return (
        db.query(func.max(SubtitleSegment.created_at))
        .filter(SubtitleSegment.video_id == video_id)
        .scalar()
    )


def _archive_old_chunks(video_id: int, reason: str) -> int:
    """把该视频非当前版本的旧块写进 history，再允许删除。

    只在版本不一致时调用；同一版本强刷不归档，避免 history 被重复重建撑大。
    `archived_at=now()` 在同一事务内稳定，回滚脚本按它取同一批快照。
    """
    from sqlalchemy import text

    from app.database import engine

    with engine.begin() as conn:
        result = conn.execute(
            text(
                """
                INSERT INTO content_chunks_history
                    (original_id, video_id, chunk_index, start_sec, end_sec, text,
                     char_count, segment_count, embedding, vector_version, archived_at, reason)
                SELECT id, video_id, chunk_index, start_sec, end_sec, text,
                       char_count, segment_count, embedding, vector_version, now(), :reason
                FROM content_chunks
                WHERE video_id = :vid AND vector_version <> :version
                """
            ),
            {"vid": video_id, "version": VECTOR_VERSION, "reason": reason},
        )
    return int(result.rowcount or 0)


def _build_chunks(video_id: int, *, archive_old: bool = False) -> int:
    """删掉旧块、按当前字幕重建。向量留空，由 _embed_pending 补。

    删+插而不是原地更新：分块边界会随字幕内容变化整体移动，
    逐块 diff 的复杂度远高于重建，而单视频只有 7 块左右。
    """
    from sqlalchemy import text

    # 自己开短 session：建块是纯 DB 操作，几毫秒。
    # 不让调用方传 session 进来，是为了杜绝「顺手把网络请求夹在事务中间」。
    db = SessionLocal()
    try:
        if archive_old:
            _archive_old_chunks(video_id, reason=f"before {VECTOR_VERSION}")
        rows = (
            db.query(SubtitleSegment.start_sec, SubtitleSegment.end_sec, SubtitleSegment.text)
            .filter(SubtitleSegment.video_id == video_id)
            .order_by(SubtitleSegment.start_sec)
            .all()
        )
        segments = [(r.start_sec, r.end_sec, r.text) for r in rows]
        # 只清洗进入向量库的文本：原始字幕和 VTT 不动，保留回看与时间轴。
        # 向量使用更保守的 vector_safe：不删相邻重复词，不删句末口头反问。
        segments = clean_segments(segments, mode="vector_safe")
        chunks = split_into_chunks(segments)

        db.execute(
            text("DELETE FROM content_chunks WHERE video_id = :vid"), {"vid": video_id}
        )
        if chunks:
            db.execute(
                text(
                    "INSERT INTO content_chunks "
                    "(video_id, chunk_index, start_sec, end_sec, text, char_count, segment_count, vector_version) "
                    "VALUES (:vid, :idx, :s, :e, :t, :c, :n, :v)"
                ),
                [
                    {
                        "vid": video_id,
                        "idx": index,
                        "s": c["start_sec"],
                        "e": c["end_sec"],
                        "t": c["text"],
                        "c": c["char_count"],
                        "n": c["segment_count"],
                        "v": VECTOR_VERSION,
                    }
                    for index, c in enumerate(chunks)
                ],
            )
        db.commit()
        return len(chunks)
    finally:
        db.close()


def _embed_pending(video_id: int, *, batch_size: int = EMBED_BATCH_SIZE) -> int:
    """把这个视频所有缺向量的块补上，返回本次补了多少。

    每批独立提交：中途被杀，已算的批次保留，下次从这里继续。
    """
    from sqlalchemy import text

    from app.database import engine
    from app.services.embeddings import get_embedding_client

    client = get_embedding_client()
    total = 0

    while True:
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    "SELECT id, text FROM content_chunks "
                    "WHERE video_id = :vid AND embedding IS NULL "
                    "ORDER BY id LIMIT :lim"
                ),
                {"vid": video_id, "lim": batch_size},
            ).fetchall()
        if not rows:
            break

        vectors = client.embed([r.text for r in rows])
        if len(vectors) != len(rows):
            raise RuntimeError(
                f"嵌入返回数量不匹配 video={video_id}: {len(vectors)} != {len(rows)}"
            )

        values = ", ".join(f"(:id{i}, CAST(:v{i} AS halfvec))" for i in range(len(rows)))
        params: dict = {}
        for i, (row, vec) in enumerate(zip(rows, vectors)):
            params[f"id{i}"] = row.id
            params[f"v{i}"] = _vector_literal(vec)

        with engine.begin() as conn:
            conn.execute(
                text(
                    f"UPDATE content_chunks AS c "
                    f"SET embedding = v.emb, vector_version = :version "
                    f"FROM (VALUES {values}) AS v(id, emb) WHERE c.id = v.id"
                ),
                {**params, "version": VECTOR_VERSION},
            )
        total += len(rows)

    return total


def index_video(video_id: int, *, force: bool = False) -> dict:
    """给一个视频建块并向量化。幂等，可重复调用。

    **全程不让 DB 事务跨越网络请求（嵌入服务）**：
        短事务读状态 → 短事务建块 → 无事务调嵌入 → 短事务写标记

    嵌入一个视频可能几十秒（大视频几十块），如果中间攥着事务，
    `videos` 上的 ACCESS SHARE 会把 `ALTER TABLE videos` 卡死。
    缩略图那边就是这么把后端启动卡了 12 分钟的。

    force=True 时无条件重建（换模型、调分块参数后用）。
    """
    # ── ① 读状态（短事务）──
    db = SessionLocal()
    try:
        video = db.query(Video.id, Video.chunk_indexed_at).filter(Video.id == video_id).first()
        if video is None:
            raise ValueError(f"视频不存在 id={video_id}")
        indexed_at = video.chunk_indexed_at
        latest_sub = _latest_subtitle_at(db, video_id)
    finally:
        db.close()

    if latest_sub is None:
        # 没字幕就没得切。不要打标记 —— 将来转写完了还能被扫到。
        return {"video_id": video_id, "status": "skipped", "reason": "没有字幕"}

    chunk_count, missing, min_created, version_mismatch = _chunk_state(video_id)

    # 块是否基于当前这版字幕
    chunks_current = chunk_count > 0 and min_created is not None and min_created >= latest_sub
    # 块和向量是否都齐了，且文本块属于当前向量版本
    up_to_date = (
        chunks_current
        and missing == 0
        and version_mismatch == 0
        and indexed_at is not None
        and indexed_at >= latest_sub
    )
    if up_to_date and not force:
        return {"video_id": video_id, "status": "skipped", "reason": "已是最新"}

    rebuilt = 0
    if force or not chunks_current or version_mismatch > 0:
        rebuilt = _build_chunks(video_id, archive_old=version_mismatch > 0)
        chunk_count, _, _, _ = _chunk_state(video_id)
        if chunk_count == 0:
            # 字幕太短，切不出块。打标记避免每轮扫描都重新投递。
            _mark_indexed(video_id)
            return {"video_id": video_id, "status": "empty", "chunks": 0}

    # ── ② 向量化（无事务，纯网络 + 分批短写）──
    embedded = _embed_pending(video_id)

    # ── ③ 只有全部补齐才打标记（短事务）──
    _, still_missing, _, _ = _chunk_state(video_id)
    if still_missing == 0:
        _mark_indexed(video_id)

    return {
        "video_id": video_id,
        "status": "indexed",
        "rebuilt": rebuilt,
        "embedded": embedded,
        "chunks": chunk_count,
        "pending_vectors": still_missing,
    }


def _mark_indexed(video_id: int) -> None:
    """写入「索引完成」时间戳。短事务，Core UPDATE，不加载对象。"""
    from sqlalchemy import text

    from app.database import engine

    with engine.begin() as conn:
        conn.execute(
            text("UPDATE videos SET chunk_indexed_at = now() WHERE id = :vid"),
            {"vid": video_id},
        )


def scan_missing(limit: int = SCAN_BATCH) -> dict:
    """扫出需要索引的视频并投递任务，返回投递统计。

    两句查询，各自有明确意图：
      1. chunk_indexed_at IS NULL        —— 从没做过（快，只看标记列）
      2. chunk_indexed_at < 字幕时间      —— 下标了但字幕又变了
    第 2 句只对已标记的 ~8.8k 行算子查询，不会全表扫 3.6M 条字幕。
    """
    from sqlalchemy import text

    from app.database import engine
    from app.services.background_tasks import enqueue_task

    with engine.connect() as conn:
        never = conn.execute(
            text(
                """
                SELECT v.id FROM videos v
                WHERE v.chunk_indexed_at IS NULL
                  AND EXISTS (SELECT 1 FROM subtitle_segments s WHERE s.video_id = v.id)
                ORDER BY v.id
                LIMIT :lim
                """
            ),
            {"lim": limit},
        ).fetchall()

        stale = conn.execute(
            text(
                """
                SELECT v.id FROM videos v
                WHERE v.chunk_indexed_at IS NOT NULL
                  AND v.chunk_indexed_at < (
                    SELECT max(s.created_at) FROM subtitle_segments s WHERE s.video_id = v.id
                  )
                ORDER BY v.id
                LIMIT :lim
                """
            ),
            {"lim": limit},
        ).fetchall()

        # 版本存量只统计、不自动入队。当前还有大量 1.0.0 旧块，
        # 如果这里直接按版本投递，会把整个库都塞进重建队列；版本迁移
        # 必须由显式运维命令触发，不能让一次普通巡检变成全量重嵌。
        version_stale = conn.execute(
            text(
                "SELECT count(*) FROM content_chunks "
                "WHERE vector_version <> :version"
            ),
            {"version": VECTOR_VERSION},
        ).scalar() or 0

    video_ids = [r[0] for r in never] + [r[0] for r in stale]
    queued = 0
    deduped = 0
    failed = 0
    for vid in video_ids:
        try:
            if enqueue_task("chunk_index", target_id=str(vid)):
                queued += 1
            else:
                # 已经在队列里（上一轮投过、还没跑完）
                deduped += 1
        except Exception:  # noqa: BLE001
            # 单条失败不拖垮整轮扫描；计数出来让上层看见
            failed += 1

    if queued:
        logger.info(
            "索引扫描：候选 %s，新投递 %s，已在队列 %s",
            len(video_ids), queued, deduped,
        )
    if failed:
        # 这才是真正的静默失效：有候选、也尝试了，但一条都没建起来。
        logger.error(
            "索引扫描：%s 个候选里有 %s 个投递失败（详见上面的创建任务失败）",
            len(video_ids), failed,
        )

    return {
        "candidates": len(video_ids),
        "queued": queued,
        "deduped": deduped,
        "failed": failed,
        "never_indexed": len(never),
        "stale": len(stale),
        "vector_version": VECTOR_VERSION,
        "version_stale_chunks": int(version_stale),
    }


def status() -> dict:
    """索引进度概览。前端/运维看这个判断还剩多少。"""
    from sqlalchemy import text

    from app.database import engine

    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT
                  (SELECT count(DISTINCT video_id) FROM subtitle_segments) AS subtitled,
                  (SELECT count(*) FROM videos WHERE chunk_indexed_at IS NOT NULL) AS indexed,
                  (SELECT count(*) FROM videos WHERE chunk_indexed_at IS NULL
                     AND EXISTS (SELECT 1 FROM subtitle_segments s WHERE s.video_id = videos.id)) AS pending,
                  (SELECT count(*) FROM content_chunks) AS chunks,
                  (SELECT count(*) FROM content_chunks WHERE embedding IS NULL) AS missing_vectors,
                  (SELECT count(*) FROM content_chunks
                     WHERE vector_version = :version) AS current_version_chunks,
                  (SELECT count(*) FROM content_chunks
                     WHERE vector_version <> :version) AS stale_version_chunks,
                  (SELECT count(*) FROM content_chunks
                     WHERE embedding IS NULL AND vector_version = :version) AS missing_current_vectors
                """
            ),
            {"version": VECTOR_VERSION},
        ).first()
    total_chunks = int(row[3] or 0)
    return {
        "videos_with_subtitles": int(row[0] or 0),
        "videos_indexed": int(row[1] or 0),
        "videos_pending": int(row[2] or 0),
        "chunks": total_chunks,
        "chunks_missing_vectors": int(row[4] or 0),
        "vector_coverage": (
            round(1 - int(row[4] or 0) / total_chunks, 4) if total_chunks else 0.0
        ),
        "vector_version": VECTOR_VERSION,
        "chunks_current_version": int(row[5] or 0),
        "chunks_stale_version": int(row[6] or 0),
        "chunks_missing_current_vectors": int(row[7] or 0),
        "version_coverage": (
            round(int(row[5] or 0) / total_chunks, 6) if total_chunks else 0.0
        ),
    }


_scan_thread: threading.Thread | None = None
_scan_stop = threading.Event()


def start_auto_scan(interval: int = SCAN_INTERVAL_SECONDS) -> None:
    """在 worker 进程里起一个扫描线程。

    放在 worker 而不是 backend：建块/向量化是重活，
    不该和 HTTP 请求抢线程；worker 是 restart: unless-stopped 的常驻进程，
    重启后这个线程自动回来，不需要人管。
    """
    global _scan_thread
    if _scan_thread is not None and _scan_thread.is_alive():
        return

    _scan_stop.clear()

    # 失败后的重试间隔。不能直接用 interval：启动瞬间主线程还在跑
    # create_all / migrations（DDL 连接刚归还），扫描线程立刻抢连接会撞上
    # 「connection in transaction status INTRANS」。这个错误是瞬时的，
    # 但如果按 300s 退避，每次重启都要白等 5 分钟才能继续补。
    RETRY_DELAY = 15

    # 连接池预热。
    #
    # 不加这一步，扫描线程的第一轮几乎必然失败：
    #   psycopg.ProgrammingError: can't change 'autocommit' now:
    #   connection in transaction status INTRANS
    # 原因是建连时 SQLAlchemy 要在连接上设 autocommit，
    # 而 worker 主线程刚跑完 DDL，池里是冷连接；扫描线程立刻并发建连，
    # 撞上「连接已进入事务但 autocommit 还没设完」的中间态。
    #
    # 单线程先建两条，把 set_autocommit 这段跑完，后面就不会撞。
    try:
        from app.database import engine

        for _ in range(2):
            with engine.connect():
                pass
    except Exception:  # noqa: BLE001
        logger.warning("连接池预热失败，扫描首轮可能报错（会自动重试）")

    def loop() -> None:
        logger.info("索引扫描线程启动，巡检间隔 %ss", interval)
        # 等主线程把建表/迁移收尾，再开始抢连接
        if _scan_stop.wait(3):
            return

        # 自适应节奏：
        #   排满了 → 10 秒后继续（首次补齐 8,800 个视频不能按 200/5min 走十几个小时）
        #   排空了 → 回到慢速巡检
        #   失败了 → 短退避，快速自愈
        while not _scan_stop.is_set():
            queued = 0
            failed = False
            try:
                queued = scan_missing()["queued"]
                if queued:
                    logger.info("索引扫描投递 %s 个任务", queued)
            except Exception:  # noqa: BLE001
                failed = True
                logger.exception("索引扫描失败，%ss 后重试", RETRY_DELAY)

            if failed:
                delay = RETRY_DELAY
            elif queued:
                delay = 10
            else:
                delay = interval
            _scan_stop.wait(delay)

    _scan_thread = threading.Thread(target=loop, name="chunk-index-scan", daemon=True)
    _scan_thread.start()


