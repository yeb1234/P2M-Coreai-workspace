# 项目结构规整方案

> 状态：部分现行（最后校对 2026-11-21）
>
> **2026-11-21：7.0 已执行根目录 monorepo 重构。**
> 现有结构为 `frontend/ backend/ configs/ infra/ ops/ artifacts/ data/ docs/`，
> 详见 [2026-11-21-7.0-framework-overhaul.md](2026-11-21-7.0-framework-overhaul.md)。
> 本文第一节是 6.0 旧根目录的现状留档；第二至五节关于 `backend/app/services/` 再分层的提案仍未执行。

> **结论（2026-11-16 对 services 再分层的决定）：暂不做。**
>
> 这是个人项目、早期阶段，目录乱一点的代价远小于重构的风险：
> 39 个 service 文件全平铺确实不好看，但所有 import 都是平的，
> 找东西靠 grep 完全够用。真要做，收益是「三个月后自己少翻几个目录」，
> 成本是一次动几十处 import + 一轮完整回归。
>
> 7.0 只做了根目录 monorepo，没有拆 `backend/app/services/`；那部分仍按本文件后面的顺序分批。
>
> **所以这份文档只作为可行性讨论留档**，记录「如果要整，该怎么整」。
> 等出现这些信号再考虑重启：
> - 有第二个人长期参与开发
> - services/ 超过 60 个文件
> - 出现「改一处忘了另一处」的实际事故
>
> 在那之前，下面这些分析不用管。真要做的时候，按第三节的顺序分批。
>
> ---
>
> 目标不是「看起来整齐」，是让三类东西**能被找到、能被改、能被测**：
> 提示词、检索参数、agent 逻辑。

---

## 一、现状（6.0 旧根目录留档，7.0 已按 monorepo 迁移）

```
backend/
├── alembic/          版本化迁移：env.py + versions/（2 个 revision）。
│                     与旧机制 migrations.py（create_all + ALTER IF NOT EXISTS）
│                     及 database.py 的 ensure_runtime_schema 并存，未全部迁到 alembic
├── app/
│   ├── agents/      chat_agent / plan_agent / tools          ← agent 逻辑在这，合理
│   ├── core/        csrf / errors / observability            ← 合理
│   ├── routers/     14 个 API 模块（口径：main.py 里 include_router 计数）
│   ├── services/    39 个已跟踪 .py 全部平铺 ← 主要问题（口径：services/ 下非 __init__ 计数；
│                     另有未提交的 daily_digest.py 属进行中工作流，未计入）
│   ├── utils/       files / paths / serialization / textclean
│   ├── models.py    21 个 ORM 模型（单文件，口径：models.py 里 __tablename__ 计数）
│   ├── schemas.py   所有 Pydantic 模型（单文件）
│   ├── tables.py    content_chunks 等向量表 DDL 的唯一来源
│   ├── migrations.py 旧机制：create_all + ALTER IF NOT EXISTS（含 SQLite 回滚分支）
│   ├── database.py  配置 + 引擎 + ensure_runtime_schema
│   ├── auth.py      密码哈希 / 令牌 / 鉴权依赖
│   ├── main.py      FastAPI 入口 + 中间件 + 路由注册
│   └── worker.py    RQ SimpleWorker（ai_jobs + background 两个队列）
├── scripts/         一次性运维/回填脚本（verify_fixes.py、test_multi_user.py 等）
├── tests/           后端测试 5 个 .py（非 pytest 套件，混用 unittest 与裸 test_* 函数）
└── static/

prompts/
├── clientPrompts.ts  前端提示词（意图模板、系统提示词、意图识别正则）
└── runtime_prompts.py 运行时可改的提示词（Python 文件放在前端 prompts 目录）

src/                  前端（Vite 8 + React 19 + TS 6，HashRouter）
├── components/      页面/模块目录（32 个一级子目录，口径：src/components/ 下一级目录计数）
├── config/          pageRegistry.tsx（29 个注册页面）/ features.ts（功能开关）
├── hooks/          12 个 use* hook（index.ts 只 re-export useCrossModuleSync）；
│                    另有 13 个 use* hook 内聚在 src/components/video/ 下
├── lib/             API 客户端、工具函数；projections/ 为工作台投影派生（进行中）
├── plugins/         工作台插件 5 个（registry.ts + registerAllPlugins）
├── stores/          12 个 zustand store（口径：stores/ 下非 index 计数）
├── types/           类型定义
├── assets/          静态资源
└── __tests__/       前端单元测试 28 个文件（口径：src/__tests__ 下 *.test.ts(x)）

tests/                前端测试：contracts/（契约回归）+ e2e/（Playwright 规格）
docs/                 设计文档（37 篇 .md）
scripts/              运维/验证脚本（.sh / .cjs / .mjs）
```

> 进行中说明：`src/lib/projections/`、`src/hooks/useDashboardProjectionRefresh.ts`、
> `src/plugins/` 属另一条正在做的「工作台首页插件 + 投影同步」工作流（截至 2026-11-16
> 尚未提交）。目录已存在，但功能状态为进行中，不按稳定 API 描述。

> 功能开关（2026-11-16）：`features.ts` 里 `FEATURES.chatVideoReferences = false`，
> 「相关片段」卡片默认不渲染；`ReferenceBlock`、`dedupeReferences` 与后端 references
> 生成均保留，改回 `true` 重建前端即恢复。后端仍生成、前端不展示。

### 四个具体问题

**1. `services/` 39 个文件平铺，看不出领域边界**

现在按文件名首字母排，`ai_jobs.py` 和 `admin_ai_queue.py` 挨着，
但它们一个是「任务编排」、一个是「队列管理」，改一个要读另一个。
新人（或三个月后的自己）打开这个目录无从下手。

可以按职责聚成 6 组：

| 分组 | 现在散落的文件 |
|---|---|
| `transcribe/` | `transcribe_whisper` `subtitle_writer` `subtitle_corrector` `ffmpeg_audio` `chunker` `write_md` `ollama_summarize` |
| `retrieval/` | `hybrid_search` `lexical` `vector_store` `embeddings` `embedding_pipeline` `rerank_client` `retrieval_meta` |
| `jobs/` | `ai_jobs` `ai_job_tasks` `ai_job_rules` `admin_ai_queue` `rq_client` `background_tasks` `background_handlers` `thumbnail_worker` `sprite` |
| `chat/` | `llm` `llm_client` `memory` `memory_extract` `prompts` `quota` `rate_limit` `journey` `learning_context` `profile` |
| `library/` | `file_scanner` `video_serialization` `admin_library` |
| `admin/` | `admin_health` `admin_settings` |

**2. 提示词散在三处，改一处不知道还有没有别处生效**

- 前端：`prompts/clientPrompts.ts` —— 6 个意图模板 + 系统提示词 + 意图识别正则
- 后端：`backend/app/services/prompts.py` —— 转写校正、总结
- 后端：`prompts/runtime_prompts.py` —— 运行时可改的提示词（在 backend 目录之外的 `prompts/` 里！）

第三种最隐蔽：一个 Python 文件放在前端的 `prompts/` 目录里。改提示词的人不会去那里找。

**3. 检索参数散在 5 个文件里，调一个要全局 grep**

现在这些魔数各写各的：

```
hybrid_search.py   top_k / candidate_k=30 / 三路权重 lexical 0.8·vector 1.2·meta 1.5 / RRF_K=60 / rerank_top_n=20
lexical.py         limit / max_df / min_specific_df
retrieval_meta.py  META_LEVELS=3 / 各种阈值；rerank_min_score=0.02（database.py:93）
embedding_pipeline.py  SCAN_BATCH / SCAN_INTERVAL_SECONDS
rq_client.py       AI_JOB_TIMEOUT_SECONDS / 三个倍率
database.py        whisper_cpu_threads 等
```

调检索效果时要在这些文件之间跳，还容易漏（比如改了 hybrid_search 的阈值，
忘了 lexical 也有一个）。

**4. 测试与临时产物混在根目录**

`tests/`（前端）、`backend/tests/`（后端）、`test-results/`（Playwright 产物）、
`shots/`（截图）、`backups/`（db 备份 1.7GB）、`demo/`、`data/` 平级并列。
前三个是代码，后四个是产物，该分开。

---

## 二、目标结构

```
backend/app/
├── agents/              不变
├── core/                不变
├── routers/             不变
├── config/
│   ├── prompts/
│   │   ├── chat.py          意图模板 / 系统提示词（与前端保持同步）
│   │   ├── subtitle.py      字幕校正
│   │   └── summarize.py     总结
│   └── retrieval.py         ★ 所有检索参数的唯一来源
├── services/
│   ├── transcribe/      见上表
│   ├── retrieval/
│   ├── jobs/
│   ├── chat/
│   ├── library/
│   └── admin/
├── utils/
└── ...

tests/
├── frontend/            前端契约测试
├── backend/             后端 pytest（从 backend/tests 移过来）
└── eval/                ★ 检索/意图的离线评测集

var/                     ★ 所有运行时产物（加进 .gitignore）
├── backups/
├── shots/
└── test-results/
```

---

## 三、迁移顺序（每步独立可回滚）

### 第 1 步：检索参数集中（风险低，收益最高）

新建 `backend/app/config/retrieval.py`，把散落的参数搬进来并**保留原地的
re-export**（`from app.config.retrieval import TOP_K`），这样调用方一行都不用改。

```python
# backend/app/config/retrieval.py
TOP_K = 6                    # 最终返回条数
CANDIDATE_K = 30             # 候选池（重排前）
VECTOR_MIN_SCORE = 0.5       # 低于此值视为「词面沾边」
RRF_K = 60
META_LEVELS = 3
META_CHANNEL_LIMIT = 30
...
```

为什么先做这个：改它只影响数字，不影响控制流；re-export 保底，出问题一行回滚。

### 第 2 步：提示词归位（中风险）

把 `prompts/runtime_prompts.py` 移进 `backend/app/config/prompts/runtime.py`，
`backend/app/services/prompts.py` 拆分到 `config/prompts/`。
所有引用点保留一个薄封装（`services/prompts.py` 继续作为门面 re-export），
避免一次性改 20 个 import。

### 第 3 步：`services/` 分组（较高风险，最后做）

按上面的 6 组移动，**每个子目录加 `__init__.py` 并 re-export 原有符号**，
这样 `from app.services.hybrid_search import hybrid_search` 依然能用。
等所有 import 都改成新路径后，再删 re-export。

这一步必须单独一个 commit，且改完跑完整回归（前端 vitest：`src/__tests__` 28 个文件 + `tests/contracts` 1 个；后端 `backend/scripts/verify_fixes.py`；检索实测）。

### 第 4 步：测试与产物分离（低风险）

- `backend/tests/` → `tests/backend/`，同步改 CI / 文档里的路径
- `tests/` 下的前端契约测试 → `tests/frontend/`
- `backups/ shots/ test-results/ data/` → `var/`，更新 `.gitignore`

### 第 5 步：建 `tests/eval/`（新增，不是搬迁）

用户明确提到要「eval」。建议放三类离线评测：

| 文件 | 评什么 | 数据来源 |
|---|---|---|
| `retrieval_cases.json` | 检索：给定 query，期望 top5 含某个 video_id | 从真实失败案例攒（如「什么是GC算法」→ 必须命中「3、什么是GC算法」） |
| `intent_cases.json` | 意图识别：query → 期望意图 | 现有 `chatIntent.test.ts` 的 18 条 case 可以搬过来 |
| `prompt_regression.md` | 提示词改动的对照记录 | 每次改提示词记「改了什么 / 为什么 / 哪条 case 变好变差」 |

评测跑法建议做成一个脚本 `scripts/eval_retrieval.py`，输出命中率和回归项。

---

## 四、不建议现在做的

- **把 `models.py` / `schemas.py` 拆成包**。文件大（models 400+ 行），但所有
  import 都是 `from app.models import Video`，拆包要动几百处。收益是"看起来整齐"，
  不值得。
- **前端目录重排**。`src/components/` 已经按页面分组了，没必要再动。
- **一次性全搬**。前面说了，22 个文件有未提交改动时动目录会毁掉所有并行工作。

---

## 五、执行前检查清单

- [ ] 所有并行改动已提交，工作区干净
- [ ] `git tag pre-restructure` 打标签（整批回滚用）
- [ ] 每一步单独 commit，提交信息写清「移动了什么 / 保留了什么 re-export」
- [ ] 每步之后：`npx tsc --noEmit` + `npx vitest run` + 后端导入检查 + `/health`
- [ ] 第 3 步之后额外跑：检索实测（3 个已知查询）+ 任务中心冒烟
