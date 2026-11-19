# 腾讯云 Ready：轻量 P2 Demo 说明

> 状态：演示方案（2026-11-16）。这不是生产部署文档，也不是“真实 GPU 转写”承诺。目标是租一台普通云主机，把 P2 的界面、检索、学习路径和任务状态跑起来，用预置数据完成一场清晰的演示。

## 一句话边界

**这是一场“假演示”**：视频是预置的，字幕/转译结果是预生成的，任务进度是模拟的。它证明的是界面、主链路和状态设计，不证明真实转写吞吐或公网 SaaS 能力。

演示时主动说这句话，比被面试官发现“进度是假的”要好。

## 推荐规格

| 项 | 建议 | 说明 |
|---|---|---|
| CPU / 内存 | **4 核 / 8 GB** 起步 | compose 上限相加已接近 5.75 GB，2C4G 容易 OOM |
| 系统盘 | 40–50 GB | 系统 + Docker 镜像 + 日志 |
| 数据盘 | 40–80 GB | 媒体、PG 数据、日志；不要和系统盘混用 |
| 带宽 | 5 Mbps 起 | 只影响视频播放体验；纯 API 流量很小 |
| 系统 | Ubuntu 22.04 / 24.04 LTS | Docker Engine + Compose v2.24+ |
| GPU | **不需要** | 演示不做真实 Whisper 转写；有 GPU 也不要在 demo 里开 |

不报具体价格：腾讯云轻量/云服务器价格随活动和地域变化，按当天控制台为准。

## 云上跑什么

```text
浏览器
  └─ 80 / 443 ─ Nginx + 前端容器
        └─ /api ─ FastAPI（127.0.0.1:12402）
              ├─ PostgreSQL 17 + pgvector（127.0.0.1:12502）
              ├─ Redis（127.0.0.1:12602）
              └─ Worker（可选，演示任务状态时启动）
```

- 前端和 API 是必须的；PostgreSQL 是必须的。
- Redis 用于缓存、配额和任务状态；即使不跑 worker，也建议启动。
- Worker 只在“任务中心”演示时启动；没有真实转写任务时，它只消费演示任务。
- `embedding` profile 默认不启动。演示不建新向量，就不要开；开了也只是增加内存压力。

## 部署步骤

### 1. 基础环境

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
# 按 Docker 官方文档安装 Docker Engine + Compose plugin
docker --version
docker compose version
```

要求 Compose v2.24+：`docker-compose.tencent.yml` 使用了 `!reset` 覆盖语法。

### 2. 拉代码与配置

```bash
git clone <你的仓库地址> p2-siteyeb
cd p2-siteyeb
cp .env.example .env
```

至少改这几项：

```dotenv
# 必改：换成随机长串，不要用示例值
JWT_SECRET=<随机 64 位以上字符串>

# 公网演示必须关闭注册
ALLOW_REGISTRATION=false

# 只允许你的演示域名 / 本机访问
CORS_ORIGINS=https://demo.example.com,http://localhost

# 演示环境不要开本地 embedding profile
# EMBEDDING_BASE_URL 指向外部可用服务，或保持默认不调用
```

不要把 `.env` 提交到仓库；不要把 `JWT_SECRET` 贴到演示脚本或截图里。

### 3. 启动

```bash
docker compose -f docker-compose.yml -f docker-compose.tencent.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.tencent.yml ps
```

首次启动 backend 会做迁移和健康检查；看日志确认：

```bash
docker compose logs -f backend
curl -s http://127.0.0.1/api/health
```

前端入口：`http://<云主机公网 IP>/`。安全组只放行 80/443；不要放行 12402、12502、12602。

### 4. 建演示账号

- 注册默认关闭，先在服务器上临时把 `ALLOW_REGISTRATION=true` 建一个 `demo` 账号，建完立即改回 `false` 并重启 backend。
- 或者用现有 `demo` 账号的密码登录；不要把管理员账号给观众。
- 演示账号只放演示数据，不放你的真实笔记、真实聊天记录。

## 演示数据包（不要上传 1.57TB 主库）

在服务器项目根目录建一个 `demo_data/`，控制在 **200MB 以内**：

```text
demo_data/
├── manifest.json              # 6 条视频 + 3 条转译样例的索引
├── videos/
│   ├── 01-agent.mp4           # 1–3 分钟，小体积
│   ├── 02-rag.mp4
│   ├── 03-fastapi.mp4
│   ├── 04-python.mp4
│   ├── 05-llm.mp4
│   └── 06-react.mp4
├── transcripts/
│   ├── 01-agent.json          # 预生成字幕（含时间戳）
│   └── ...
└── translations/
    ├── 01-agent.zh-en.json    # 预生成“AI 转译”结果
    └── ...
```

原则：

1. **只放 6 条短视频**，覆盖 Agent / RAG / FastAPI / Python / LLM / 前端六个主题，刚好对应现有 `demo/` 六组素材。
2. 视频行可以手工插入 `videos` 表，或复用 `backend/scripts/build_demo_library.py` 的思路；但不要把 1.57TB 媒体库同步上云。
3. 预生成字幕/转译结果存 JSON；前端展示时加 `demo` 标记，避免被当成实时结果。
4. 任务进度用固定时间轴模拟：`queued → extracting → transcribing → translating → finished`，每步 1–2 秒；不要调用真实 Whisper。
5. 学习路径/待办/笔记用演示账号手工建 1 条路径 + 3 条笔记即可，不要 seed 8,000 条模板笔记。

如果已有 `backend/scripts/seed_demo_watch.py`，只在“演示库里有对应视频行”时使用；它会写 `demo-` 前缀的观看事件，方便清理：

```bash
docker compose exec backend python scripts/seed_demo_watch.py
# 清理：
docker compose exec backend python scripts/seed_demo_watch.py --clean
```

## 演示流程（5 分钟版）

1. **工作台**：29 个页面、5 个 dashboard 插件、右侧小助手。
2. **IT视频站**：6 条演示视频，标题/文件夹/字幕状态；搜索一个词，展示真实检索结果。
3. **学习路径**：一条 3–5 步的路径，每一步绑定演示视频；不要伪造 7 步全完成。
4. **聊天历史**：标题 + `#id` + 条数 + 时间；说明真实账号有 100+ 会话时也能找回来。
5. **任务中心**：触发一个演示任务，展示 `queued → started → finished`；明确说“这是预置任务，不是真实 GPU 转写”。
6. **边界**：腾讯云这台只负责界面和主链路；真实转写需要 GPU/更长的离线任务。

完整逐字稿见 [demo/demo-script.md](demo/demo-script.md)。

## 演示前检查清单

- [ ] `docker compose ps` 五个服务 healthy（或至少 frontend/backend/postgres/redis）。
- [ ] `curl http://127.0.0.1/api/health` 返回 200。
- [ ] 公网 80/443 可访问；12402/12502/12602 没有对公网开放。
- [ ] `ALLOW_REGISTRATION=false`，`JWT_SECRET` 不是示例值。
- [ ] `demo` 账号能登录；没有真实个人数据。
- [ ] `demo_data/` 里 6 条视频都能播放；字幕/转译 JSON 可读。
- [ ] 任务中心没有历史错误任务；如果有，先清掉或准备解释。
- [ ] 断网演练：外部 LLM 不可达时，页面能给出降级提示，不白屏。
- [ ] 浏览器只留演示标签；关闭微信/邮件/终端密钥。

## 不要声称的能力

- “真实 GPU 转写” → 没有；演示是预生成。
- “公网多租户已加固” → 没有；这是单机 demo。
- “完整 API 集成测试” → 没有；见 [demo/evaluation.md](demo/evaluation.md)。
- “腾讯云生产 Ready” → 不是；这是轻量演示环境。
- “1.4 万条视频都上传了” → 没有；只上传 6 条演示视频。

## 故障兜底

| 现象 | 先查 | 处理 |
|---|---|---|
| 502 / 空白页 | `docker compose ps`、`logs frontend` | backend 没起或迁移失败；看 backend 日志 |
| 登录页循环 | Cookie 域 / HTTPS / CORS | 用同源域名访问；确认 `CORS_ORIGINS` 含当前 origin |
| 视频 404 | `demo_data/videos` 挂载路径 | 检查 compose volume 和 `videos.filepath` |
| 任务一直 queued | worker 是否启动、Redis 是否健康 | 启动 worker；看 `sync_db_queue_to_rq` 日志 |
| 内存打满 | `docker stats` | 降 `BACKEND_MEM_LIMIT`、不启动 embedding、减少并发 |
| 外部模型 401/超时 | `.env` 的 base URL / key | 演示前切到预生成回答或备用模型 |

## 相关文档

- [docs/deploy-tencent.md](deploy-tencent.md)：覆盖层、配额、embedding 的完整说明。
- [docs/demo/architecture-demo.html](demo/architecture-demo.html)：演示时打开的架构页。
- [docs/demo/demo-script.md](demo/demo-script.md)：5/8 分钟逐字稿。
- [docs/demo/evaluation.md](demo/evaluation.md)：测试结果与边界。
