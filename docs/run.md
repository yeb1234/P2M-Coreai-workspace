# 怎么把服务跑起来

> 状态：事实已核实（核对基线 2026-11-21，7.0 monorepo）

这份文档回答两个问题：**为什么启动方式和以前不一样了**，以及**本机/服务器上分别怎么起、起完看哪里**。容器组成、镜像、卷的口径见 `docs/docker.md`。

## 一、为什么不再本机直跑

应用依赖 PostgreSQL + pgvector 扩展、Redis、ffmpeg；这些由 compose 栈提供。旧的「本机 uvicorn + `npm run dev`」直跑方式不再作为默认入口，原因是环境容易和容器侧不一致。本机 venv 只留给调试和测试，端口口径见第四节。

## 二、容器启动（默认路径）

### Windows：`ops\start.bat`

```
[1] Full stack   db + redis + backend + worker + web（AI 转写/索引需要 worker）
[2] Web only     db + redis + backend + web（不带 worker：AI 任务不消费，其余正常）
[3] Restart backend only   重建并重启 backend + worker
[4] Restart frontend only  重建并重启 frontend
[5] Status       服务状态 + /health、/ready 探针
[6] Follow backend log      跟后端日志
[7] Stop everything  停止，卷保留
[0] Exit
```

依据：`ops/start.bat`。

### Linux / macOS / WSL：`ops/start.sh`

```bash
./ops/start.sh            # full，全部服务（默认）
./ops/start.sh web        # web-only，不带 worker
./ops/start.sh backend    # 重建 + 重启 backend & worker
./ops/start.sh frontend   # 重建 + 重启 frontend
./ops/start.sh stop       # 停止，卷保留
./ops/start.sh status     # 服务状态 + 探针
./ops/start.sh logs       # 跟后端日志
```

依据：`ops/start.sh`。

两条脚本都会先 `cd` 到仓库根，并用 `docker compose --env-file .env -f infra/docker-compose.yml`；Docker 未运行、缺 `infra/docker-compose.yml`、缺 `.env` 时先做 sanity check。

## 三、端口与访问入口

端口规则：`<服务前缀><两位项目号>`，P2 尾号 02（`infra/docker-compose.yml`）。

| 端口 | 服务 | 绑定 | 说明 | 依据 |
|---|---|---|---|---|
| `12302` | frontend:80 | — | 浏览器入口，`WEB_PORT` 默认 12302；另占裸 80 | `docker-compose.yml:407-408` |
| `12402` | backend:8000 | 只绑 `127.0.0.1` | API 回环口，供宿主调试；对外访问仍走 nginx `/api` | `docker-compose.yml:134-135` |
| `11112` | — | — | 已作废（2026-11-16 起换号，后端 API 见 12402） | `docker-compose.yml:3,135` |
| `12322` | Vite dev | `127.0.0.1` | dev = 12302 + 20，代理到 `127.0.0.1:12302` | `vite.config.ts:12,16`；`playwright.config.ts:12,17` |
| `12502` | postgres:5432 | 只绑 `127.0.0.1` | `POSTGRES_PORT` 可覆盖 | `docker-compose.yml:75` |
| `12602` | redis:6379 | 只绑 `127.0.0.1` | `REDIS_PORT` 可覆盖 | `docker-compose.yml:107` |
| 监控段 | — | — | 未分配；旧 11162 作废 | `docker-compose.yml:6` |

起完访问：`http://localhost:12302`（或 `http://localhost`）。API 路径同源 `/api`；本机直连后端调试用 `http://127.0.0.1:12402`，公网不经过这个口。

### 启动后先看探针

```bash
curl -s http://localhost/health    # 进程 + 数据库 + 事务健康度
curl -s http://localhost/ready     # database / vectors / transactions / embedding / llm，失败 503
```

`/ready` 返回 503 通常是 embedding 服务不可达；站点仍可用，语义检索退化为词法检索。探针口径见 `docs/deploy.md` 第四节。

## 四、本机开发（非默认路径）

- 后端：venv 下 `uvicorn app.main:app --port 8100 --reload`（`README_cn.md:72` 口径；本次未复核 venv 启动命令）。
- 前端：`cd frontend && npm run dev`，Vite 端口 12322，`/api` 代理到 `127.0.0.1:12302`，不需要再单独配 `VITE_API_BASE_URL`。
- embedding：本机跑 LM Studio 等兼容服务时，容器侧用 `EMBEDDING_BASE_URL_DOCKER=http://host.docker.internal:1234/v1`（`docker-compose.yml:164`；`.env.example:100`）。

## 五、当前数据基线（2026-11-16 口径）

以下为核对基线，不是运行承诺值；实时数字以 `/api/stats` 与管理接口为准：

- 视频 14,327
- 语义块（content_chunks）60,259
- 字幕片段 3,593,723
- 有字幕视频 8,785

## 六、起不来 / 页面打不开时

先跑 `bash ops/scripts/diagnose.sh`（只读，八段输出）：容器状态 → 探针最后输出 → PG 长事务/锁等待 → 队列注册与积压 → 后端最近错误 → nginx 最近错误 → worker 日志 → 应用日志文件。

- 整站 502 且 backend 不健康：看第 3 段，有 `idle in transaction` + 锁等待，说明迁移卡在 DDL，后端还没监听端口。
- backend 健康但仍 502：看第 6 段 nginx 错误。
- 转写一直排队：看第 4 段 worker 注册数（正常 1；0 没有消费者，2+ 是重复 worker）。
- 接口 500 但日志没细节：`bash ops/scripts/logq.sh errors`，再按 `request_id` 用 `logq.sh req <id>` 拉全量；日志口径见 `docs/logging.md`。

## 待用户确认

- `start.bat:125,143` 与 `start.sh:31,80` 已改用 compose 生成名 `p2-siteyeb-backend-1` 取日志/探针状态。
- 本机后端 8100 启动命令来自 `README_cn.md`，本次没有在 venv 里实跑复核。
