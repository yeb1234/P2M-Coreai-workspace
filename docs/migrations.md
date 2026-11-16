# 数据库迁移（Alembic）

引入于 2026-11-16。之前只有 `app/migrations.py` 的手写迁移。

---

## 一、为什么从"手写 ALTER"换成 Alembic

原来那套是 `create_all` + 一长串 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`，
装在 `app/migrations.py` 里，每次启动跑一遍。

**优点**（要保住，不能丢）：幂等，启动自动跑，不会出现"忘记执行 upgrade"。

**缺点**（这次要解决的）：

1. **没有版本记录**。线上库到底是第几版结构，只能靠人回忆。
2. **`create_all` 只建缺失的表，不给已有的表补索引**。
   实际后果：`models.Note` 声明了 `scope`/`user_id` 的 `index=True`，
   新库有索引，老库没有 —— 同一份代码两种行为，`ensure_video_note`
   在老库上全表扫。
3. **改类型、删列、加约束兜不住**。`IF NOT EXISTS` 只能"加"。
4. **不可回滚**。

第 2 条是这次真正踩到的坑，也是引入 Alembic 的直接理由。

---

## 二、现在的分工

```
app/database.ensure_runtime_schema()
  ├─ 1. alembic upgrade head        ← 版本化的结构变更（21 张 ORM 表）
  └─ 2. migrations.upgrade_postgres ← 兼容兜底
         ├─ Base.metadata.create_all()    建缺失的表
         ├─ 幂等 ALTER（加列）
         └─ content_chunks_ddl(dim)       pgvector 表，维度要运行时拼
```

**为什么第 2 步还留着**：`content_chunks` 的 `halfvec(N)` 维度来自
`settings.embedding_dim`，而迁移文件里的 DDL 必须**写死**（迁移要能重放
当时那一版结构，不能随配置变）。所以这张表仍由 `tables.py` 管。

`content_chunks` 是 Alembic 的**盲区**：autogenerate 看不到它。
要改这张表，改 `tables.py` 的 `content_chunks_ddl()`，**不要指望自动检测**。

---

## 三、日常怎么用

所有命令在 `backend/` 目录下执行。

### 改完 models.py 之后

```bash
cd backend

# 看看会生成什么（不写文件）
alembic revision --autogenerate -m "add xxx to videos" --sql
# 或者直接生成，然后人工检查
alembic revision --autogenerate -m "add xxx to videos"
```

**生成后一定要打开看。** autogenerate 会漏东西，也会多东西：

| 会漏 | 会多 |
|---|---|
| `content_chunks` 的任何变更 | 无意义的 server_default 抖动 |
| `gin_trgm_ops` / `hnsw` 这类索引 | 重复索引（同列不同名） |
| 数据迁移（回填、重命名） | — |

检查完再：

```bash
alembic upgrade head
```

### 看当前状态

```bash
alembic current          # 现在停在哪一版
alembic history --verbose
alembic heads
```

### 回滚

```bash
alembic downgrade -1     # 退一版
alembic downgrade base   # 全退（会删表，危险）
```

### 临时连别的库（比如验证 baseline）

```bash
alembic -x db_url="postgresql+psycopg://user:pass@host/db" upgrade head
# 或
ALEMBIC_DATABASE_URL="postgresql+psycopg://..." alembic upgrade head
```

连接地址**不写在 `alembic.ini` 里**，由 `alembic/env.py` 从
`app.database.settings` 读 —— 避免"改了 .env 但迁移连的还是旧库"。

---

## 四、老库是怎么过过来的

线上库当时有 21 张表，但没有 `alembic_version`。直接 `upgrade head`
会撞 `relation "agent_runs" already exists`。

启动时的 `_run_alembic_migrations()` 会自动判断：

| 库状态 | 动作 |
|---|---|
| 空库 | `upgrade head`，baseline 建全部表 |
| 有表、无 `alembic_version` | 先 `stamp <baseline>`，再 `upgrade head` |
| 有 `alembic_version` | 直接 `upgrade head` |

`stamp` 只是写一行版本记录，不动结构 —— 它的含义是
"结构已经等于 baseline 了，别重放建表语句"。

这一步是**一次性**的。之后所有库都有版本记录了。

---

## 五、当前迁移链

```
ed9ec716c9b0  baseline
  └─ 21 张 ORM 表 + 49 个索引
  └─ content_chunks（手工补，autogenerate 看不到）
  └─ 6 个业务索引（手工补，只写在旧 migrations.py 里）
  └─ pgvector / pg_trgm 扩展
      └─ f2f5d8064921  notes indexes parity
           补上 notes.scope / notes.user_id 两个索引
           （models 声明了，但老库 create_all 没补）
```

**baseline 是凝固的**。它里面的 DDL 不会因为 `models.py` 改动而变化。
不要 import `app.tables.content_chunks_ddl()` 到迁移里 —— 那会让历史迁移
随应用代码漂移，回滚到旧版本时得到错误的 schema。

要改结构，新建迁移。

---

## 六、验证 baseline 是否真的对

换过 baseline 或大改 models 后，值得跑一次：

```bash
# 1. 建一个空库
docker exec siteyeb-pg psql -U p2user -d postgres -c "CREATE DATABASE p2learning_check;"

# 2. 在上面跑全部迁移
cd backend
ALEMBIC_DATABASE_URL="postgresql+psycopg://p2user:<pw>@127.0.0.1:5432/p2learning_check" \
  alembic upgrade head

# 3. 对比列和索引（应该完全一致）
for db in p2learning p2learning_check; do
  docker exec siteyeb-pg psql -U p2user -d $db -t -A -c \
    "SELECT table_name||'.'||column_name||' '||data_type
     FROM information_schema.columns WHERE table_schema='public'
     AND table_name<>'alembic_version' ORDER BY 1" > /tmp/cols_$db.txt
done
diff /tmp/cols_p2learning.txt /tmp/cols_p2learning_check.txt

# 4. 清理
docker exec siteyeb-pg psql -U p2user -d postgres -c "DROP DATABASE p2learning_check;"
```

2026-11-16 首次引入时跑过：262 列、82 个索引**完全一致**。

---

## 七、几个坑

**① `alembic.ini` 必须纯 ASCII**

Alembic 用系统 locale 编码读 ini（Windows 上是 GBK）。
注释里写中文会直接 `UnicodeDecodeError`，而且报错位置在
`configparser`，很难联想到"注释是中文"。说明都放在 `env.py` 里。

**② 不要在 env.py 里用 `connection.execute("SET ...")`**

SQLAlchemy 2.0 的 `connection.execute()` 会**自动开启事务**，
Alembic 的 `context.begin_transaction()` 就退化成 savepoint，
最外层退出时整体回滚 —— 表现为 `stamp` 显示成功、
`alembic_version` 却没建出来。

用 `exec_driver_sql()` + 显式 `commit()`。

**③ SQLite 会跳过迁移**

`env.py` 检测到 `sqlite://` 直接返回。Alembic 的 DDL 里有 PG 专有语法
（JSONB、`USING hnsw`、部分索引），SQLite 跑不了。
SQLite 路径继续走 `create_all` —— 那条路只用于本地跑测试。
