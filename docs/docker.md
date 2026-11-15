# Docker 部署

三种跑法，按场景选：

| 场景 | 命令 | 起哪些服务 |
| --- | --- | --- |
| 全栈一键部署 | `docker compose up -d --build` | postgres + redis + backend + frontend |
| 本地开发（后端跑 venv） | `docker compose -f docker-compose.pg.yml up -d` | 只有 postgres |
| GPU 转写 | `docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build` | 全栈 + 容器内 CUDA |

---

## 快速开始

```bash
cp .env.example .env
# 必填：POSTGRES_PASSWORD、JWT_SECRET（>= 32 字符）、EXTERNAL_LLM_API_KEY
# 按需改：VIDEO_HOST_PATH（默认 D:/ITJC）、WEB_PORT（默认 80）

docker compose up -d --build
open http://localhost
```

首次启动会：
1. 起 pgvector 容器并等它 healthy
2. backend 入口脚本等库可连 → 建表建索引 → 起 uvicorn
3. frontend 等 backend healthy 后起 nginx

---

## 服务与端口

| 服务 | 容器名 | 内网端口 | 对外端口 |
| --- | --- | --- | --- |
| postgres | siteyeb-pg | 5432 | `${POSTGRES_PORT:-5432}` |
| redis | siteyeb-redis | 6379 | `${REDIS_PORT:-6379}` |
| backend | siteyeb-backend | 8000 | 不暴露，仅内网 |
| frontend | siteyeb-frontend | 80 | `${WEB_PORT:-80}` |

backend 不对外暴露是有意的：所有流量从 nginx 进，SSE、静态资源、CORS 都在一层里解决。

### 数据卷

| 卷 | 内容 |
| --- | --- |
| `siteyeb-pgdata` | PostgreSQL 数据（含向量） |
| `siteyeb-redis` | RQ 队列与缓存（AOF 持久化） |
| `siteyeb-output` | 字幕、Markdown 笔记 |
| `siteyeb-thumbnails` / `siteyeb-sprites` | 缩略图与雪碧图 |
| `siteyeb-work` | 转写临时文件 |

视频库用绑定挂载 **只读**：`${VIDEO_HOST_PATH}:/videos:ro`。容器不会改你的视频文件。

---

## 关键设计

### 容器内访问宿主机模型服务

`localhost` 在容器里指容器自己。LM Studio / Ollama 跑在宿主机时，必须用 `host.docker.internal`：

```yaml
EMBEDDING_BASE_URL: http://host.docker.internal:1234/v1
OLLAMA_BASE_URL: http://host.docker.internal:11434
```

compose 里已通过 `extra_hosts: host.docker.internal:host-gateway` 声明，Linux 下也能解析。

**注意**：LM Studio 需要开启「Serve on Local Network」，否则只监听 127.0.0.1，容器连不上。

### 路径映射（容器化最容易踩的坑）

数据库里的 `videos.filepath` 是**容器化之前写入的宿主机绝对路径**：

```
D:\ITJC\Python\day01\01-环境搭建.mp4
```

容器里视频挂在 `/videos`，拿原路径必然 `FileNotFoundError`。所以在 `utils/files.py` 加了一层
`resolve_media_path()`：先试原路径，不存在就按 `PATH_MAP` 做前缀替换。

```yaml
PATH_MAP: "D:/ITJC/thumbnails=/data/thumbnails;D:/ITJC/sprites=/data/sprites;D:/ITJC/output=/data/output;D:/ITJC/work=/data/work;D:/ITJC=/videos"
```

要点：
- **最长前缀优先**，所以 `/thumbnails` 这类更具体的规则必须排在 `/videos` 前面
- 本地 venv 跑法不受影响（原路径存在就直接返回）
- 没配 `PATH_MAP` 时行为与改造前一致

配套地，`thumbnails/sprites/output/work` 都改为**绑定宿主机目录**而不是命名卷——否则容器里看到的是空目录，
1.4 万个视频的缩略图得从头重新生成。

与此相关的一个副作用值得记一笔：`get_thumbnail` 原本的逻辑是「文件不存在就把数据库里的 `thumbnail` 置空」。
在容器路径没配好时，一次请求就会把好数据洗掉。现在会先判断路径是否属于「另一个平台」
（Linux 里遇到 `D:\...`），命中就只报 404 并打警告，不动数据。

### 流式对话必须关缓冲

nginx 默认会缓冲响应，SSE 的 token 会被攒成一整块才发给浏览器，看起来像"卡了很久然后一次性出现"。

`nginx.conf` 里对 `/api/assistant/chat/stream` 单独配了：

```nginx
proxy_buffering off;
proxy_cache off;
proxy_read_timeout 3600s;
```

后端也会发 `X-Accel-Buffering: no` 作为双保险。

### 非 root 运行

容器内用 `appuser`（uid 1000）跑服务，所以后端监听 **8000** 而不是 80——Linux 下非 root 无法绑定 1024 以下端口，由 nginx 和 compose 做映射。

### 健康检查链路

```
postgres(healthy) ─┐
                   ├─→ backend(healthy) ─→ frontend(健康检查)
redis(healthy)  ───┘
```

`depends_on: condition: service_healthy` 确保后启动的服务前面已经真的可用，而不只是"容器起来了"。

backend 的 `/health` 会返回 PostgreSQL 版本、pgvector 版本、向量条数，可以直接用来看状态：

```bash
curl localhost/health
```

---

## 从 SQLite 迁移数据

旧库不进镜像，用只读挂载：

```bash
mkdir -p .migration
cp /path/to/learning_os.db .migration/

# .env 里设
MIGRATE_SQLITE=true
SQLITE_SOURCE_DIR=./.migration

docker compose up -d --build backend
```

入口脚本会检测 `/data/source/learning_os.db` 并执行迁移。迁移是**幂等**的：目标表非空会跳过，不会重复灌数据。

手动跑：

```bash
docker compose exec backend python scripts/migrate_sqlite_to_pg.py \
  --sqlite /data/source/learning_os.db
```

### 向量回填

首次迁移只带业务数据，向量需要重建（旧的 319 万条已验证为无效数据）。全量约 6 小时：

```bash
# 方式一：入口脚本后台跑
BACKFILL_EMBEDDINGS=true docker compose up -d backend

# 方式二：手动进容器跑（可断点续跑）
docker compose exec backend python scripts/backfill_embeddings.py --all --batch-size 256
```

进度看 `/tmp/backfill.log` 或 `curl localhost/api/search/stats`。

---

## GPU 转写

默认镜像**不含 CUDA**（省 2-3GB），转写走 CPU int8，功能正常但慢。

要 GPU：

```bash
# 先确认宿主机能用 GPU
docker run --rm --gpus all nvidia/cuda:12.4.0-base-ubuntu22.04 nvidia-smi

docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build
```

`docker-compose.gpu.yml` 会做三件事：装 CUDA 包、设 `DEVICE_TYPE=cuda`、申请 GPU 设备。

---

## 常见问题

**Q: `docker pull` 卡住或报 `dial tcp ...:443 connectex: A connection attempt failed`**
这台机器直连 Docker Hub 不通，所有基础镜像都走了 `docker.m.daocloud.io` 镜像源（`Dockerfile` 与 compose 里已写死）。
新增镜像时记得同样加前缀，例如 `docker.m.daocloud.io/library/redis:7-alpine`。

**Q: 启动报 `POSTGRES_PASSWORD 必须在 .env 中设置`**
compose 用了 `${VAR:?err}` 语法强制校验。填 `.env` 里的 `POSTGRES_PASSWORD`。

**Q: 80 端口被占用**
改 `.env` 的 `WEB_PORT=8080`，然后 `docker compose up -d`。Windows 上 80 常被 IIS 或其它服务占。

**Q: 前端能打开但接口全 502**
backend 还没 healthy。`docker compose ps` 看状态，`docker compose logs backend` 看入口脚本卡在哪（通常是等数据库）。

**Q: 检索报"语义检索不可用，已降级为纯词法"**
embedding 服务连不上。检查 LM Studio 是否在跑、是否开了局域网访问、`EMBEDDING_BASE_URL` 是否用 `host.docker.internal`。

**Q: 容器时区不对**
镜像里已设 `TZ=Asia/Shanghai` 并链接了 localtime。若仍不对，检查 `.env` 是否覆盖了 `TZ`。

**Q: 重建镜像后数据还在吗**
在。数据在命名卷里，`docker compose down` 不会删卷。彻底清空要 `docker compose down -v`（会删数据，慎用）。

---

## 与本地 venv 开发模式的区别

| | Docker | 本地 venv |
| --- | --- | --- |
| 数据库 | 容器内 postgres:5432 | 宿主机 localhost:5432（同一个容器） |
| 后端地址 | backend:8000（内网） | 127.0.0.1:8100（注意别用 8000，被 Docker 占） |
| 前端 | nginx 托管 dist，同源代理 | vite dev server，需 `VITE_API_BASE_URL` |
| 依赖变更 | 要 rebuild | 直接 pip install |
| 代码变更 | 要 rebuild（未挂载源码） | 热重载 |

日常改代码建议还是用本地 venv；Docker 用于部署和交付给别人。

> 想让 Docker 也支持热重载，可以加一个 `docker-compose.dev.yml` 把 `./backend:/app` 挂进去 +
> `uvicorn --reload`。当前没做，因为 Windows 下挂载源码会让文件监听变得很慢。
