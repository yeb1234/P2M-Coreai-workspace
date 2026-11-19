# P2 架构图集（Mermaid）

> 状态：现行（2026-11-16）。这些图用于 README、幻灯片或 GitHub 预览；可交互版见 [architecture-demo.html](architecture-demo.html)。

## 1. 五服务部署

```mermaid
flowchart LR
  U[浏览器 / PWA] -->|80 / 12302| N[Nginx + 前端容器]
  N -->|/api| A[FastAPI 后端<br/>127.0.0.1:12402]
  A -->|SQL| P[(PostgreSQL 17 + pgvector<br/>127.0.0.1:12502)]
  A -->|enqueue / cache| R[(Redis<br/>127.0.0.1:12602)]
  W[Worker<br/>RQ SimpleWorker] -->|consume| R
  W -->|read / write| P
  A -->|SSE| U
  A -->|chat / embedding| M[外部 LLM + bge-m3]
  W -->|transcribe / summarize| M
```

## 2. 三路检索与重排

```mermaid
flowchart TB
  Q[用户问题] --> RW[query rewrite<br/>口语剥离 / 指代消解]
  RW --> L[词法通道<br/>pg_trgm + ILIKE]
  RW --> V[向量通道<br/>halfvec HNSW]
  RW --> MET[元数据通道<br/>标题 / 路径 / 课程]
  L --> RRF[加权 RRF<br/>lexical 0.8 / vector 1.2 / meta 1.5<br/>RRF_K=60]
  V --> RRF
  MET --> RRF
  RRF --> C[候选 top 30]
  C --> RR[cross-encoder / LLM listwise 重排<br/>rerank_top_n=20]
  RR --> T[top-k + 引用]
  T --> SSE[SSE 流式回答]
```

## 3. 四层记忆

```mermaid
flowchart TB
  MSG[L1 chat_messages<br/>原始消息] --> SUM[L2 chat_sessions.summary<br/>超 24 条压缩 / 保留最近 10 条]
  SUM --> CTX[上下文窗口]
  MEM[L3 memory_items<br/>fact / preference / goal / constraint / ability] --> CTX
  KV[L4 user_data KV<br/>p2m-profile-v1 / p2m-persona-v1] --> CTX
  CTX --> LLM[对话模型]
  MSG --> EXT[异步记忆抽取<br/>ThreadPoolExecutor max_workers=1]
  EXT --> MEM
  EXT -->|置信度 ≥ 0.6 才覆盖<br/>pinned 不覆盖| MEM
```

## 4. 任务状态机

```mermaid
stateDiagram-v2
  [*] --> queued: API 写 ai_jobs
  queued --> started: worker claim
  started --> finished: 转写 / 总结完成
  started --> failed: 异常 / 超时
  failed --> queued: 重试或手动继续
  queued --> queued: worker 重启 / sync_db_queue_to_rq
  started --> queued: reconcile_stuck_ai_jobs
  finished --> [*]
```

## 5. 一次对话请求时序

```mermaid
sequenceDiagram
  participant B as 浏览器
  participant N as Nginx
  participant A as FastAPI
  participant D as PostgreSQL
  participant R as Redis
  participant W as Worker
  participant M as 模型

  B->>N: POST /api/assistant/chat
  N->>A: 转发 + Cookie / CSRF
  A->>D: 读会话 / 记忆 / 档案
  A->>R: 读缓存 / 配额
  A->>M: 检索 + 生成（可并发）
  M-->>A: token 流
  A-->>B: SSE token + 引用
  A->>D: 落库消息 / 摘要
  A->>W: 异步记忆抽取
  W->>D: 写 memory_items
```

## 6. 端口与资源（文本版）

| 服务 | 宿主端口 | 容器端口 | 腾讯云上限 |
|---|---:|---:|---|
| frontend | `80`、`12302` | `80` | 256m / 1 CPU |
| backend | `127.0.0.1:12402` | `8000` | 3g / 2 CPU |
| worker | 不映射 | — | 跟随 backend 覆盖层 |
| postgres | `127.0.0.1:12502` | `5432` | 2g / 2 CPU |
| redis | `127.0.0.1:12602` | `6379` | 512m / 1 CPU |
| 监控 | 预留 `12702` | — | 未部署 |
