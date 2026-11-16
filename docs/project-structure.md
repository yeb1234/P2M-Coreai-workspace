# 项目结构规整方案

> **结论（2026-11-16 决定）：不做。**
>
> 这是个人项目、早期阶段，目录乱一点的代价远小于重构的风险：
> 39 个 service 文件全平铺确实不好看，但所有 import 都是平的，
> 找东西靠 grep 完全够用。真要做，收益是「三个月后自己少翻几个目录」，
> 成本是一次动几十处 import + 一轮完整回归。
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

## 一、现状

```
backend/app/
├── agents/          chat_agent / plan_agent / tools          ← agent 逻辑在这，合理
├── core/            errors / observability                    ← 合理
├── routers/         各 API 模块                                ← 合理
├── services/        39 个 .py 全部平铺 ← 主要问题
├── utils/           通用工具                                  ← 合理
├── models.py        所有 ORM 模型（单文件）
├── schemas.py       所有 Pydantic 模型（单文件）
├── database.py      配置 + 引擎
└── worker.py        RQ worker 入口

prompts/
└── clientPrompts.ts 前端提示词（意图模板、系统提示词）

src/                 前端（Vite + React）
tests/               前端契约测试
backend/tests/       后端 pytest（只有 3 个文件）
docs/                设计文档（已有 20+ 篇）
scripts/             运维/验证脚本
```

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
hybrid_search.py   top_k=6 / candidate_k=15 或 30 / vector_score >= 0.5 / RRF k
lexical.py         limit / max_df / min_specific_df
retrieval_meta.py  META_LEVELS=3 / 各种阈值
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

这一步必须单独一个 commit，且改完跑完整回归（前端 222 + 后端 verify_fixes + 检索实测）。

### 第 4 步：测试与产物分离（低风险）

- `backend/tests/` → `tests/backend/`，同步改 CI / 文档里的路径
- `tests/` 下的前端契约测试 → `tests/frontend/`
- `backups/ shots/ test-results/ data/` → `var/`，更新 `.gitignore`

### 第 5 步：建 `tests/eval/`（新增，不是搬迁）

用户明确提到要「eval」。建议放三类离线评测：

| 文件 | 评什么 | 数据来源 |
|---|---|---|
| `retrieval_cases.json` | 检索：给定 query，期望 top5 含某个 video_id | 从真实失败案例攒（如「什么是GC算法」→ 必须命中「3、什么是GC算法」） |
| `intent_cases.json` | 意图识别：query → 期望意图 | 现有 `chatIntent.test.ts` 的 19 条可以搬过来 |
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
