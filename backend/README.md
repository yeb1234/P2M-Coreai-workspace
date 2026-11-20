# Backend（FastAPI）

> 状态：现行（最后校对 2026-11-20）

本地视频学习工作台的服务端：API、Agent 链路、检索与记忆、AI 任务队列消费者。与前端、PostgreSQL/pgvector、Redis 一起由根目录 `docker-compose.yml` 编排；本目录只放后端代码。

## 技术栈

| 模块 | 技术 |
| --- | --- |
| Web 框架 | FastAPI 0.115、Uvicorn 0.30.6、Pydantic 2.9 |
| 数据层 | SQLAlchemy 2.0.36、Alembic 1.13.3、psycopg3、pgvector、PostgreSQL 17 |
| 认证 | PyJWT 2.9、httpOnly Cookie、PBKDF2-HMAC-SHA256（600,000 迭代） |
| Agent / LLM | langchain-core 1.x、langchain-openai 1.x、langgraph 1.x（prebuilt `create_react_agent`） |
| 队列 / 缓存 | RQ 1.16、Redis 5 |
| 转写 / 视频 | Faster-Whisper 1.0.3、whisper.cpp、ffmpeg |

## 目录结构

```text
backend/
  app/
    main.py          FastAPI 装配、中间件、异常处理、静态文件挂载
    database.py      引擎 / Session / ensure_runtime_schema / 健康检查
    models.py        34 个 ORM 模型
    worker.py        RQ SimpleWorker，消费 ai_jobs + background 两个队列
    auth.py          密码哈希 / 校验、登录令牌
    routers/         19 个业务路由（前缀见下表）
    services/        61 个服务模块（检索 / 转录 / 记忆 / Agent / 管理）
    agents/          chat_agent、plan_agent、tools
    core/            CSRF、异常处理、观测等中间件
  alembic/           迁移版本（2 个 revision，链条见「数据与迁移」）
  tests/             19 个测试文件
  scripts/           回填 / 建块 / 去重 / 迁移 / 回归脚本
```

## 路由前缀

| 前缀 | 文件 | 职责 |
| --- | --- | --- |
| `/api/admin` | `admin.py` | 队列管理、缩略图、嵌入覆盖率、后台任务、库管理 |
| `/api/agent-actions` | `agent_actions.py` | Agent 写动作回执、审计与撤回 |
| `/api/ai-jobs` | `ai_jobs.py` | AI 任务中心：列表 / 取消 / 重试 / 批量插队 |
| `/api/asset-registry` | `asset_registry.py` | 配置资产版本库（Git 风格读写） |
| `/api/assistant` | `assistant.py` | 对话 SSE 流式、会话历史、记忆读写 |
| `/api/auth` | `auth.py` | 注册 / 登录 / 登出、Cookie 会话 |
| `/api/calendar-events` | `calendar_events.py` | 日历事件 |
| `/api/categories` | `categories.py` | 课程 / 分类 |
| `/api/interview` | `interview.py` | 面试题库、练习与评估 |
| `/api/learning` | `learning.py` | 学习路径、学习轨迹、画像 |
| `/api/mcp` | `mcp.py` | MCP HTTP 工具清单与调用 |
| `/api/memory` | `memory_admin.py` | 长期记忆条目管理 |
| `/api/notes` | `notes.py` | 笔记共享 / 私有、笔记 AI |
| `/api/ops` | `ops.py` | 转写控制面：扫描、队列、监控快照 |
| `/api/schedule-items` | `schedule_items.py` | 待办 / 提醒 / 番茄排程 |
| `/api/search` | `search.py` | 混合检索（三路召回 + RRF + 重排） |
| `/api/user-data` | `user_data.py` | 用户档案 KV |
| `/api/videos` | `videos.py` | 视频库、扫描、播放进度、字幕 / 总结 |
| `/api/watch-events` | `watch_events.py` | 观看历史 |

## 服务分组（`services/`）

- **检索**：`hybrid_search`（三路召回 + 加权 RRF）、`lexical`（pg_trgm + ILIKE）、`retrieval_meta`（视频级元数据线索）、`vector_store`（HNSW halfvec）、`embedding_pipeline` / `embeddings` / `chunker`、`query_rewrite`（口语剥离与术语中英互认）、`rerank_client`（cross-encoder，失败退 LLM listwise 重排）。
- **转录与产物**：`file_scanner`、`transcribe_whisper`、`subtitle_corrector`、`subtitle_writer`、`write_md`、`thumbnail_worker`、`sprite`、`ffmpeg_audio`、`video_serialization`。
- **AI 任务**：`ai_jobs`、`ai_job_tasks`、`ai_job_rules`、`admin_ai_queue`、`rq_client`、`background_tasks`、`background_handlers`。
- **记忆与画像**：`memory`、`memory_extract`、`profile`、`journey`、`learning_context`、`prompts`、`llm`、`llm_client`、`ollama_summarize`。
- **管理与防护**：`admin_health`、`admin_library`、`admin_settings`、`quota`、`rate_limit`。

## 队列与任务

- RQ 两个队列：`ai_jobs`（转写 / 总结 / 字幕校对 / 缩略图 / 建块向量化）、`background`（轻量后台任务）。
- worker 启动命令：`python -m app.worker`（compose 的 `worker` 服务，复用 backend 镜像）。
- 任务状态：`queued / running / cancelling / completed / failed / cancelled`。
- 重启续跑：启动时 `requeue_interrupted_ai_jobs` 把中断任务重投；运行期列表接口触发 `reconcile_stuck_ai_jobs` 自愈（扫 `queued` + `running`，以 RQ 真实状态为准）。

## 数据与迁移

- 主库 PostgreSQL 17 + pgvector，连接串 `DATABASE_URL`（psycopg3）。
- 迁移机制并存，不能写成「已全部迁到 Alembic」：
  - Alembic 2 个 revision：`ed9ec716c9b0`（`2026_11_16_1356-ed9ec716c9b0_baseline.py`，baseline，`down_revision=None`）→ `f2f5d8064921`（`2026_11_16_1358-f2f5d8064921_notes_indexes_parity.py`，notes 索引补齐，`down_revision=ed9ec716c9b0`）。
  - 同时保留 legacy `app/migrations.py` 与 `database.ensure_runtime_schema()`（`create_all` + `ALTER IF NOT EXISTS`）兜底补齐缺表 / 缺列。
  - 加表 / 加列的流程见根目录 `docs/migrations.md`。
- 向量：halfvec(1024) HNSW；检索单元为 `content_chunks` 语义块；旧的 `segment_embeddings` 碎片表已移除。

## 环境变量

关键项（完整清单见根目录 `.env.example`）：

| 类别 | 变量 |
| --- | --- |
| 数据库 | `DATABASE_URL`、`POSTGRES_HOST`、`POSTGRES_PORT`、`POSTGRES_DB`、`POSTGRES_USER`、`POSTGRES_PASSWORD`、`DB_POOL_SIZE`、`DB_MAX_OVERFLOW` |
| 队列 | `REDIS_URL` |
| 安全 | `JWT_SECRET`（长度 ≥ 32）、`JWT_EXPIRE_HOURS`、`CORS_ORIGINS`、`ALLOW_REGISTRATION`、`ADMIN_USERNAMES`、`ENABLE_DOCS`、`COOKIE_SECURE`、`SESSION_COOKIE_NAME`、`COOKIE_SAMESITE` |
| 本地模型 | `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL`、`OLLAMA_BASE_URL`、`EMBEDDING_BASE_URL` / `EMBEDDING_MODEL` / `EMBEDDING_DIM` |
| 外部 LLM | `EXTERNAL_LLM_BASE_URL`、`EXTERNAL_LLM_API_KEY`、`EXTERNAL_LLM_MODEL`、`LLM_USAGE_POLICY` |
| 重排 | `RERANK_API_URL`、`RERANK_API_KEY`、`RERANK_MODEL`、`RERANK_MIN_SCORE` |
| 转写 | `WHISPER_ENGINE`、`DEFAULT_WHISPER_MODEL`、`WHISPER_COMPUTE_TYPE`、`DEVICE_TYPE`、`SUBTITLE_CORRECTION_*` |

`CORS_ORIGINS`（逗号分隔，禁止 `*`）：`.env.example:74` 现行值为
`http://localhost,http://localhost:12302,http://localhost:12322,http://127.0.0.1,http://127.0.0.1:12302,http://127.0.0.1:12322`。
注意：`docker-compose.yml:205,341` 的内联默认值已与 `.env.example` 同步为 12302 / 12322 六源；`database.py` 的代码回退默认也一致。未显式设置 `CORS_ORIGINS` 时，compose、代码回退、示例文件三处口径相同。

## 运行

主链路在 Docker（编排与端口见根目录 README 与 `docs/run.md`）。backend 容器内部监听 `8000`；宿主回环映射 `127.0.0.1:12402`，对外请求仍经 nginx `/api`。

可选：本地起后端做调试（前置：PG 在 12502、Redis 在 12602 已运行，`.env` 已填）：

```bash
cd backend
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

健康探针：`GET /health`、`GET /ready`。接口文档默认关闭（`ENABLE_DOCS=false`），nginx 同时屏蔽 `/api/docs`。

## 测试与检查

```bash
cd backend
python -m compileall app
python scripts/run_unit_tests.py
```

`backend/tests` 共 19 个测试文件、99 项断言，由 `scripts/run_unit_tests.py` 统一执行；仓库根 `tests/` 下只有 `contracts` 与 `e2e`，后端没有 API 级集成测试。

回归脚本：

- `scripts/verify_fixes.py`：验证「修之前会错、修之后对」，不是只看接口 200。
- `scripts/test_multi_user.py`：多用户隔离回归，默认打 `http://localhost`，可传第一个参数指别的环境。

## 安全要点

- 令牌存 httpOnly Cookie（JS 读不到）；`core/csrf.py` 提供 CSRF 防护；密码 PBKDF2-HMAC-SHA256，登录时透明升级存量弱哈希。
- 管理端点校验管理员；笔记、记忆、画像、路径按 `user_id` 隔离。
- 公网部署前必须：`ALLOW_REGISTRATION=false`、换强 `JWT_SECRET`、前置 HTTPS（`COOKIE_SECURE=true`）。
