"""SQLite -> PostgreSQL 业务数据迁移。

设计要点：
- 只读打开 SQLite，绝不写入源库，保证可回滚
- 用 PostgreSQL COPY 协议灌数据，359 万字幕片段约 1-2 分钟（逐条 INSERT 要数小时）
- 列取两边交集，SQLite 后续新增的列不会导致迁移中断
- 默认跳过非空目标表；--force 先 TRUNCATE 再重灌
- 迁移结束后重置自增序列，避免新插入撞主键

用法：
    python scripts/migrate_sqlite_to_pg.py --dry-run
    python scripts/migrate_sqlite_to_pg.py
    python scripts/migrate_sqlite_to_pg.py --force --only videos,subtitle_segments
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import psycopg
from psycopg import sql

# 迁移顺序遵循外键依赖：被引用表在前
TABLE_ORDER = [
    "users",
    "categories",
    "videos",
    "watch_history",
    "ai_jobs",
    "app_settings",
    "notes",
    "subtitle_segments",
    "chat_sessions",
    "chat_messages",
    "user_data",
    "schedule_items",
    "calendar_events",
]

# 需要重置序列的表（字符串主键的表不需要）
SERIAL_TABLES = [
    "users",
    "categories",
    "videos",
    "watch_history",
    "notes",
    "subtitle_segments",
    "user_data",
]

# 无 id 列的表 -> 其业务主键
PRIMARY_KEYS = {"app_settings": "key"}

DATETIME_COLUMNS = {
    "created_at",
    "updated_at",
    "watched_at",
    "favorited_at",
    "started_at",
    "completed_at",
    "deleted_at",
    "reminder_at",
    "start_at",
    "due_at",
    "expires_at",
    "last_hit_at",
    "occurred_at",
    "computed_at",
    "last_active_at",
}


def parse_datetime(value):
    """SQLite 的时间可能是 str / datetime / None，统一成 datetime 或 None。"""
    if value is None or isinstance(value, datetime):
        return value
    text = str(value).strip()
    if not text:
        return None
    for fmt in (
        "%Y-%m-%d %H:%M:%S.%f",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S.%f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d",
    ):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def sqlite_columns(conn: sqlite3.Connection, table: str) -> list[str]:
    return [row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()]


def pg_columns(pg_conn, table: str) -> list[str]:
    rows = pg_conn.execute(
        """
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s
        ORDER BY ordinal_position
        """,
        (table,),
    ).fetchall()
    return [row[0] for row in rows]


def coerce(value, column: str, pg_type: str):
    if value is None:
        return None
    if column in DATETIME_COLUMNS:
        return parse_datetime(value)
    if pg_type in ("boolean",):
        if isinstance(value, str):
            return value.strip().lower() in ("1", "true", "t", "yes")
        return bool(value)
    if pg_type in ("integer", "bigint", "smallint"):
        try:
            return int(value)
        except (TypeError, ValueError):
            return None
    if pg_type in ("double precision", "real", "numeric"):
        try:
            return float(value)
        except (TypeError, ValueError):
            return None
    if pg_type in ("jsonb", "json"):
        # SQLite 里 json 列是 TEXT，COPY 需要合法 JSON 文本，原样传递即可
        if isinstance(value, (bytes, bytearray)):
            return value.decode("utf-8", "replace")
        return value
    if isinstance(value, (bytes, bytearray)):
        return value.decode("utf-8", "replace")
    return value


def column_types(pg_conn, table: str) -> dict[str, str]:
    rows = pg_conn.execute(
        """
        SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s
        """,
        (table,),
    ).fetchall()
    return {row[0]: row[1] for row in rows}


def migrate_table(
    sqlite_conn: sqlite3.Connection,
    pg_conn,
    table: str,
    *,
    force: bool,
    batch_log: int = 500_000,
) -> dict:
    s_cols = sqlite_columns(sqlite_conn, table)
    p_cols = pg_columns(pg_conn, table)
    if not s_cols or not p_cols:
        return {"table": table, "skipped": "表不存在"}

    # 两边都有的列才迁移；id 一定包含
    shared = [c for c in s_cols if c in p_cols]
    pk = "id" if "id" in shared else PRIMARY_KEYS.get(table)
    if not pk or pk not in shared:
        return {"table": table, "skipped": "找不到主键列"}

    total = sqlite_conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
    existing = pg_conn.execute(sql.SQL("SELECT count(*) FROM {}").format(sql.Identifier(table))).fetchone()[0]

    if existing and not force:
        return {"table": table, "skipped": f"目标已有 {existing} 行", "source_rows": total}
    if not total:
        return {"table": table, "skipped": "源表为空"}

    if force and existing:
        pg_conn.execute(sql.SQL("TRUNCATE TABLE {} CASCADE").format(sql.Identifier(table)))
        pg_conn.commit()

    types = column_types(pg_conn, table)
    select_sql = "SELECT " + ", ".join(f'"{c}"' for c in shared) + f' FROM "{table}"'
    copy_sql = sql.SQL("COPY {} ({}) FROM STDIN").format(
        sql.Identifier(table),
        sql.SQL(", ").join(sql.Identifier(c) for c in shared),
    )

    started = time.time()
    written = 0
    next_log = batch_log

    cursor = sqlite_conn.execute(select_sql)
    with pg_conn.cursor().copy(copy_sql) as copy:
        while True:
            rows = cursor.fetchmany(20_000)
            if not rows:
                break
            for row in rows:
                copy.write_row(
                    tuple(coerce(value, col, types.get(col, "")) for col, value in zip(shared, row))
                )
                written += 1
            if written >= next_log:
                elapsed = time.time() - started
                print(
                    f"    {table}: {written:,}/{total:,} "
                    f"({written / max(elapsed, 0.001):,.0f} 行/秒)",
                    flush=True,
                )
                next_log += batch_log

    pg_conn.commit()
    elapsed = time.time() - started
    return {
        "table": table,
        "rows": written,
        "seconds": round(elapsed, 1),
        "rate": round(written / max(elapsed, 0.001)),
        "columns": len(shared),
    }


def reset_sequences(pg_conn) -> None:
    """把自增序列推到 max(id)，否则新插入会撞主键。"""
    for table in SERIAL_TABLES:
        try:
            pg_conn.execute(
                sql.SQL(
                    """
                    SELECT setval(
                        pg_get_serial_sequence({tbl_lit}, 'id'),
                        GREATEST((SELECT COALESCE(max(id), 0) FROM {tbl}), 1)
                    )
                    """
                ).format(tbl_lit=sql.Literal(table), tbl=sql.Identifier(table))
            )
            pg_conn.commit()
        except Exception as exc:  # 序列不存在时跳过
            pg_conn.rollback()
            print(f"    序列重置跳过 {table}: {exc}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--sqlite",
        default=str(Path(__file__).resolve().parents[2] / ".migration" / "learning_os.db"),
    )
    parser.add_argument("--pg-dsn", default="")
    parser.add_argument("--force", action="store_true", help="清空目标表后重灌")
    parser.add_argument("--only", default="", help="逗号分隔的表名")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    dsn = args.pg_dsn or os.environ.get("DATABASE_URL", "")
    if not dsn:
        print("缺少 DATABASE_URL 或 --pg-dsn", file=sys.stderr)
        return 2
    dsn = dsn.replace("postgresql+psycopg://", "postgresql://")

    tables = (
        [t.strip() for t in args.only.split(",") if t.strip()] if args.only else TABLE_ORDER
    )

    print(f"源库 {args.sqlite}")
    print(f"目标 {dsn.split('@')[-1]}")
    print(f"表   {', '.join(tables)}")

    if args.dry_run:
        conn = sqlite3.connect(f"file:{args.sqlite}?mode=ro", uri=True, timeout=60)
        for table in tables:
            try:
                n = conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
                print(f"  {table}: {n:,}")
            except Exception as exc:
                print(f"  {table}: 读取失败 {exc}")
        conn.close()
        return 0

    sqlite_conn = sqlite3.connect(f"file:{args.sqlite}?mode=ro", uri=True, timeout=120)
    sqlite_conn.execute("PRAGMA busy_timeout=120000")

    results = []
    with psycopg.connect(dsn, autocommit=False) as pg_conn:
        pg_conn.execute("SET statement_timeout = 0")
        pg_conn.execute("SET synchronous_commit = off")  # 迁移期提速，结束后恢复
        for table in tables:
            print(f"  -> {table}")
            try:
                results.append(migrate_table(sqlite_conn, pg_conn, table, force=args.force))
            except Exception as exc:
                pg_conn.rollback()
                print(f"     失败: {exc}", file=sys.stderr)
                results.append({"table": table, "error": str(exc)})
        reset_sequences(pg_conn)
        pg_conn.execute("SET synchronous_commit = on")
        pg_conn.commit()

    sqlite_conn.close()

    print("\n迁移结果")
    for item in results:
        if "error" in item:
            print(f"  {item['table']:22s} 失败 {item['error'][:80]}")
        elif "skipped" in item:
            print(f"  {item['table']:22s} 跳过 ({item['skipped']})")
        else:
            print(
                f"  {item['table']:22s} {item['rows']:>9,} 行  "
                f"{item['seconds']:>6.1f}s  {item['rate']:>7,} 行/秒"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
