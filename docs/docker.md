# Docker 部署组成

> 状态：事实已核实（核对基线 2026-11-16，`docker-compose.yml` 现状，未跑容器）

## 一、服务清单

compose 项目名 `p2-siteyeb`（`docker-compose.yml:9`）。主 compose 文件里**没有写 `container_name`**，容器名交给 compose 按 `<项目名>-<服务名>-1` 生成，例如 `p2-siteyeb-postgres-1`（`docker-compose.yml:30`）。文档和排查命令一律用服务名（`docker compose logs backend`），不要写死旧容器名 `siteyeb-*`。

| 服务 | 镜像 | 作用 | 健康检查 | 依据 |
|---|---|---|---|---|
| `postgres` | `pgvector/pgvector:pg17` | 业务库 + pgvector | `pg_isready` | `docker-compose.yml:28-29,78-83` |
| `redis` | `redis:7-alpine` | 队列、限流、配额计数 | `redis-cli ping` | `docker-compose.yml:85-86,110-112` |
| `backend` | `p2-siteyeb-backend:3.0` | FastAPI 应用，uvicorn 监听内网 8000 | `curl http://127.0.0.1:8000/health` | `docker-compose.yml:116,123,134-135`；`backend/Dockerfile:81-85` |
| `worker` | 复用 backend 镜像 | RQ 消费者，跑 `python -m app.worker` | 关闭（`healthcheck: disable: true`） | `docker-compose.yml:260-261,271,372-373` |
| `frontend` | `p2-siteyeb-frontend:3.0` | nginx 托管 `dist`，同源反代 `/api` | `wget --spider http://127.0.0.1/` | `docker-compose.yml:386,405-410`；`Dockerfile:32-45` |

## 二、端口

端口规则：`<服务前缀><两位项目号>`，固定五位；P2 尾号 02。123 前端 Web、124 后端 API、125 数据库、126 缓存/中间件（`docker-compose.yml:1-6`）。

| 宿主端口 | 映射目标 | 绑定 | 说明 | 依据 |
|---|---|---|---|---|
| `80` | `frontend:80` | `0.0.0.0` | 裸 localhost 入口 | `docker-compose.yml:407` |
| `12302` | `frontend:80` | `0.0.0.0` | Web 入口，`WEB_PORT` 默认 12302 | `docker-compose.yml:408`；`.env.example:95` |
| `12402` | `backend:8000` | **只绑 `127.0.0.1`** | API 常驻发布回环口：宿主调试、前端 dev 代理能连，公网扫不到；对外访问仍走 nginx `/api` | `docker-compose.yml:132-135`；`.env.example:96` |
| `11112` | — | — | **已作废（2026-11-16 起换号，后端 API 见 12402）**；`docker-compose.yml:3` 旧注释里那句「11112 API」是过期残留，勿照抄 | `docker-compose.yml:3,135` |
| `12322` | Vite dev | `127.0.0.1` | dev 端口 = 12302 + 20；代理打到 `127.0.0.1:12302`，不进容器 | `vite.config.ts:12,16`；`playwright.config.ts:12,17` |
| `12502` | `postgres:5432` | 只绑 `127.0.0.1` | `POSTGRES_PORT` 可覆盖 | `docker-compose.yml:75`；`.env.example:6` |
| `12602` | `redis:6379` | 只绑 `127.0.0.1` | `REDIS_PORT` 可覆盖 | `docker-compose.yml:107`；`.env.example:97` |
| 监控段 | — | — | **未分配**；旧 11162 已作废，不要编新号 | `docker-compose.yml:6` |

容器内部互访走 compose 内网：backend 地址 `backend:8000`（`nginx.conf:100`），Redis `redis:6379`（`docker-compose.yml:201`）。

CORS 允许来源：`http://localhost,http://localhost:12302,http://localhost:12322`（`.env.example:74`）。

> 覆盖文件同口径：`docker-compose.pg.yml:50` PG 默认 12502；`docker-compose.https.yml:17` frontend 回环 12302。

## 三、数据目录

命名卷（compose `volumes:` 段声明）：

| 卷名 | 用途 | 依据 |
|---|---|---|
| `siteyeb-pgdata` | PostgreSQL 数据目录 | `docker-compose.yml:77,416-417` |
| `siteyeb-redis` | Redis 持久化 | `docker-compose.yml:109,418-419` |

绑定挂载：

| 宿主路径 | 容器路径 | 用途 | 依据 |
|---|---|---|---|
| `${VIDEO_HOST_PATH:-./video-library}` | `/videos:ro` | 视频库只读 | `docker-compose.yml:225,360` |
| `${VIDEO_HOST_PATH:-./video-library}/thumbnails` | `/data/thumbnails` | 缩略图 | `docker-compose.yml:228,363` |
| `${VIDEO_HOST_PATH:-./video-library}/sprites` | `/data/sprites` | 雪碧图 | `docker-compose.yml:229,364` |
| `${VIDEO_HOST_PATH:-./video-library}/output` | `/data/output` | 抽轨音频、转写中间产物 | `docker-compose.yml:230,365` |
| `${VIDEO_HOST_PATH:-./video-library}/work` | `/data/work` | worker 临时目录 | `docker-compose.yml:231,366` |
| `./logs` | `/data/logs` | backend / worker 共享落盘目录，文件 `backend.jsonl`、`worker.jsonl` | `docker-compose.yml:234,370,153-154,289-290` |
| `./data/hf` | `/data/hf` | Whisper / HF 模型缓存，避免重建容器重下 | `docker-compose.yml:374,324` |
| `./.migration` | `/data/source:ro` | 首次从 SQLite 迁移时的旧库只读目录 | `docker-compose.yml:372,222` |

旧文档把 `siteyeb-output` / `siteyeb-thumbnails` / `siteyeb-sprites` / `siteyeb-work` 当成命名卷，实际它们是上面的绑定挂载；compose `volumes:` 段里只有两个数据库卷。

`VIDEO_HOST_PATH` 默认 `./video-library`，相对 `docker-compose.yml` 所在目录解析；容器内视频库固定为 `/videos`。当前 Windows 项目在 C 盘、素材在 D 盘时，项目内 `video-library` 用 junction 指向 `D:\ITJC`；完整路径口径和换机步骤见 [runtime-paths.md](runtime-paths.md)。

## 四、为什么不推荐本机直跑

应用依赖 PostgreSQL + pgvector 扩展、Redis、ffmpeg；这些在镜像/compose 里已经装好（`backend/Dockerfile:34` 装 ffmpeg）。本机直跑还要自备 venv、装扩展、对齐 Redis，和容器环境容易不一致。容器路径是默认入口；本机 venv 只留给调试和测试，端口口径见 `docs/run.md`。

## 五、常用命令

```bash
docker compose up -d                                 # 起全部 5 个服务
docker compose up -d postgres redis backend frontend # web-only，不带 worker
docker compose build backend                         # 改了后端依赖或代码后重建
docker compose stop                                  # 停容器，保留卷
docker compose ps                                   # 看服务状态（以服务名为准）
docker compose logs -f backend                       # 跟后端日志
docker compose down                                  # 删容器，命名卷保留
```

宿主机直连后端调试：`curl http://127.0.0.1:12402/health`（回环口，只给本机用）。

GPU 转写用覆盖文件：`docker-compose.gpu.yml` 给 backend 和 worker 都挂 NVIDIA 设备（`docker-compose.gpu.yml:13-39`），构建参数 `INSTALL_CUDA=true`。

## 六、覆盖文件（overlay）

| 文件 | 用途 |
|---|---|
| `docker-compose.https.yml` | Caddy 承担 80/443；frontend 只绑回环 12302 |
| `docker-compose.pg.yml` | 独立 PostgreSQL 实例覆盖（SQLite 迁移/回滚场景），同项目名、同卷名 |
| `docker-compose.tencent.yml` | 腾讯云部署：资源上限、日志轮转、可选内嵌 embedding 服务 |
| `docker-compose.gpu.yml` | GPU 转写覆盖 |

用法是 `-f docker-compose.yml -f docker-compose.<overlay>.yml up -d`，overlay 里同名段会合并覆盖。

## 配置口径（已统一）

- `CORS_ORIGINS` 三处默认值已统一为六源：`localhost` / `127.0.0.1` 的 12302、12322，以及裸域 `localhost` / `127.0.0.1`；`.env.example`、`docker-compose.yml:205,341`、`database.py` 代码回退完全一致。
- 六个运维脚本（`start.bat`、`start.sh`、`scripts/diagnose.sh`、`backup.sh`、`restore.sh`、`preflight.sh`）已统一按 compose 生成名 `p2-siteyeb-<service>-1` 取容器，并保留 `*_CONTAINER` 环境变量覆盖；compose 仍不写死 `container_name`。
