"""Alembic 运行环境。

## 数据库地址从哪来

**不写在 alembic.ini 里**，而是从 `app.database.settings.database_url` 读，
理由：

1. 只有一处配置源。写进 ini 之后，改 .env 不会生效，而 alembic 会连着
   一个「看起来对、其实是旧的」库跑迁移 —— 这种事故排查起来很贵。
2. 容器里的地址和宿主机不同（宿主机 localhost:5432，容器里 postgres:5432），
   硬编码必然有一边是错的。

需要临时连别的库（比如生成 baseline 时连一个空库），用：

    alembic -x db_url=postgresql+psycopg://... upgrade head

## 为什么 target_metadata 只有 Base.metadata

`content_chunks`（pgvector halfvec）挂在 `app.tables.pgvector_metadata` 上，
**故意不在这里**：halfvec 类型在 SQLite 上无法编译，挂进 Base.metadata 会让
`Base.metadata.create_all()` 直接抛 CompileError。那张表的 DDL 由
`app/tables.py` 的 content_chunks_ddl() 负责，Alembic 不碰。

这个取舍要记住：**加列删列改 content_chunks 时，改 tables.py，不要指望
autogenerate 检测到**。它看不到那张表。
"""

from __future__ import annotations

import os
import sys
from logging.config import fileConfig
from pathlib import Path

from sqlalchemy import engine_from_config, pool

from alembic import context

# 让 alembic 能 import app.*（从 backend/ 目录跑，也允许从仓库根跑）
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

config = context.config

# 日志由应用自己配（见 app/core/observability.py）。
#
# 这里**不能无条件调 fileConfig**：它会把 root 的 handler 全部清掉，
# 并按 disable_existing_loggers=True 关掉所有已存在的 logger。
# 而 alembic 是**在应用进程里**跑的（app/database.py 的 ensure_runtime_schema
# 会 command.upgrade），于是启动时那一行「日志落盘」写完之后，后面所有业务日志
# 全部静默丢弃 —— 不报错、不抛异常，比没有日志更难查。
#
# 命令行单独跑 alembic 时（没有应用配日志）才用 ini 里的 logging 配置，
# 那种场景由调用方不设 skip_logging_config 来区分。
if config.config_file_name is not None and not config.attributes.get("skip_logging_config"):
    fileConfig(config.config_file_name)

from app.database import Base, settings  # noqa: E402
from app import models  # noqa: E402,F401  确保所有表注册进 metadata

target_metadata = Base.metadata


def _database_url() -> str:
    """优先用 -x db_url=...，否则用应用配置。"""
    override = context.get_x_argument(as_dictionary=True).get("db_url")
    if override:
        return override
    env_override = os.getenv("ALEMBIC_DATABASE_URL")
    if env_override:
        return env_override
    return settings.database_url


def run_migrations_offline() -> None:
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    url = _database_url()

    # SQLite 上不跑迁移：本项目的 SQLite 路径是「本地跑测试 / 轻量部署」，
    # 结构由 create_all 直接建。Alembic 的 DDL 里有 PG 专有语法
    # （JSONB、部分索引、USING hnsw），在 SQLite 上必然失败。
    # 直接跳过并说明原因，好过抛一个看不懂的 CompileError。
    if url.startswith("sqlite"):
        print("[alembic] SQLite 环境跳过迁移（结构由 create_all 管理）")
        return

    section = config.get_section(config.config_ini_section, {}) or {}
    section["sqlalchemy.url"] = url

    connectable = engine_from_config(
        section,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        # DDL 要拿排他锁，会排在任何长事务后面。不给超时的话，
        # 一个把 ffmpeg 夹在 SELECT 和 commit 之间的线程就能让迁移
        # 无限等待 —— 上次就是这么卡了 12 分半，整站 502。
        # 20 秒跨不过去就直接报错，比无声卡死好诊断。
        #
        # 必须用 exec_driver_sql + 显式 commit：
        # SQLAlchemy 2.0 的 connection.execute() 会**自动开启事务**，
        # 那样 Alembic 的 context.begin_transaction() 只能退化成 savepoint，
        # 最外层退出时整体回滚 —— stamp 看起来成功、alembic_version 却没建出来。
        # SET 是会话级设置，提交后依然有效。
        connection.exec_driver_sql("SET lock_timeout = '20s'")
        connection.commit()

        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            # 类型变更也纳入 autogenerate —— 否则把 String 改成 Text、
            # 把 Integer 改成 BigInteger 这种事永远检测不到
            compare_type=True,
            compare_server_default=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
