"""个人项目题与项目进度文章。

这些题只讲本机真实存在、且当前能拿出证据的项目；统一用 source=个人项目、
resumeGroup=personal-project 和旧的项目档案题区分开。
"""

from __future__ import annotations

from pathlib import Path
from textwrap import dedent

PERSONAL_SOURCE = "个人项目"
PERSONAL_RESUME_GROUP = "personal-project"
PERSONAL_RESUME_LABEL = "个人项目题 · 当前进度"
PERSONAL_CHAPTER = "个人项目 · 进度复盘"


def _q(
    qid: str,
    group: str,
    group_label: str,
    title: str,
    question: str,
    answer: str,
    follow_ups: list[str],
    rubric: list[str],
    tags: list[str],
    difficulty: str = "压轴",
) -> dict:
    return {
        "id": qid,
        "group": group,
        "groupLabel": group_label,
        "resumeGroup": PERSONAL_RESUME_GROUP,
        "resumeGroupLabel": PERSONAL_RESUME_LABEL,
        "type": "project",
        "difficulty": difficulty,
        "source": PERSONAL_SOURCE,
        "bookId": None,
        "bookPage": None,
        "chapter": PERSONAL_CHAPTER,
        "title": title,
        "question": question,
        "answer": dedent(answer).strip(),
        "followUps": follow_ups,
        "rubric": rubric,
        "tags": ["个人项目", *tags],
    }


PERSONAL_QUESTIONS: list[dict] = [
    _q(
        "X-MINE-01",
        "backend",
        "底层底座组",
        "个人项目：P2 题库从 964KB 单包到按需加载",
        "P2 站点有几百道题、十几篇知识库、项目档案和 AI 面试评估。早期题库 JSON 约 964KB，面试页一打开就慢。现在要改成「列表只拿摘要、详情按需取、热点走 Redis」。请讲清接口拆分、缓存键与失效、前端加载和回退。",
        """
        # 先给结论

        题库慢不是「题太多」，而是把答案、追问、评分点全塞进了首屏 payload。

        ## 1. 数据层：summary / detail 分离

        - `questions.json` 是构建期真源，不直接同步进首屏。
        - 列表接口只返回 `id / title / group / type / difficulty / source / tags` 等轻字段。
        - 详情接口才返回 `answer / followUps / rubric`。

        ## 2. 接口层

        ```
        GET /api/interview/questions?limit=60&offset=0   # 摘要
        GET /api/interview/questions/{question_id}       # 详情
        GET /api/interview/meta                          # 分组/来源/题型计数
        ```

        分页必须带 `total`，前端不要假设一次能拿 400 道。

        ## 3. 缓存层

        - Redis key：`interview:library:v1:page:{offset}:{limit}`。
        - meta 键单独放，TTL 可以比列表长。
        - key 里带 `data_version`（题库文件 hash 或构建版本），不要只靠 TTL；题库更新后旧 key 自然失效。
        - 读穿缓存 + singleflight，防止 Redis miss 时几十个请求一起打 JSON。
        - Redis 不可用时直接读本地 JSON，接口仍可用，只是 P95 变差。

        ## 4. 前端

        - 题库页只请求摘要；打开题目抽屉再请求详情。
        - MockInterview 需要的完整题目走独立懒加载 chunk，不和首屏共享。
        - 详情请求带 `AbortController`；快速切题时取消上一个请求。
        - 加载失败给重试，不把空列表渲染成「这题不存在」。

        ## 5. 指标与边界

        - 首屏 JS gzip、题库接口 P95、缓存命中率、详情失败率、TBT/TTI。
        - 不要拿「本地 Redis 命中 99%」当生产结论；单机 Compose 和真实多副本缓存一致性是两件事。
        """,
        [
            "题库更新后你怎么保证 Redis 里的旧题不返回？",
            "如果列表接口一次拿 400 条，前端会有什么问题？",
        ],
        [
            "summary/detail 分离",
            "分页与计数",
            "Redis key/TTL/版本失效",
            "singleflight 与降级",
            "前端懒加载与取消",
            "有指标和边界",
        ],
        ["P2", "题库", "Redis", "按需加载"],
    ),
    _q(
        "X-MINE-02",
        "agent",
        "Agent / RAG 高阶核心组",
        "个人项目：P2 小助手 HITL 澄清与页面上下文",
        "P2 的问答助手会按页面注入上下文：题库题、知识库文章、模拟面试状态；还加了 LangGraph HITL 的 A/B/C/其它弹窗和视频推荐。请设计意图路由、中断/恢复、超时和误弹控制。",
        """
        # 先给结论

        页面上下文只负责「缩小范围」，不能替代意图判断；HITL 只在缺槽位、歧义或高风险动作时出现。

        ## 1. 意图优先级

        1. 用户在题库/知识库页明确点题：题目讲解 / 同类题优先。
        2. 在模拟面试页：评分、追问、下一步建议优先。
        3. 明确说「推荐视频」：走视频推荐工具。
        4. 其他：通用问答。

        页面上下文必须由服务端校验 `question_id / article_id` 是否存在，不能信任前端任意字符串。

        ## 2. LangGraph HITL

        - 图在调用高风险工具前 `interrupt()`，把选项和默认值写进 state。
        - `thread_id` 绑定会话与页面上下文；checkpoint 落库，刷新/断线还能恢复。
        - SSE 发 `clarify` 事件；前端渲染 A/B/C/其它；用户选择后调 `/resume`。
        - `resume` 要幂等：同一个 `interrupt_id` 重复提交只生效一次。
        - 超时走默认选项或安全终止，不能一直挂着。

        ## 3. 什么时候不该弹

        - 槽位已经齐全、动作只读、低风险：直接执行。
        - 分类置信度低于阈值且没有高风险副作用：先给最可能的答案，再补一句「如果你指的是 X，我可以继续」。
        - 同一轮最多一次澄清；连续追问会把用户逼走。

        ## 4. 视频推荐

        视频推荐是独立工具，输入是题目标签/技术点，不是整段聊天记录；没有匹配就返回空，不要硬凑。

        ## 5. 指标

        澄清触发率、恢复成功率、放弃率、误弹率、回答采纳率。误弹率要靠人工抽检，不能只看点击率。
        """,
        [
            "HITL 的 checkpoint 里应该存哪些字段？",
            "用户一直不选，超时后怎么保证不重复执行写操作？",
        ],
        [
            "页面上下文校验",
            "意图优先级",
            "interrupt/checkpoint/resume",
            "澄清触发条件",
            "视频推荐独立",
            "指标与误弹",
        ],
        ["P2", "HITL", "LangGraph", "页面上下文"],
    ),
    _q(
        "X-MINE-03",
        "agent",
        "Agent / RAG 高阶核心组",
        "个人项目：P4 等权 RRF 反而拖累向量，怎么修",
        "P4 的检索评估里，等权 RRF 的语义型 Hit@3 只有 33.3%，反而低于纯向量 66.7%。请解释原因，并讲清你如何用置信度自适应加权把它修到 66.7%，同时不伤字面型 100%。",
        """
        # 面试版回答

        ## 1. 先讲反直觉结果

        - 商品域 12 题：6 道字面型 + 6 道语义型。
        - 纯关键词：语义型 Hit@3 16.7%。
        - 纯向量：66.7%。
        - 等权 RRF：33.3%，反而比纯向量差。

        ## 2. 归因

        口语 query 的关键词 top1 分数只有 0.8~4.2，而字面/型号题是 7.4~15.0。说明语义型 query 下关键词路几乎是噪声。

        等权 RRF 隐含「两路质量相当」。噪声文档只要两路都出现，就拿到双份加成，把向量路真正相关的耳机/扩展坞挤出 Top-K；reranker 再强也看不到正确候选。

        ## 3. 修复

        ```
        conf  = clamp(kw_top1_score / 8, 0, 1)
        w_kw  = 2.0 * conf^2
        w_vec = 1.0
        score(d) = w_kw/(60+rank_kw) + w_vec/(60+rank_vec)
        ```

        关键是平方：噪声路权重趋近 0；强字面信号仍能拿 2.0 票。

        中间试过线性 `0.25 + 1.75*conf`，没有改善——只要噪声路还有 0.25 票，双份加成仍能挤掉正确候选。这一点面试时要主动讲，说明是按数据迭代，不是拍脑袋调参。

        ## 4. 结果

        - v2 语义型 Hit@3：66.7%（v1 33.3%，+33.3pp）。
        - 商品整体 Hit@3：83.3%。
        - 字面型：仍 100.0%。
        - MRR：0.792；不精排 0.694，说明 reranker 主要改善排名。
        - 延迟：混合召回约 256.8ms，精排再加 269.6ms。

        ## 5. 边界

        只有 12+8 道题，样本小；reranker 只能看 Top-K；真实生产要扩题集、做分层抽样，并把标注修订和模型提升分开报。
        """,
        [
            "为什么线性权重没有效果？",
            "如果关键词 top1 分数很高但仍然是噪声，怎么办？",
        ],
        [
            "复现反直觉结果",
            "解释双份加成",
            "置信度自适应权重",
            "平方而非线性",
            "修复前后数字",
            "样本与 reranker 边界",
        ],
        ["P4", "RRF", "检索评估", "置信度加权"],
    ),
    _q(
        "X-MINE-04",
        "backend",
        "底层底座组",
        "个人项目：P4 写操作六道关与重复写门禁",
        "P4 的退款/改单写操作要过身份、策略、二次确认、幂等、事务、审计六道关。Harness 用 retry-hardened 跑出 HARD_BLOCK:DUPLICATE_WRITE(1)，说明重试把写操作执行了两次。你怎么定位、怎么修、怎么防止回归？",
        """
        # 先给结论

        这不是「模型不听话」，是重试语义和写操作幂等没接上。写操作重试必须先有确定性幂等键，再谈重试。

        ## 1. 六道关各自管什么

        - 身份：会话/用户/订单归属，第一道关。
        - 策略：状态、金额、期限，代码判定，不让模型自由发挥。
        - 二次确认：高风险动作给确认卡，确认 token 一次性。
        - 幂等：同一业务动作只执行一次。
        - 事务：扣库存/写记录/发奖励在可控边界内。
        - 审计：只追加，记录谁在什么时候做了什么。

        ## 2. 重复写怎么发生

        典型链路：第一次工具调用已经提交成功，但响应在网络层丢了；编排层把超时当成失败，拿同一个请求重试，服务端没有识别出这是同一动作，于是执行第二次。

        ## 3. 修复

        - 幂等键由服务端生成：`tenant:user:order:action:request_id`，不能由模型自由拼。
        - 在副作用之前做唯一约束/占位；重复请求直接返回第一次结果。
        - 重试只覆盖网络错误、429、5xx；401/403/参数错误不重试。
        - 超时后先查状态，不要盲目重放。
        - 确认 token 一次性，审计记录 `idempotency_key` 和 `attempt_no`。

        ## 4. 回归

        Harness 注入「提交成功后丢响应」，断言只产生一条退款/一条改单。门禁把 `DUPLICATE_WRITE` 设为硬阻断，不靠人工看日志。

        ## 5. 指标

        重复写率、幂等命中率、写成功率、平均重试次数、审计完整率。别只报「接口 200」。
        """,
        [
            "幂等键为什么不能由模型生成？",
            "第一次请求结果没返回，客户端怎么知道该不该重试？",
        ],
        [
            "六道关职责",
            "重复写链路",
            "确定性幂等键",
            "重试分类",
            "故障注入回归",
            "硬门禁与指标",
        ],
        ["P4", "写操作", "幂等", "Harness"],
    ),
    _q(
        "X-MINE-05",
        "agent",
        "Agent / RAG 高阶核心组",
        "个人项目：P5 十万级公开检索基准怎么读",
        "P5 用 CmedqaRetrieval 10 万 passage、3999 query 做公开检索基准。测试集结果：BM25 nDCG@10 16.29%，bge-m3 33.93%，加权 RRF 31.98% 反而更低。你怎么解释、怎么调参、怎么避免拿调参集数字自欺？",
        """
        # 面试版回答

        ## 1. 数据集与切分

        - CmedqaRetrieval：100,001 passage / 3,999 query / 7,449 相关性对。
        - 按 query-id 哈希切：调参集 2,429，测试集 1,570。
        - 参数只在调参集选；最终数字只报测试集。

        ## 2. 基线结果

        | 配置 | nDCG@10 | Recall@10 |
        | --- | --- | --- |
        | BM25，词项预算 100 | 16.29% | 19.73% |
        | bge-m3 向量 | 33.93% | 42.93% |
        | 加权 RRF w=0.85 | 31.98% | 41.84% |

        结论：在这个中文医疗问答集上，词法路不是「锦上添花」，而是拖后腿；融合权重扫完仍然不融合更好。

        ## 3. 工程坑

        - 倒排项原用 `list[tuple]`，1800 万项约 1GB；改 `array('i')` 平铺后约 120MB。
        - 每条 query 只取 df 最小的 N 项计分，否则全扫几十亿次迭代跑不完。
        - 排序键从「仅 df」改成 `(df, 词项)` 全序；否则 Python 哈希种子变化会让同一份数据跑出 0.1098 / 0.1105 两个 nDCG。
        - 429 给 13 次退避（封顶 30s），5xx 只给 8s；并发从 4 降到 2，避免重试打满。
        - 重排分数按 query+候选原文哈希缓存；候选变了自然 miss。

        ## 4. 怎么讲边界

        这是公开数据集，不等于业务分布；embedding 供应商和中文医疗领域都有偏移。10 万条不是生产全量，不能直接说「线上召回 34%」。

        面试官追问「为什么 RRF 负收益」时，答「词法噪声在语义 query 上被双份加成」，比背公式更加分。
        """,
        [
            "调参集和测试集为什么要按 query 切，不按 passage 切？",
            "如果业务 query 里型号/参数词很多，RRF 结论会变吗？",
        ],
        [
            "数据规模与切分",
            "基线对比",
            "RRF 负收益解释",
            "BM25 三个工程坑",
            "限流与缓存",
            "公开集边界",
        ],
        ["P5", "检索基准", "BM25", "bge-m3", "RRF"],
    ),
    _q(
        "X-MINE-06",
        "agent",
        "Agent / RAG 高阶核心组",
        "个人项目：P5 知识新鲜度与事实冲突",
        "P5 企业知识库里，同一主题有旧文档、新文档和两个来源冲突，权限还按部门/ACL 不同。你怎么把时间衰减、valid_from/expires_at、scope 适用性、冲突裁决和权限前置过滤串成一条检索链路？",
        """
        # 一条链路

        `ACL 前置过滤 → 候选召回 → 新鲜度/适用性 → RRF/重排 → claim 冲突检测 → 带证据生成`

        ## 1. 权限先于召回

        租户/部门/显式 ACL 在召回前过滤，不能先拿全量再在 prompt 里删。片段级 ACL 预留，但当前别假装已做完。

        ## 2. 新鲜度不是简单加时间权重

        - `0.5^(年龄/半衰期)` 做时间衰减。
        - `valid_from` / `expires_at` / `scope` 做适用性门控：过期、未生效、不适用当前部门的文档不能进上下文。
        - 过期三档：硬过期不召回、软过期降权并标注、待确认进人工队列。

        ## 3. 冲突检测

        - claim 级抽取，不整篇比对。
        - 每个 claim 留 `EvidenceRecord`：来源、时间、片段、置信度。
        - 冲突图按簇裁决；能共存的观点不强行统一，输出「来源 A 说…，来源 B 说…」。
        - 低置信度明确说「未找到足够依据」，不要编一个折中答案。

        ## 4. 生成与追溯

        引用回到页码/片段；版本快照不可变；行级 diff 和追加式回滚；`trace_id` 串起检索、重排、生成。

        ## 5. 指标

        stale hit rate、ACL leak（目标 0）、冲突 precision/recall、引用可回溯率、拒答准确率。别只报「回答看起来不错」。
        """,
        [
            "时间衰减和 scope 门控冲突时谁优先？",
            "两个来源都权威但结论相反，最终答案怎么写？",
        ],
        [
            "ACL 前置",
            "时间衰减与适用性",
            "过期三档",
            "claim/evidence 冲突",
            "引用与版本",
            "指标与拒答",
        ],
        ["P5", "知识治理", "ACL", "冲突检测"],
    ),
    _q(
        "X-MINE-07",
        "delivery",
        "交付 & 封装形态组",
        "个人项目：P6 视频管线为什么先做档 0 基线",
        "P6 的视频管线有 mock/Wan/Ark，为什么先做 0 成本的档 0 基线？如果要把「一个素材位一个产物」改成多模型候选集，Take、成本和可复现怎么设计？",
        """
        # 先给结论

        基线不是「省钱版」，它是可复现、可离线、可回归的参照系；AI 镜头只替换 1~2 个镜头位，不另起一条产线。

        ## 1. 档 0 基线

        - 商品图 + 运动 + 字幕 + 配音，0 元。
        - 同一份 SKU JSON 跑两次结果一致，才能做评测取证。
        - 断网能演示，不押第三方可用性。
        - 改文案时 diff 只发生在该变的地方。

        ## 2. AI 增量

        - provider：`mock` / `wan` / `ark`，统一 `submit → poll → fetch`。
        - `verified=False` 是刻意的：没在真实账户跑通，不许对外说「支持」。
        - 素材收口：sha256 前 12 位做 asset_id，登记 source / parents，镜头从哪来、谁生成、什么参数都可查。

        ## 3. 候选集与 Take

        - 原子单位从「任务」降为 `(slot, provider, model, prompt, params, seed)`。
        - 同一 slot 同层并行提交 N 个候选；异步位独立轮询、独立失败。
        - `Take` 是唯一真相：谁选的、什么时候、为什么；渲染只认 Take，不认「最新」或「第一个成功」。
        - 预算闸门放在提交前；成本 = 镜头数 × 候选数 × 单价（按分辨率/秒），重试系数 1.3。

        ## 4. 现状边界

        `docs/04-素材候选与并行生成.md` 是设计稿；当前 `gen.py` 仍是单候选串行，Wan/Ark 适配器未实测。面试里要明确说「设计已定、代码未落」，不能把设计稿讲成已上线。

        ## 5. 指标

        单条成本、候选采纳率、Take 返工率、P95 生成时延、失败重试率、可复现率。
        """,
        [
            "Take 为什么不能直接选成本最低的那条？",
            "多候选并行后，429 怎么不拖垮同批其他候选？",
        ],
        [
            "档 0 基线价值",
            "provider 与 verified",
            "素材收口/审计",
            "候选集与 Take",
            "预算与成本",
            "设计 vs 实现边界",
        ],
        ["P6", "视频管线", "候选集", "成本控制"],
    ),
    _q(
        "X-MINE-08",
        "delivery",
        "交付 & 封装形态组",
        "个人项目：P7 Agent Harness 的发布门禁",
        "P7 Harness 把 8 个项目接入同一套 Golden Set，输出 PASS/WARN/BLOCK/APPROVAL/ROLLBACK。门禁应该怎么分层？p4 的 duplicate write 和 p5 的 cost-opt 为什么都被 BLOCK，而 p2/p6 能 PASS？",
        """
        # 先给结论

        门禁不是「分数低于 60 就拦」，而是硬事实 → 阈值 → 基线对比 → 人工审批四层。

        ## 1. 四层判定

        1. **硬事实**：重复写、ACL 泄露、密钥/权限越界，命中直接 BLOCK，不看平均分。
        2. **阈值**： correctness、延迟、成本超过预设阈值 → WARN/BLOCK。
        3. **基线对比**：同项目、同套件、同参数配对比较，防止「这次分数高只是因为题简单」。
        4. **人工审批**：WARN 必须 Owner 复核；高风险变更走 APPROVAL。

        ## 2. 两个 BLOCK 的差别

        - p4 `retry-hardened`：`HARD_BLOCK:DUPLICATE_WRITE(1)`，重试把写操作执行两次。这是硬事实，不是分数问题。
        - p5 `cost-opt`：correctness 0.548、回退 −0.452，成本优化损害上下文完整性，属于质量回退超阈值。

        ## 3. 为什么 p2/p6 能 PASS

        - p2 `model-lite`：11/11（候选套件；基线 12/12），没有硬事实，质量在允许范围。
        - p6 `timeout-bump`：10/10，放宽超时没有引入副作用。

        这证明门禁不是「一律拦截」；PASS 也有证据包。

        ## 4. 证据链

        每次 run 留：项目 spec/commit、Golden Set 版本、trace、指标、diff、失败样本、门禁决策。能重放，才叫可复现。

        ## 5. 边界

        当前单机，部分 adapter 是 simulated；8 个 connected，P8 还在 onboarding，P3/ZB02 在 backlog。不要把「接入 8 个」说成「生产 CI 覆盖 8 个」。
        """,
        [
            "硬事实和阈值冲突时谁优先？",
            "WARN 为什么必须人工复核，不直接放行？",
        ],
        [
            "四层门禁",
            "硬事实优先",
            "配对基线",
            "两个 BLOCK 的区别",
            "PASS 的证据",
            "单机与 adapter 边界",
        ],
        ["P7", "Harness", "发布门禁", "证据链"],
    ),
    _q(
        "X-MINE-09",
        "backend",
        "底层底座组",
        "个人项目：P1D SlimTrack 健康 Agent 的数据与缓存",
        "P1D SlimTrack 1.2 从健康单页扩成 FastAPI + MCP + PostgreSQL/Redis + 多租户鉴权。请讲清体重单位归一、报告生成口径、L1/L2 缓存一致性，以及哪些数字不能拿去面试吹。",
        """
        # 一条主链路

        `聊天/表单 → 单位归一 → 结构化事件 → 档案/快照 → 报告生成 → 缓存`

        ## 1. 单位与意图

        - 支持 kg、公斤、千克、斤；`2 斤 = 1 kg`。
        - 「掉了两斤肉」不能识别成饮食记录，要先做意图判断。
        - 极端体重、短期大幅变化做常识校验，拦截或提醒。

        ## 2. 报告口径

        - 评分参考趋势、BMI、饮水、蛋白、波动和停滞风险；停滞场景不能仍然高分。
        - 记录不足 7 天阻止生成，并提示继续记录。
        - 专属报告有缓存；演示 TTL 1 分钟，生产建议 12 小时。这两个数不能混着讲。

        ## 3. 缓存一致性

        - L1：进程内 TTL + LRU；L2：Redis；singleflight 防击穿。
        - key 带用户/日期/档案版本；档案更新或事件写入时失效。
        - 缓存读失败回源数据库，不让报告页直接 500。

        ## 4. 鉴权与 MCP

        - JWT + PBKDF2；多租户 API 做身份/数据隔离。
        - MCP resources / tools / prompts 分层，工具返回结构化数据。
        - 关键动作写结构化事件，便于后续复盘和报告。

        ## 5. 不能吹的数字

        - 单机 demo 的缓存命中率不是生产命中率。
        - 没有云端压测、长期稳定性和真实用户量，不要报 QPS/P95 承诺。
        - Demo 场景是演示路径，不是线上分布。
        """,
        [
            "为什么报告缓存 TTL 演示用 1 分钟、生产建议 12 小时？",
            "档案更新后 L1 和 L2 怎么同时失效？",
        ],
        [
            "单位归一",
            "意图与常识校验",
            "报告口径",
            "L1/L2/singleflight",
            "多租户与 MCP",
            "演示数字边界",
        ],
        ["P1D", "SlimTrack", "健康Agent", "缓存"],
    ),
    _q(
        "X-MINE-10",
        "delivery",
        "交付 & 封装形态组",
        "个人项目：P8D 多模型前端设计打样台",
        "P8D 0.3.0 用多模型并行出 4 个设计方向、SpecBus 版本审批、SQLite run store 和按 provider/model 的 TPM 桶。你怎么保证一次评审可复现？遇到 429、模型抖动或迟到日志怎么处理？",
        """
        # 先给结论

        这个项目的主角不是「生成了几张图」，而是「同一份 spec、同一组参数、同一个 run 下，评审结果能复现」。

        ## 1. 可复现的最小集合

        - 固定 `spec.md` / `approved.md` 版本，SpecBus 管 v1/v2 审批与激活。
        - 每次 run 留 run_id、provider/model、prompt hash、参数、seed、产物路径。
        - 四个方向 industrial / brutalist / editorial / glass 各自有版本；历史稿标注 specVersion，不混成「最新」。
        - 评审与生成分开计时：主 run 的 `elapsedMs` / `finishedAt` 不被重评覆盖，重评记 `reviewElapsedMs`。

        ## 2. 429 与模型抖动

        - TPM 桶按 `provider.id::model`，提交前预扣，真实 usage 回填。
        - 429 清桶并进入 20 秒冷却；不再用固定 25 秒角色冷却。
        - 迟到日志不能把已完成的 run 翻回 running。
        - 失败候选独立记录，不拖垮同批其他方向。

        ## 3. 存储与评审

        - `node:sqlite` 的 runs/artifacts 两张表，WAL，`BEGIN IMMEDIATE` bundle。
        - 旧 JSON run 迁移、artifact 幂等回填；文件镜像保留。
        - 盲评 + 四方向切换；全栈聚合用 approved v2 和 industrial v2 重算，不拿旧分糊弄。
        - `recompose` 不调用 LLM，只重算聚合。

        ## 4. 当前证据

        - 版本 0.3.0；四方向真实生成；approved v2 8,379 B；全栈盲评 4.1（后端 4.0 / 前端 4.2）。
        - token 记账 127,991 = 81,905 + 46,086。
        - P7 里仍是 onboarding，adapter pending。

        ## 5. 边界

        本地工具，不上线；历史方向有 v1 稿；不要把「本地 4 方向」说成「生产多模型平台」。
        """,
        [
            "为什么评审计时不能覆盖主 run 的 elapsedMs？",
            "TPM 桶预扣和回填不一致时怎么对账？",
        ],
        [
            "spec/approved 版本",
            "run/产物/seed 复现",
            "429 TPM 桶",
            "SQLite 与迟到日志",
            "盲评与全栈聚合",
            "本地/onboarding 边界",
        ],
        ["P8D", "设计打样", "多模型", "TPM"],
    ),
]


PERSONAL_ARTICLE = {
    "id": "kb-personal-project-portfolio",
    "category": "个人项目",
    "title": "个人项目题：当前在跑的项目、证据与不能吹的边界",
    "subtitle": "先把项目地图分清，再决定哪 10 道题值得背",
    "readingMinutes": 10,
    "tags": ["个人项目", "项目进度", "面试证据", "边界"],
    "summary": "P1D/P2/P4/P5/P6/P7/P8D 的当前状态压成一张面试地图：哪些是已跑通，哪些只是设计稿，哪些还在 backlog。附 10 道个人项目题索引。",
    "body": dedent(
        """
        ## 先给结论

        这批题只标 `个人项目`，不和书本题、公共知识题混在一起。

        | 项目 | 当前状态 | 面试里能拿出的证据 | 不能吹的边界 |
        | --- | --- | --- | --- |
        | P1D SlimTrack 1.2 | 可运行健康站 | 单位归一、报告口径、L1/L2 缓存、多租户鉴权、MCP | 单机 demo，无云端压测与长期稳定性 |
        | P2 SiteYeb | 当前主线，持续更新 | 题库/知识库、AI 面试评估、HITL、Redis 缓存、桌面端 | 单机 Compose，部分 AI 评估依赖外部模型 |
        | P3 June | 早期完整 demo | Tavily + DeepSeek、SQLite 缓存、9 个 MCP 工具 | 2026-06 的旧项目，不在当前主链路 |
        | P4 Agent 电商 | 主项目之一 | 多 Agent、六道关、加权 RRF、评估 harness | 未接真实支付/库存，部分评估集较小 |
        | P5 企业知识库 | 1.0 骨架 + 面试版 | 7 容器 healthy、231+ 测试、公开检索基准、知识治理 | 不是上线产品，20 项缺口，多租户未实现 |
        | P6 视频管线 | 可运行管线 | 档 0 基线、mock/Wan/Ark 适配、素材收口、成本账本 | Wan/Ark 未实测；候选集仍是设计稿 |
        | P7 Harness | 0.6.1，主项目 | 8 个项目接入、Golden Set、PASS/WARN/BLOCK、证据链 | 单机，部分 adapter simulated |
        | P8D 设计打样台 | 0.3.0 | 4 方向真实生成、SpecBus、SQLite、TPM 桶 | 本地工具，P7 onboarding，adapter pending |

        ## 项目地图

        P7 的 registry 当前是：

        - **connected 8 个**：P1 健康站、P2 学习站、P4 电商、P5 知识库、P6 视频、P7 自检、ZB01 Copilot、ZB03 HR。
        - **onboarding 1 个**：P8D 设计打样台。
        - **backlog 4 个**：P3 产品对比、ZB02 DeepResearch、Demo1 Agent 综合、P0 知识沉淀。

        P9 AI 点餐、P10 ProjectManager 在旧项目档案里有，但当前本机没有找到可核对的实现目录；这批个人项目题不把它们当“已完成”讲。

        ## 一个重要的漂移

        旧档案里 P1 写的是 SimTrack 仿真追踪，P8 写的是全栈抽卡；本地实际项目已经变成：

        - P1D：SlimTrack 健康管理站。
        - P8D：多模型前端设计打样台。

        这轮新增题走独立 `P1D / P8D` 档案，不复用旧题映射，避免 AI 拿错项目背景评分。

        ## 这 10 道题怎么用

        | 题号 | 主题 | 一句话考什么 |
        | --- | --- | --- |
        | X-MINE-01 | P2 题库按需加载 | summary/detail、Redis、回退 |
        | X-MINE-02 | P2 HITL 与页面上下文 | 意图、恢复、误弹 |
        | X-MINE-03 | P4 加权 RRF | 反直觉结果与按数据修复 |
        | X-MINE-04 | P4 写操作六道关 | 重复写、幂等、故障注入 |
        | X-MINE-05 | P5 公开检索基准 | 切分、调参、工程坑 |
        | X-MINE-06 | P5 新鲜度与冲突 | ACL、时间、证据链 |
        | X-MINE-07 | P6 档 0 与候选集 | 可复现、Take、成本 |
        | X-MINE-08 | P7 Harness 门禁 | 硬事实、阈值、证据 |
        | X-MINE-09 | P1D 健康 Agent | 单位、报告、缓存 |
        | X-MINE-10 | P8D 设计打样台 | 复现、429、run store |

        ## 面试口述模板

        1. 先给项目定位：一句话说清它解决什么，不说“用了什么框架”。
        2. 给一个真实约束：数据规模、并发、权限、成本或演示环境。
        3. 给一个取舍：为什么不用更常见的方案。
        4. 给一个失败：哪里曾经错过，怎么发现、怎么修。
        5. 给一个边界：哪部分没做，为什么现在不做。

        这五段比背 20 个名词更能扛住二面追问。
        """
    ).strip(),
    "sources": [
        {"title": "P7 Harness README（8 个项目与门禁）", "url": Path(r"C:\ProjectYeb\P7HarnessDesignE\README.md").as_uri()},
        {
            "title": "P5 企业知识库 CHANGELOG（1.0.0 与缺口）",
            "url": Path(r"C:\Users\yeb12\WorkBuddy\P5企业级知识库项目\docs\CHANGELOG.md").as_uri(),
        },
        {
            "title": "P4 检索评估报告（加权 RRF）",
            "url": Path(r"C:\Users\yeb12\WorkBuddy\P4 Agent电商\docs\EVALUATION_REPORT.md").as_uri(),
        },
        {
            "title": "P6 渲染管线（档 0 与 provider）",
            "url": Path(r"C:\Users\yeb12\WorkBuddy\P6 AI视频剪辑Assistance\docs\03-渲染管线.md").as_uri(),
        },
        {
            "title": "P8D CHANGELOG（0.3.0 与 TPM）",
            "url": Path(r"C:\ProjectYeb\P8FrontDesignPicker\CHANGELOG.md").as_uri(),
        },
        {
            "title": "P1D SlimTrack 1.2 README",
            "url": Path(r"C:\ProjectYeb\P1D\README_CN.md").as_uri(),
        },
        {"title": "P2 SiteYeb README", "url": Path(r"C:\SiteYeb\README.md").as_uri()},
    ],
    "relatedQuestions": [item["id"] for item in PERSONAL_QUESTIONS],
}
