# 部署与上线

> 状态：事实已核实（核对基线 2026-11-21，7.0 monorepo）

这份文档解决一个问题：**从「本机能跑」到「可以给别人用」，中间还差什么。**
容器组成、端口、卷的口径见 `docs/docker.md`；本文只讲上线前的准备、探针、备份和排障入口。

## 一、准备

1. 装好 Docker Engine 与 Compose 插件；仓库克隆到服务器。
2. 复制 `.env.example` 为 `.env`，至少改这几项：
   - `JWT_SECRET`：随机串，长度 ≥ 32，不能用示例值（`.env.example:70`）。
   - `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`：库账号口令。
   - 公网部署：`ALLOW_REGISTRATION=false`（`.env.example:78`）、`COOKIE_SECURE=true`（`.env.example:89`）。
   - 本机 embedding 服务：`EMBEDDING_BASE_URL_DOCKER` 默认 `http://host.docker.internal:1234/v1`（`.env.example:100`；`docker-compose.yml:164`）。
3. 媒体库放在 `./data/` 与 `VIDEO_HOST_PATH` 对应目录，路径口径见 `docs/docker.md` 第三节。

## 二、构建与启动

```bash
docker compose --env-file .env -f infra/docker-compose.yml up -d --build
```

起 5 个服务：`postgres`、`redis`、`backend`、`worker`、`frontend`。backend 容器入口先等库可连，再跑 `ensure_runtime_schema()`，最后才 exec uvicorn（`backend/docker-entrypoint.sh:10-56`）。库表结构的两套机制见 `docs/migrations.md`。

web-only（不带 AI worker）：

```bash
docker compose --env-file .env -f infra/docker-compose.yml up -d postgres redis backend frontend
```

## 三、访问入口

- 本机/局域网：`http://localhost:12302`，同时也映射了裸 80（`docker-compose.yml:407-408`）。
- API 走 nginx 同源代理 `/api`。backend 回环口 `127.0.0.1:12402` 只绑本机，供宿主调试；对外服务不经过这个口（`docker-compose.yml:132-135`）。容器内网地址是 `backend:8000`（`nginx.conf:100`）。
- nginx 用 resolver + 变量形式的 `proxy_pass`，backend 重建换 IP 后不需要重启 frontend（`nginx.conf:87-100`）。

## 四、探针

| 探针 | 检查内容 | 依据 |
|---|---|---|
| `GET /health` | 进程存活、数据库连通、长事务健康度；degraded 仍返回 200（不触发编排重启） | `backend/app/main.py:266-321`；compose backend healthcheck `docker-compose.yml:235-236` |
| `GET /ready` | database、vectors 覆盖率、transactions、embedding_model、llm；任一关键项失败返回 503 | `backend/app/main.py:324-357` |
| `GET /api/admin/health` | 管理面详细指标 | 鉴权后访问 |

容器 unhealthy 时，应用日志可能一个字都没有；先看探针最后一次输出：

```bash
docker inspect -f '{{range .State.Health.Log}} exit={{.ExitCode}} {{printf "%.260s" .Output}}{{"\n"}}{{end}}' backend
```

## 五、HTTPS（可选叠加层）

```bash
DOMAIN=learn.example.com docker compose --env-file .env \
  -f infra/docker-compose.yml -f infra/docker-compose.https.yml up -d --build
```

- 叠加层里 frontend 只绑回环 `127.0.0.1:12302`，对外 80/443（含 443/udp HTTP/3）由 `caddy` 服务承担（`docker-compose.https.yml:15-25`）。
- Caddy 自动申请并续期 Let's Encrypt 证书；证书持久化在 `siteyeb-caddy-data` / `siteyeb-caddy-config` 两个卷（`docker-compose.https.yml:28-29,44-47`），否则重启后重新申请容易触发限流。
- 前提：域名 A 记录指向本机，80/443 公网可达。
- `Caddyfile:23` 反代到 `host.docker.internal:{$WEB_PORT:12302}`，兜底值已与 compose 默认 `12302` 对齐；叠加 HTTPS 时无需再显式设 `WEB_PORT`。

## 六、备份与恢复

脚本在 `ops/scripts/` 下，只读/破坏性口径都写在脚本头注释里。

### 备份

```bash
./ops/scripts/backup.sh                # 输出到 backups/
KEEP_DAYS=30 ./ops/scripts/backup.sh   # 保留 30 天，默认 7 天
```

- 用 `pg_dump -Fc` 自定义格式，先 dump 进容器再 `docker cp` 出来（`scripts/backup.sh:35-36`），避免 Windows 下 shell 重定向改写二进制流。
- 写完校验文件头必须是 `PGDMP`（`scripts/backup.sh:47-52`）。
- 向量存在 `content_chunks.embedding`（`halfvec`，维度默认 1024，`backend/app/database.py:80`；DDL 见 `backend/app/tables.py:57-82`）。旧文档提过的 `segment_embeddings` 表已删除，不要在备份说明里再引用。
- 库之外还要备份绑定挂载的媒体/产物目录和 `./data/logs/`，挂载口径见 `docs/docker.md` 第三节。

### 恢复

```bash
./ops/scripts/restore.sh backups/p2learning-20261116-031500.dump
./ops/scripts/restore.sh backups/xxx.dump --yes
```

- `--clean --if-exists --no-owner --single-transaction`；恢复前先断开其它连接，否则 DROP 被会话锁住。
- 脚本会先跑一次 `backup.sh` 留回滚点；恢复完建议 `docker compose --env-file .env -f infra/docker-compose.yml restart backend`。

### 定时任务（Linux 示例）

```cron
0 3 * * * cd /path/to/project && ./ops/scripts/backup.sh >> backups/backup.log 2>&1
```

## 七、上线前自检

```bash
./ops/scripts/preflight.sh [http://localhost]
```

只读检查，不改状态；覆盖 JWT_SECRET、注册开关、Cookie Secure、端口暴露、接口 401/200 边界、安全响应头、近 48 小时备份等共 16 项（`scripts/preflight.sh:26-132`）。结果分 PASS / WARN / FAIL：FAIL 必须解决，WARN 要么解决要么能解释清楚；有 FAIL 不建议对外发布。

## 八、排障入口

- 整站异常先跑：`bash ops/scripts/diagnose.sh`，八段依次是容器状态、探针最后输出、PG 长事务/锁等待、队列注册与积压、后端最近错误、nginx 最近错误、worker 日志、应用日志文件。
- 按 request_id 查历史日志：`bash ops/scripts/logq.sh req <id>`，用法见 `docs/logging.md`。
- 分层定位 502：
  1. `docker compose --env-file .env -f infra/docker-compose.yml ps` 看 frontend / backend 是否 healthy；
  2. backend 不健康 → 看 diagnose 第 3 段锁等待；
  3. backend 健康但仍 502 → 看 diagnose 第 6 段 nginx 错误；
  4. 转写一直排队 → 看 diagnose 第 4 段 worker 注册数。

## 九、数据基线（2026-11-16 口径）

以下为本次核对基线，不是上线承诺值；实际数字以 `/api/stats` 与管理接口为准：

- 视频 14,327；语义块 60,259；字幕片段 3,593,723；有字幕视频 8,785。

## 配置核对结论

- `Caddyfile:23` 兜底反代端口已改为 12302，与 compose `WEB_PORT` 默认一致。
- `scripts/backup.sh`、`scripts/restore.sh`、`scripts/preflight.sh` 已改用 compose 生成名 `p2-siteyeb-postgres-1` / `p2-siteyeb-redis-1`，仍可用 `PG_CONTAINER` 覆盖；`ops/start.bat` / `ops/start.sh` / `ops/scripts/diagnose.sh` 同步改为 `p2-siteyeb-backend-1`。
