# 怎么把服务跑起来

> 这份文档回答两个问题：**为什么启动方式和以前不一样了**，以及
> **不用 AI 助手时到底要开哪几个容器**。

---

## 一、为什么 `start.bat` 变了

以前的启动脚本是：

```bat
backend\  .venv311\python -m uvicorn app.main:app --port 80
根目录\    npm run dev          :: 前端 dev server，端口 5002
```

两个进程，跑在 Windows 本机上。

现在这条路走不通了，不是因为"改成 Docker 更时髦"，而是有三件硬依赖：

| 依赖 | 为什么不能在本机跑 |
|---|---|
| **pgvector** | `content_chunks.embedding` 是 `halfvec(1024)`，需要 PostgreSQL 装了 vector 扩展。本机 PG 没装就建不出这张表，检索直接不可用 |
| **Redis** | RQ 队列的存储。转写任务、向量化任务都靠它排队 |
| **ffmpeg** | 抽缩略图、雪碧图、转码音频。容器镜像里带好了，本机要自己装 |

所以现在是 **5 个容器**，由 `docker-compose.yml` 编排。

---

## 二、服务清单：哪个是必须的

| 容器 | 端口 | 作用 | 不用 AI 助手时 |
|---|---|---|---|
| `siteyeb-pg` | 127.0.0.1:5432 | PostgreSQL + pgvector | **必须** |
| `siteyeb-backend` | 内部 8000 | FastAPI：所有 API、缩略图生成、文件监听 | **必须** |
| `siteyeb-frontend` | 80 | nginx：静态页面 + 反向代理到 backend | **必须** |
| `siteyeb-redis` | 127.0.0.1:6379 | RQ 队列 | 可不起，但见下方说明 |
| `siteyeb-worker` | — | RQ worker：转写、建块、向量化 | **可以不起** |

访问入口只有一个：**http://localhost**（80 端口）。
`backend` 和 `worker` 都不对外暴露端口，全部经 nginx 转发。

### 关于 Redis 的一个说明

严格来说，不用 AI 助手时 Redis 也不需要。但 `docker-compose.yml` 里
`backend` 声明了 `depends_on: redis (service_healthy)` —— 少了它后端起不来。

Redis 只占几 MB 内存，所以启动脚本的做法是**照常起 Redis，只是不起 worker**。
这样既是最小组合，又不用改 compose 的依赖关系。

### 不起 worker 会怎样

| 功能 | 还行吗 |
|---|---|
| 浏览视频、播放、字幕 | ✅ 正常 |
| 搜索（词法 + 语义） | ✅ 正常（向量已经在库里，共 60,422 块） |
| 笔记、待办、日历、番茄钟 | ✅ 正常 |
| 学习路径查看 | ✅ 正常 |
| **发起新的 AI 转写** | ❌ 任务会进队列，但没人消费 |
| **生成新的学习路径** | ⚠️ 走的是 backend 内部线程，不依赖 worker，仍可用 |
| **新视频的建块 + 向量化** | ❌ 同上，卡在队列里 |

需要这些时，用 `[1] 完整启动` 或单独 `docker compose start worker`。

---

## 三、三种启动方式

### 方式 A：双击 `start.bat`（Windows，推荐）

菜单选 `[1]` 或 `[2]`：

```
[1] Full stack      db + redis + backend + worker + web   ← 要 AI 功能选这个
[2] Web only        db + redis + backend + web            ← 只用页面选这个
```

脚本会等后端 healthy 再打开浏览器。

### 方式 B：命令行（WSL / macOS / Linux）

```bash
./start.sh            # 完整（含 worker）
./start.sh web        # 只要页面，不起 worker
./start.sh status     # 看容器状态 + 探针
./start.sh logs       # 跟后端日志
./start.sh stop       # 全停（数据卷保留）
```

### 方式 C：直接 compose（最透明）

```bash
# 完整
docker compose up -d

# 只要页面（不起 worker）
docker compose up -d postgres redis backend frontend

# 只重启后端
docker compose up -d --build backend worker

# 全停
docker compose down
```

---

## 四、起完之后检查什么

```bash
# 三个都应该 200
curl -i http://localhost/health
curl -i http://localhost/ready
curl -i http://localhost/api/videos
```

`/health` 会返回事务健康度（长事务数、锁等待），`/ready` 会返回
数据库、向量覆盖率、embedding 服务、LLM 四项检查。

**`/ready` 返回 503 不代表站点坏了**，看 `checks` 里哪一项 fail：

| fail 项 | 含义 | 影响 |
|---|---|---|
| `embedding_model` | 宿主机 LM Studio 没启动，或端口不对 | 语义检索退化为纯词法；新内容无法向量化 |
| `llm` | 外部 LLM 不可达 | AI 对话不可用，其他正常 |
| `vectors` | 向量覆盖率低 | 检索召回不全 |

embedding 服务的地址在 `.env`：

```bash
EMBEDDING_BASE_URL=http://localhost:1234/v1              # 宿主机直接跑时
EMBEDDING_BASE_URL_DOCKER=http://host.docker.internal:1235/v1   # 容器里访问宿主机
```

**这两个端口不一样是正常的**：一个是本机开发用，一个是容器内访问宿主机
（`host.docker.internal` 映射到宿主）。如果 LM Studio 只在 1234 监听，
把 `_DOCKER` 那个也改成 1234。

---

## 五、常见故障

| 现象 | 原因 | 怎么看 |
|---|---|---|
| 整站 502 | nginx 连不上 backend | `docker compose ps` 看 backend 是否 healthy；`./start.sh logs` |
| 容器 Up 但 unhealthy | 迁移卡在锁上 | `bash scripts/diagnose.sh`（第 3 段看锁等待） |
| 页面能开但接口 500 | 后端异常 | `bash scripts/logq.sh errors --since 1h` |
| 索引/缩略图不动 | worker 没起 | `docker compose ps`；`curl localhost/ready` 看队列 |

排障入口只有一个：

```bash
bash scripts/diagnose.sh
```

只读，一次打出容器状态、探针历史、PG 锁等待、worker 注册、nginx 错误。

---

## 六、数据在哪

| 卷 / 目录 | 内容 | 删了会怎样 |
|---|---|---|
| `siteyeb-pgdata`（卷） | 全部业务数据 | 全丢 |
| `siteyeb-redis`（卷） | 队列与缓存 | 队列丢，数据不丢 |
| `D:/ITJC/videos`（挂载） | 视频原文件 | 视频丢 |
| `D:/ITJC/output`（挂载） | 字幕、笔记 md、转写产物 | 需重新转写 |
| `D:/ITJC/work`（挂载） | 临时文件、私有笔记 | 私有笔记需重建 |
| `./logs`（挂载） | 应用日志 JSONL | 只丢日志 |

`docker compose down` **不会**删卷。要清空数据得显式 `down -v`。
