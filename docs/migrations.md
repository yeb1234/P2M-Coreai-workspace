# 数据库迁移机制

> 状态：事实已核实（核对基线 2026-11-20）

## 一、两套机制并存（2026-11-16 现状，不是「已全部迁完」）

PostgreSQL 上同时存在两套结构管理机制，启动时按顺序都跑：

| 机制 | 位置 | 管什么 | 依据 |
|---|---|---|---|
| **Alembic 版本链** | `backend/alembic/`（`env.py`、`versions/`） | 版本化的结构变更，有记录、可回滚；管 `Base.metadata` 下的 ORM 表 | `backend/alembic/env.py:62,123-132`；`backend/app/database.py:384-431` |
| **运行时补齐** | `backend/app/migrations.py` 的 `upgrade_postgres(engine)` | `create_all` 补缺表、幂等补索引/列、pgvector 扩展、`content_chunks` DDL；按当前运行配置补齐 | `backend/app/migrations.py:84-210`；`backend/app/database.py:453-458` |

不要写成「结构已经全部由 Alembic 管理」或「旧迁移脚本可以删掉」。两套都在，分工见第三节。

### Alembic 版本链

| Revision | 文件 | 说明 |
|---|---|---|
| `ed9ec716c9b0` | `versions/2026_11_16_1356-ed9ec716c9b0_baseline.py` | baseline：首次引入 Alembic 时对空库建全部结构 |
| `f2f5d8064921` | `versions/2026_11_16_1358-f2f5d8064921_notes_indexes_parity.py` | 补 `notes` 上模型声明了索引、老库缺的两个索引；`down_revision = ed9ec716c9b0`，对新库是无操作 |

baseline revision 写死在 `database.py:381`（`BASELINE_REVISION`），发布后凝固。

### 运行时补齐（migrations.py）

- `upgrade_postgres`：先 `CREATE EXTENSION IF NOT EXISTS vector / pg_trgm`，再 `Base.metadata.create_all`，然后逐条 `CREATE INDEX IF NOT EXISTS` 与幂等补列，最后建 `content_chunks`（`migrations.py:89-92,110-202`）。
- `upgrade_sqlite_legacy`：SQLite 路径的最小结构，不跑 Alembic（`migrations.py:212`；`database.py:461-463`）。

## 二、启动链路

容器入口等库可连后跑 `ensure_runtime_schema()`（`backend/docker-entrypoint.sh:40-41`）：

```
ensure_runtime_schema()
  ├─ PostgreSQL:
  │    1. _run_alembic_migrations()   # upgrade head（老库先 stamp baseline）
  │    2. upgrade_postgres(engine)    # create_all + 幂等补索引/列 + content_chunks DDL
  └─ SQLite:
       upgrade_sqlite_legacy(engine)  # 最小结构，Alembic DDL 有 PG 专有语法，跑不了
```

依据：`backend/app/database.py:437-463`。

`_run_alembic_migrations()` 对三种库状态分别处理（`database.py:387-391`）：

| 库状态 | 动作 |
|---|---|
| 空库 | `upgrade head`（baseline 建全部表） |
| 有表、无 `alembic_version`（老部署） | 先 `stamp` 到 baseline，再 `upgrade head` |
| 有 `alembic_version` | 直接 `upgrade head` |

迁移失败不抛异常阻断启动，但会大声记日志；结构可能不是最新，需要事后排查（`database.py:433-434`）。

## 三、为什么两套都留着

1. **`create_all` 只补缺表**：表已存在就整张跳过，包括这张表上后加的索引和列。老库因此会和新库结构不一致，这类漂移正是引入 Alembic 要解决的。
2. **`content_chunks` 挂在独立 `pgvector_metadata` 上**，不在 `Base.metadata` 里：halfvec 类型在 SQLite 上无法编译，挂进 Base 会让 `create_all` 直接抛 `CompileError`。它的 DDL 由 `tables.py:content_chunks_ddl()` 按运行时 `embedding_dim` 拼 `halfvec(N)`，Alembic 看不到这张表（`backend/alembic/env.py:17-25`；`backend/app/tables.py:35-82`）。
3. **维度要能重放**：迁移文件里必须写死维度；运行时配置的维度由 `upgrade_postgres` 兜底对齐。

分工一句话：**Alembic 管版本记录，`upgrade_postgres` 管「按当前配置补齐」**（`database.py:444-449`）。

## 四、SQLite 口径

- SQLite 用于本地测试 / 轻量部署；Alembic 在线上跳过时会打印原因（`alembic/env.py:96-98`）。
- SQLite 结构由 `upgrade_sqlite_legacy` 直接建，不走版本链。
- 新增 `content_chunks` 的列/索引时，改 `tables.py`，不要指望 autogenerate 检测到。

## 五、常用命令

在 `backend/` 目录下（`alembic.ini` 在 `backend/`）：

```bash
alembic current          # 当前 revision
alembic history          # 版本链
alembic upgrade head     # 升到 head
```

临时连别的库：`alembic -x db_url=postgresql+psycopg://... upgrade head`（`alembic/env.py:13-15,65-73`）。

- 数据库地址从 `app.database.settings` 读，不写在 `alembic.ini` 里，避免 `.env` 改了还连旧库（`env.py:3-11`）。
- 连接时设 `lock_timeout = '20s'`：DDL 拿排他锁，长事务会让迁移无限等待，20 秒跨不过去直接报错，比无声卡死好诊断（`env.py:110-121`）。

## 六、模型对齐口径

- `models.py` 共 34 个 ORM 模型，挂在 `Base.metadata`（`backend/app/models.py`，`__tablename__` 计数 34）。
- `content_chunks` 不在此映射内，见第三节。
- 旧文档里「49 个索引」「262 列、82 个索引完全一致」等列/索引计数，是 2026-11-16 首次引入 baseline 时的实测数字，本次未对当前库复核；需要精确数字时在库内 `information_schema` 现查。

## 待用户确认

- 老库 stamp baseline 是引入 Alembic 时的一次性过渡；线上是否还存在无 `alembic_version` 的老库、是否需要保留这条过渡分支，未在本次核实。
