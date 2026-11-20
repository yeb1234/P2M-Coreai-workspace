# P2 Lite Demo

一套独立于正式 Lite 的演示环境，用来给面试官、客户或朋友看“页面 + 数据 + 写动作”都能跑，不是只有登录页和空壳。

## 入口与账号

- 前端：`http://127.0.0.1:12306`
- API：`http://127.0.0.1:12706`（一般不用直接打开）
- 登录页已自动填充：`demo / P2Demo2026`
- 演示账号是 demo 库管理员，只影响 `db_p2_demo`

## 带哪些演示数据

| 类型 | 数量 | 内容 |
| --- | --- | --- |
| 便签 | 6 | FDE 叙事、RAG 召回、LangGraph 恢复、FastAPI、面试反馈、Demo 清单 |
| Markdown 笔记 | 5 | 演示脚本、B-4-1 答题骨架、RAGAS、FDE 交付流程、Redis 隔离 |
| 待办 | 6 | 今日 3 条、明日 1 条、过期 1 条、昨日完成 1 条 |
| 日历事件 | 6 | 今日晨会/彩排/模拟面试，明日导师复盘，+2 投递，+4 周复盘；番茄记录还会在日历里映射出专注块 |
| 番茄历史 | 4 | 今日 3 个 + 昨日 1 个，工作台显示 3 个今日番茄 |
| 面试记录 | 4 | 82 / 76 / 91 / 68 分，平均约 79 分 |
| AI 会话 | 2 | 近期学习复盘、Lite 演示讲解 |

每次执行 seed 都会把这些数据恢复成同一份状态。

## 产品展示页

Demo 导航多一个“产品线”分组，三个页面都是静态演示，不接 Lite 后端：

- `#/video-preview`：从 P2 Media 截出的两层 Mock。先搜字幕/标题，点结果进静态观看页；播放按钮只提示“静态观看页，不加载真实视频流”。
- `#/media`：介绍真实 Media 的 14,380 个视频、566 万条字幕段与三路召回/重排链路，以及 `search_videos` 等 Agent 工具给出的带证据学习建议。
- `#/transcribe`：介绍 P2 Transcribe 的 12703 控制台、扫描 → 转写 → 总结/向量管线、管理升级与 AI 检测类扩展方向；扫描/暂停按钮只弹 toast。

这三个入口只在 Lite profile 注册；完整版 Media / Transcribe 不重复挂演示页。

## 和正式 Lite 的隔离

| 维度 | 正式 Lite | Lite Demo |
| --- | --- | --- |
| 数据库 | `db_p2` | `db_p2_demo` |
| Redis | DB 1 / `p2:` | DB 5 / `p2demo:` |
| 登录 Cookie | `p2m_session` | `p2m_demo_session` |
| 后端主机名 | `backend` | `demo-backend` |
| 前端端口 | 12305 | 12306 |
| API 端口 | 12705 | 12706 |

共享网络里多个项目都有 `backend` 服务，Docker DNS 会轮询；demo 的 nginx 配置在构建时替换成 `demo-backend:8000`，不会串到正式 Lite。

## 启动

前置：`p2-shared` 网络和 `shared-postgres` 已运行，demo 库已创建。

```powershell
Set-Location C:\SiteYeb
docker compose --env-file infra/lite-demo/.env `
  -f infra/lite-demo/docker-compose.yml up -d demo-backend frontend
docker compose --env-file infra/lite-demo/.env `
  -f infra/lite-demo/docker-compose.yml run --rm seed
```

首次在新机器上部署时，先建库：

```powershell
powershell -ExecutionPolicy Bypass -File infra/lite-demo/provision_db.ps1
```

## 重置 / 重建 / 停止

```powershell
# 只重置数据
docker compose --env-file infra/lite-demo/.env `
  -f infra/lite-demo/docker-compose.yml run --rm seed

# 重建 demo 前端（改了登录页或前端代码时）
docker compose --env-file infra/lite-demo/.env `
  -f infra/lite-demo/docker-compose.yml build frontend
docker compose --env-file infra/lite-demo/.env `
  -f infra/lite-demo/docker-compose.yml up -d --force-recreate frontend

# 停止容器，保留 demo 库
docker compose --env-file infra/lite-demo/.env `
  -f infra/lite-demo/docker-compose.yml down --remove-orphans
```

## 注意

- 登录密码会通过 `VITE_DEMO_PASSWORD` 写进 demo 前端 JS。这是演示账号的预期行为；不要把 demo 镜像当成正式站部署。
- `.env` 含数据库、Redis、JWT 和 LLM 密钥，已被仓库 `.env` 规则忽略；只提交 `.env.example`。
- demo 账号是 `admin`，可以打开设置页和健康检查。要对外开放演示时，至少先把 seed 脚本改成只读、或换一个独立无敏感权限的账号。
