# 上腾讯云

> 状态：事实已核实（核对基线 2026-11-16）；文内机型、磁盘、带宽等容量数字是历史估算口径，未在本次复核，以当前 `/api/stats` 实测为准。

目标：从「本机跑」到「公网可访问、多用户可用、能扛住基本滥用」。通用部署口径见 `docs/deploy.md`，本文只讲云上才需要考虑的事。

## 一、覆盖层做了什么

```bash
docker compose -f docker-compose.yml -f docker-compose.tencent.yml up -d
# 需要 HTTPS 再叠一层：
docker compose -f docker-compose.yml -f docker-compose.tencent.yml -f docker-compose.https.yml up -d
```

`tencent.yml` 只补资源上限、日志轮转和云上环境变量，业务配置留在 `.env`（`docker-compose.tencent.yml:8-9`）：

| 服务 | 内存 / CPU 上限 | 日志轮转 | 依据 |
|---|---|---|---|
| `postgres` | `${PG_MEM_LIMIT:-2g}` / `${PG_CPUS:-2}` | 20m × 5 | `docker-compose.tencent.yml:12-21` |
| `redis` | `${REDIS_MEM_LIMIT:-512m}` / `${REDIS_CPUS:-1}` | 10m × 3 | `docker-compose.tencent.yml:23-30` |
| `backend` | `${BACKEND_MEM_LIMIT:-3g}` / `${BACKEND_CPUS:-2}` | 50m × 5 | `docker-compose.tencent.yml:32-39` |
| `frontend` | `${FRONTEND_MEM_LIMIT:-256m}` / `${FRONTEND_CPUS:-1}` | 20m × 3 | `docker-compose.tencent.yml:53-60` |
| `worker` | 复用 backend 资源口径 | — | 主 compose worker 段 |

backend 段去掉了 `host.docker.internal` 这条宿主挂载（`extra_hosts: !reset []`，`docker-compose.tencent.yml:50-51`），云上容器不需要回宿主机。

## 二、机型与磁盘（历史估算，未复核）

> 下面这组数字来自早期一份 21,136 个视频 / 约 1,574 GB 媒体库的估算；2026-11-16 基线为视频 14,327、语义块 60,259、字幕片段 3,593,723。选型前先用当前库实测体积和向量覆盖率重算。

- **数据库内存**：向量索引（HNSW）构建期很吃内存，PG 建议内存型实例起步；具体规格按 `content_chunks` 行数与 embedding 维度压测后定。
- **系统盘**：放系统和 Docker 镜像；**数据盘**单独挂，媒体、`./data/`、`./logs/` 都落数据盘，避免写爆系统盘导致 PG 崩。
- **CPU**：转写（Whisper）和向量化是 CPU 密集；不开 GPU 时转写走 CPU int8，worker 需要留足核数。
- **带宽**：媒体走浏览器直拉，按并发播放数估出口带宽；纯 API 流量很小。

## 三、配额与限流（代码口径，已核对）

计数与限流都走 Redis；Redis 不可用时**放行**并打告警，不因为缓存抖动阻断登录（`backend/app/services/quota.py:20-21`、`rate_limit.py:8-10`）。

### 每日配额（按用户，0 点重置）

| 项 | 普通用户/天 | 管理员/天（×5） | 依据 |
|---|---|---|---|
| 对话轮数（chat） | 200 | 1000 | `database.py:158,161`；`quota.py:98-99` |
| 学习路径生成（plan） | 20 | 100 | `database.py:159,161`；`quota.py:102-103` |

### 瞬时限流（固定窗口）

| 项 | 阈值 | 窗口 | 依据 |
|---|---|---|---|
| 对话 | 20 轮 / 用户 | 1 分钟 | `rate_limit.py:67` |
| 路径生成 | 6 次 / 用户 | 10 分钟 | `rate_limit.py:65` |
| 登录 | 30 次 / IP | 15 分钟 | `rate_limit.py:59` |
| 登录 | 8 次 / 账号 | 15 分钟 | `rate_limit.py:61` |
| 注册 | 5 个 / IP | 1 小时 | `rate_limit.py:63` |

配额上限可用 `QUOTA_CHAT_DAILY` / `QUOTA_PLAN_DAILY` / `QUOTA_SEARCH_DAILY` / `QUOTA_AI_DAILY` / `QUOTA_ADMIN_MULTIPLIER` 覆盖（`docker-compose.tencent.yml:47-51`）。

## 四、embedding 服务（可选 profile）

云上没有 LM Studio，embedding 要指向独立服务。覆盖层里的 `embedding` 是可选 profile，不带 `profiles: ["embedding"]` 时不启动（`docker-compose.tencent.yml:65-69`）。

- 镜像：`ghcr.io/ggerganov/llama.cpp:server`（`EMBEDDING_IMAGE` 可覆盖，`:66`）。
- 模型：`/models/bge-m3-q8_0.gguf`，`./models` 只读挂载进容器（`:72,86`）。
- 参数：`--embeddings --pooling cls --ctx-size 8192 -t ${EMBEDDING_THREADS:-4}`（`:73-84`）；bge-m3 是 CLS 池化，不能用均值池化。
- 容器内监听 80；backend / worker 通过 `http://embedding:80/v1` 访问（`:44`），**不映射宿主端口**。
- 健康检查：`curl /health`，`start_period 120s`（`:87-92`）。

**换 embedding 实现是破坏性的**：向量空间不可比，存量 `content_chunks.embedding` 不能跨模型检索，必须整库重建；这不是改个地址就完事的。

## 五、网络与域名

- 安全组 / 防火墙：只放行 80、443；PostgreSQL（12502）、Redis（12602）只绑 `127.0.0.1`，不对公网开（`docker-compose.yml:75,107`）。
- 域名 A 记录指向云主机公网 IP；HTTPS 用 `docker-compose.https.yml` 叠加 Caddy 自动申请证书，见 `docs/deploy.md` 第五节。
- 建完账号把 `ALLOW_REGISTRATION=false`，避免公网被灌号（`.env.example:78`）。

## 六、上线后例行

- 定时跑 `scripts/backup.sh`，备份库 + `./data/` 绑定挂载，见 `docs/deploy.md` 第六节。
- `scripts/preflight.sh` 过一遍 16 项只读检查。
- 看队列积压与 worker 注册数：`bash scripts/diagnose.sh` 第 4 段。

## 未核实项

- 机型规格、系统盘/数据盘容量、出口带宽数字：早期估算，未在 2026-11-16 按当前媒体库复核。
- 云厂商安全组具体控制台路径、镜像仓库前缀配置：文档只给原则，未对着当前腾讯云控制台逐项核。
