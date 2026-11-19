# 日志：够用就好

> 状态：事实已核实（核对基线 2026-11-16）

## 一、为什么写两处

- **stdout**：给 `docker logs` 和未来的采集器（Loki/Promtail）用。
- **文件 JSONL**：容器重建后 `docker logs` 就没了，历史全丢；排查「昨天那次 500」只能靠文件。

文件按大小轮转，默认 20MB × 5 份（`backend/app/database.py:47-48`；`observability.py:164-171`）。

### 落盘位置

backend 与 worker 是两个独立进程，各写各的文件（RotatingFileHandler 不是多进程安全的）：

| 进程 | 容器内文件 | 宿主路径 | 依据 |
|---|---|---|---|
| backend | `/data/logs/backend.jsonl` | `./logs/backend.jsonl` | `docker-compose.yml:153-154,234` |
| worker | `/data/logs/worker.jsonl` | `./logs/worker.jsonl` | `docker-compose.yml:289-290,370` |

`LOG_DIR` 不可写时退化成只打 stdout，不抛异常（`observability.py:125-135,172-173`）。

## 二、JSONL 字段

单行 JSON，既能直接 grep，也能被 Loki/ELK 采集（`observability.py:94-122`）：

| 字段 | 含义 |
|---|---|
| `ts` | 本地时间，毫秒 |
| `level` | DEBUG / INFO / WARNING / ERROR / CRITICAL |
| `logger` | Python logger 名 |
| `msg` | 已脱敏的消息 |
| `request_id` | 请求 ID；worker 任务里用 job_id 绑定 |
| `svc` | 进程名（backend / worker） |
| `exc` | 截断后的异常堆栈 |
| 其余 `extra_fields` | 业务附加字段，敏感键整条丢弃 |

每个请求经 `RequestContextMiddleware` 生成 `request_id`，响应头回写 `X-Request-ID`；访问日志记方法、路径、状态码、耗时、客户端 IP，静态资源与 SPA 兜底路由不记（`observability.py:200-243`）。worker 里没有请求上下文，用 `bind_request_id(job_id)` 把同一任务的日志串起来（`observability.py:245-251`）。

### 脱敏两层

1. **按键名**：`extra_fields` 里 `password` / `token` / `secret` / `cookie` 等键直接丢弃（`observability.py:42-45`）。
2. **按内容**：`msg` 和堆栈里的 Bearer、`password=`、`sk-...`、JWT 三段串用正则盖掉（`observability.py:48-69,85-91`）。

## 三、查询历史日志

`scripts/logq.sh` 是薄封装，内部调 `scripts/logq.mjs`，直接读 `./logs/*.jsonl`，不依赖应用进程（`scripts/logq.sh:14-16`）：

```bash
bash scripts/logq.sh errors --since 1h --limit 50
bash scripts/logq.sh tail 30
bash scripts/logq.sh req 8f3a2c1d          # 按 request_id / job_id 拉一次任务的全部日志
bash scripts/logq.sh grep 转写失败
bash scripts/logq.sh path /api/notes
bash scripts/logq.sh stats --since 24h
bash scripts/logq.sh files
```

子命令：`errors` / `tail` / `req` / `grep` / `path` / `stats` / `files`；标志：`--since`（如 `1h`、`30m`、`2d`）、`--limit`、`--json`（`scripts/logq.mjs:5-11,131,145,245`）。没有 node 时可直接 `grep '"level":"ERROR"' logs/backend.jsonl`（`scripts/logq.sh:19-20`）。

## 四、日志静默：成因与正确修法（重要）

### 现象

应用启动时「日志落盘」那行打完，后面所有业务日志全部静默丢弃；不报错、不抛异常，比没有日志更难查。

### 成因

Alembic 在**应用进程内部**跑迁移（`database.py` 的 `ensure_runtime_schema` 调 `command.upgrade`）。如果 Alembic 环境无条件执行 `logging.config.fileConfig(...)`，它会：

1. **把 root logger 的 handler 全部清空**，换成 ini 里配置的新 handler；
2. 默认 `disable_existing_loggers=True`，把启动时已经建好的各业务 logger 一并关掉；
3. root level 被设成 NOTSET。

于是应用自己配好的 stdout / JSONL handler 被冲掉，后续 `logger.info(...)` 找不到可用 handler，静默丢失。

### 当前代码的保护

- `database.py` 在调 `command.upgrade` 之前设 `skip_logging_config=True`（`backend/app/database.py:411` 附近）。
- `alembic/env.py:56-57` 看到这个标记就**提前 return，不跑 `fileConfig`**：应用进程内迁移保留应用自己的日志配置。
- 只有命令行单独跑 `alembic`（没有应用先配日志）时，才走 ini 里的 logging 配置，由调用方不设该标记来区分（`alembic/env.py:54-55`）。

### 正确修法（别走错方向）

- 真要修，是**去掉那条触发 `fileConfig` 的旧配置/旧调用**，让 root handler 不被重置；或在迁移路径上保留 `skip_logging_config` 保护。
- **加 `disable_existing_loggers=False` 是无效修法**：它只控制「配置时要不要禁用已有 logger」，挡不住 root handler 列表被清空、level 被重置；logger 即使没被 disable，也没有 handler 可写。
- 重设 root level 同样绕不开 handler 被清这一步。

### 哪些进程要留意

- 本机 venv、entrypoint 非迁移路径等**没走 Alembic 保护**的进程，一旦引入旧的 `fileConfig` 调用，会复现同样的静默。
- worker 是独立进程，启动时同样调 `setup_from_settings("worker")`（`backend/app/worker.py:55-57`），有独立 `worker.jsonl`。

## 五、容器日志兜底轮转

应用自己有 RotatingFileHandler，但 stdout 同样会被 Docker 落盘；不设上限迟早写满磁盘。compose 里 json-file 驱动统一 `20m × 3`（`docker-compose.yml:126-130,265-269,396-400`）。

## 六、排查入口

- 整站异常先跑 `bash scripts/diagnose.sh`：第 2 段是健康探针最后输出（容器 unhealthy 时唯一还活着的诊断信息），第 8 段列应用日志文件与轮转口径（`scripts/diagnose.sh:37-52,102-109`）。
- 接口 500 但日志没细节：先 `logq.sh errors` 拿异常类型和 `request_id`，再 `logq.sh req <id>` 拉全量。
- 日志口径与服务清单的对应关系见 `docs/docker.md`。
