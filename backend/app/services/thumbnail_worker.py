"""缩略图补齐：进程内自洽的后台 worker。

## 为什么重做

原来的实现是「每次请求起一个 daemon 线程，串行跑完这一批」：

    def _generate():
        for video in vids:            # 串行
            generate_thumbnail(...)
    threading.Thread(target=_generate, daemon=True).start()   # 每请求一个线程

四个问题：

1. **串行**：10 个视频就是 10 次 ffmpeg 排队等，一次只能用一个 CPU 核。
2. **每请求起线程**：两个请求同时到达时，两边都会捞到同一批「缺缩略图」的视频，
   同一个 video_id 被两个线程同时写文件、同时 commit —— 竞态。
3. **daemon=True**：进程一重启，正在生成的直接丢，而且 DB 里没记录，
   下次还得靠人工点「rescan」才能发现。
4. **没有可观测性**：前端问「还有多少没生成」答不上来。

## 现在这套

    submit(ids)          → 去重后投递，立即返回
    submit_missing()     → 扫一遍库里缺缩略图的，批量投递
    status()             → 当前进度 / 队列长度 / 成功失败计数
    shutdown()           → 优雅退出

四个关键设计，逐条对应上面的问题：

1. **固定大小的线程池**（不是每请求一个线程）
   ffmpeg 跑在独立进程里，Python 线程只是 subprocess.run 等着。
   等待期间线程会释放 GIL，所以多个线程能真正同时跑多个 ffmpeg。
   这也是为什么这里用线程而不是 asyncio —— asyncio 要包装
   subprocess 得走 run_in_executor，绕一圈还是回到线程池，
   反而多一层。CPU 密集的 Python 代码用线程没用（GIL 挡着），
   但调外部进程这种 IO 等待，线程正合适。

2. **去重集合 _inflight**
   同一个 video_id 在队列里或在跑的时候，重复 submit 会被忽略。
   竞态问题从根上消失，不需要给每个视频加锁。

3. **进程内常驻，不是每请求新建**
   配合下面的「自动补齐」：worker 启动时会扫一遍缺缩略图的库，
   之后每 AUTO_SCAN_INTERVAL 秒再扫一次。不需要人工触发 rescan。

4. **状态计数**
   status() 直接返回给管理接口，前端能看到进度。

## 不做的事

不追求「重启后恢复未完成的任务」。缩略图是幂等且廉价的（一张 jpg），
重启后自动扫描会重新发现它们，重新生成即可。为了这个引入持久化队列
（比如再开一个 RQ 队列）不值得 —— 转写任务才需要那种级别的保证。
"""

from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import or_

from app.database import SessionLocal
from app.models import Video
from app.services.file_scanner import generate_thumbnail
from app.utils.files import resolve_media_path

logger = logging.getLogger(__name__)

# 并发数：ffmpeg 生成一张缩略图大约几百毫秒到 2 秒，
# 4 个线程足够让磁盘和 CPU 都忙起来，又不至于把机器拖垮。
# 想调整的话改这里，或者在环境变量里覆盖。
DEFAULT_WORKERS = 4

# 自动补齐的扫描间隔（秒）。300 秒够快，又不至于频繁查库。
AUTO_SCAN_INTERVAL_SECONDS = 300

# 单次扫描最多投递多少个。库里有 2 万多条时不能一把全塞进队列，
# 分批发，靠滚动扫描消化。
MAX_BATCH_PER_SCAN = 200

# 并发在途上限。投递快于处理时，_inflight 会一直涨 ——
# 没有上限的话，自适应提速后队列能堆到几千个，全是内存。
MAX_INFLIGHT = 400

# 同一个视频最多自动重试几次。
# 损坏/不可读的文件永远生成不出缩略图，不封顶就是每轮扫描都重试一次，
# 白烧 ffmpeg 还刷日志。到上限后需要人工走 admin retry 接口。
MAX_THUMBNAIL_ATTEMPTS = 3


def _record_failure(video_id: int) -> int | None:
    """失败计数 +1，返回累计次数。短事务 + Core UPDATE，不加载整个对象。"""
    db = SessionLocal()
    try:
        db.query(Video).filter(Video.id == video_id).update(
            {
                "thumbnail_attempts": Video.thumbnail_attempts + 1,
                "thumbnail_failed_at": datetime.now(),
            },
            synchronize_session=False,
        )
        db.commit()
        return db.query(Video.thumbnail_attempts).filter(Video.id == video_id).scalar()
    except Exception:  # noqa: BLE001 - 记账失败不能盖掉真正的失败原因
        logger.warning("记录缩略图失败次数失败 video_id=%s", video_id, exc_info=True)
        return None
    finally:
        db.close()


@dataclass
class _Stats:
    queued: int = 0
    running: int = 0
    succeeded: int = 0
    failed: int = 0
    last_scan_at: float | None = None
    last_error: str | None = None


class ThumbnailWorker:
    """进程级单例。用下面的 get_thumbnail_worker() 取，不要直接 new。"""

    def __init__(self, workers: int = DEFAULT_WORKERS) -> None:
        self._pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="thumb")
        self._lock = threading.Lock()
        # 正在排队 / 正在跑的 video_id。用于去重。
        self._inflight: set[int] = set()
        self._stats = _Stats()
        self._stop = threading.Event()
        self._scanner: threading.Thread | None = None
        # 上一轮扫描是否扫满（说明库里还有更多候选）。
        # 不能只看「投递了几个」判断还有没有活：投递数会被 MAX_INFLIGHT 截断，
        # 池子满时永远是 0，于是退回 5 分钟一轮 —— 积压还在，吞吐却掉下来。
        self._last_scan_full = False

    # ── 对外接口 ──────────────────────────────────────────────

    def submit(self, video_ids: list[int]) -> int:
        """投递一批 video_id，返回真正新入队的数量（去重后）。"""
        if not video_ids:
            return 0

        with self._lock:
            room = MAX_INFLIGHT - len(self._inflight)
            if room <= 0:
                # 池子满了。不投了 —— 下一轮扫描会重新捡起这些视频
                return 0
            fresh = [vid for vid in video_ids[:room] if vid not in self._inflight]
            self._inflight.update(fresh)
            self._stats.queued += len(fresh)

        for vid in fresh:
            self._pool.submit(self._run_one, vid)
        return len(fresh)

    def submit_missing(self, limit: int = MAX_BATCH_PER_SCAN) -> int:
        """扫库，把缺缩略图的视频投进队列。返回新入队数量。"""
        db = SessionLocal()
        try:
            rows = (
                db.query(Video.id)
                .filter(or_(Video.thumbnail.is_(None), Video.thumbnail == ""))
                # 失败到上限的不再自动重试
                .filter(Video.thumbnail_attempts < MAX_THUMBNAIL_ATTEMPTS)
                .limit(limit)
                .all()
            )
            candidate_ids = [row[0] for row in rows]
            # 返回数量等于 limit，说明后面还有（不能证明有，但足够指导节奏）
            self._last_scan_full = len(candidate_ids) >= limit
            self._stats.last_scan_at = time.time()
        except Exception as exc:  # noqa: BLE001 - 扫描失败不该拖垮调用方
            self._stats.last_error = f"扫描失败: {exc}"
            logger.exception("扫描缺失缩略图失败")
            return 0
        finally:
            db.close()

        return self.submit(candidate_ids)

    def status(self) -> dict:
        with self._lock:
            inflight = len(self._inflight)
            stats = _Stats(
                queued=self._stats.queued,
                running=inflight,
                succeeded=self._stats.succeeded,
                failed=self._stats.failed,
                last_scan_at=self._stats.last_scan_at,
                last_error=self._stats.last_error,
            )
        return {
            "queued": stats.queued,
            "inflight": stats.running,
            "succeeded": stats.succeeded,
            "failed": stats.failed,
            "last_scan_at": stats.last_scan_at,
            "last_error": stats.last_error,
        }

    def start_auto_scan(self) -> None:
        """启动后台扫描线程：启动时扫一次，之后每 5 分钟扫一次。"""
        if self._scanner is not None:
            return

        def _loop() -> None:
            # 启动先等一下，别和 uvicorn 的启动流程抢数据库连接
            if self._stop.wait(10):
                return
            while not self._stop.is_set():
                added = 0
                try:
                    added = self.submit_missing()
                    if added:
                        logger.info("缩略图自动补齐：投递 %d 个", added)
                except Exception:  # noqa: BLE001
                    logger.exception("缩略图自动补齐扫描失败")

                # 自适应节奏：还有活就快点接着投，排空了才回到慢速巡检。
                #
                # 原来固定 5 分钟一轮、每轮 200 个 = 40 张/分钟，
                # 而 4 个线程实际能跑 120-800 张/分钟 —— 吞吐被扫描间隔卡住，
                # 2 万张积压要跑 9 小时。现在积压期是 10 秒一轮。
                with self._lock:
                    inflight = len(self._inflight)
                busy = self._last_scan_full or inflight >= MAX_INFLIGHT
                # 用 wait 而不是 sleep：可以在 shutdown 时立刻中断
                if self._stop.wait(10 if busy else AUTO_SCAN_INTERVAL_SECONDS):
                    return

        self._scanner = threading.Thread(target=_loop, name="thumb-scanner", daemon=True)
        self._scanner.start()

    def shutdown(self, wait: bool = False) -> None:
        self._stop.set()
        self._pool.shutdown(wait=wait)

    # ── 内部 ──────────────────────────────────────────────────

    def _run_one(self, video_id: int) -> None:
        """生成单个缩略图。

        三步分开，**任何 DB 事务都不跨越 ffmpeg**：

            短事务读 filepath → 关连接 → 跑 ffmpeg → 短事务写 thumbnail

        为什么必须这样：一个 SELECT 会让 session 持有 videos 表的
        ACCESS SHARE 锁，直到事务结束。原来把 generate_thumbnail（0.3-2 秒，
        长视频更久）夹在 SELECT 和 commit 之间，4 个线程就是 4 个
        `idle in transaction` 一直压着 videos 表 ——
        `ALTER TABLE videos ADD COLUMN` 直接堵死，后端起不来。
        这个故障实际发生过：迁移卡了 12 分钟，healthcheck 一直失败，整站 502。
        """
        try:
            # ① 短事务：只取需要的字段
            db = SessionLocal()
            try:
                row = (
                    db.query(Video.filepath, Video.thumbnail)
                    .filter(Video.id == video_id)
                    .first()
                )
                if row is None:
                    return
                # 再查一次：可能在排队期间已经被别人生成好了
                if row.thumbnail:
                    return
                filepath = row.filepath
            finally:
                db.close()

            # ② 无事务的耗时操作
            # DB 里存的是容器化之前的 Windows 绝对路径（D://ITJC//...），
            # 容器里视频挂在 /videos，直接喂原路径必然 FileNotFoundError。
            # resolve_media_path 按 PATH_MAP 做前缀替换。
            path = str(resolve_media_path(filepath))
            result = generate_thumbnail(path, video_id)

            if not result:
                with self._lock:
                    self._stats.failed += 1
                attempts = _record_failure(video_id)
                if attempts is not None and attempts >= MAX_THUMBNAIL_ATTEMPTS:
                    # 明确说「放弃了」，否则运维会一直等这张图
                    logger.error(
                        "缩略图放弃：video_id=%s 已失败 %s 次，不再自动重试（可走 admin retry）",
                        video_id, attempts,
                    )
                else:
                    logger.warning(
                        "缩略图生成失败：video_id=%s 第 %s 次 path=%s",
                        video_id, attempts, path,
                    )
                return

            # ③ 短事务：写回。用 Core UPDATE，不加载整个对象
            db = SessionLocal()
            try:
                db.query(Video).filter(Video.id == video_id).update(
                    {
                        "thumbnail": result,
                        # 成功后清零：之前失败过又成功了，不该继续记着
                        "thumbnail_attempts": 0,
                        "thumbnail_failed_at": None,
                    },
                    synchronize_session=False,
                )
                db.commit()
            finally:
                db.close()

            with self._lock:
                self._stats.succeeded += 1
        except Exception as exc:  # noqa: BLE001
            with self._lock:
                self._stats.failed += 1
                self._stats.last_error = f"video_id={video_id}: {exc}"
            attempts = _record_failure(video_id)
            logger.exception("缩略图生成异常：video_id=%s 第 %s 次", video_id, attempts)
        finally:
            with self._lock:
                self._inflight.discard(video_id)


_worker: ThumbnailWorker | None = None
_worker_lock = threading.Lock()


def get_thumbnail_worker() -> ThumbnailWorker:
    """取进程级单例。第一次调用时创建。"""
    global _worker
    if _worker is None:
        with _worker_lock:
            if _worker is None:
                _worker = ThumbnailWorker()
    return _worker
