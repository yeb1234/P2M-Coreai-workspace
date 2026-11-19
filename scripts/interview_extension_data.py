"""2026-11 面试题库扩展：微调、数据、模型原理、DeepSeek 新版、Jev、Agent 评估与 FDE。

这些题刻意和原 289 题分开：原题库偏 Agent 工程和后端底座，这一组补的是
“会被问到大模型但又不该只会调包”的那一层。答案按面试口述 + 工程落地写，
关键数字以官方模型卡/技术报告为准，过时说法在题里直接纠正。
"""

from __future__ import annotations

GROUP = "llm"
GROUP_LABEL = "LLM 微调 & 原理"
RESUME_GROUP = "core-agent"
RESUME_GROUP_LABEL = "核心 Agent&LLM 工程组"
SOURCE = "补充"


def q(
    qid: str,
    qtype: str,
    difficulty: str,
    title: str,
    question: str,
    answer: str,
    *,
    chapter: str,
    tags: list[str],
    follow_ups: list[str] | None = None,
    rubric: list[str] | None = None,
) -> dict:
    return {
        "id": qid,
        "group": GROUP,
        "groupLabel": GROUP_LABEL,
        "resumeGroup": RESUME_GROUP,
        "resumeGroupLabel": RESUME_GROUP_LABEL,
        "type": qtype,
        "difficulty": difficulty,
        "source": SOURCE,
        "bookId": None,
        "bookPage": None,
        "chapter": chapter,
        "title": title,
        "question": question,
        "answer": answer.strip(),
        "followUps": follow_ups or [],
        "rubric": rubric or [],
        "tags": tags,
        "bookTitle": None,
    }


QUESTIONS: list[dict] = [
    # ------------------------------------------------------------------
    # 1. 微调概念与选型
    # ------------------------------------------------------------------
    q(
        "LLM-001", "concept", "高频",
        "SFT、全量 SFT、半参 SFT、PEFT 到底差在哪",
        "面试官问：SFT 是什么？全量 SFT、半参 SFT 和 LoRA 这类 PEFT 的区别是什么？什么时候才值得做全量 SFT？",
        """
SFT 是监督微调：拿「输入 → 期望输出」成对数据，继续训练底座，让模型学会按你的任务范式作答。它改的是模型行为，不是可靠地注入新事实。

三种粒度：

| 方案 | 改哪些参数 | 显存/成本 | 适合什么 |
| --- | --- | --- | --- |
| 全量 SFT | 全部权重 | 最高，7B 也要多卡 | 底座能力/指令逻辑大改、领域继续预训练 |
| 半参 SFT | 冻结主干，只训部分层或头部 | 中等 | 预算有限但要改较多行为 |
| PEFT / LoRA | 只训插入的低秩适配器 | 最低，单卡可跑 | 格式、话术、风格、任务映射、小领域范式 |

面试口述：**能靠 Prompt + RAG 解决的，不上微调；能靠 LoRA 解决的，不做全量 SFT。** 全量 SFT 不是“更高级”，而是“更贵且更容易把底座训坏”。真正值得全量的场景通常有两个前提：一是你要改的是模型的默认推理/指令行为，不是几条业务规则；二是你有足够干净的数据和回滚能力。

半参 SFT 是一个工程折中：冻结大部分底层语言能力，只放开靠近输出的层，降低灾难性遗忘，但可控性和效果都不如目标明确的 LoRA。
        """,
        chapter="微调 · 概念与选型",
        tags=["SFT", "PEFT", "LoRA", "选型"],
        follow_ups=[
            "全量 SFT 之后模型变笨了，你怎么判断是灾难性遗忘还是数据问题？",
            "半参 SFT 一般冻结哪些层，为什么？",
            "如果客户只有一张 24G 卡，你会怎么排方案？",
        ],
        rubric=[
            "能区分 SFT 的行为对齐与新知识注入",
            "能说清全量/半参/PEFT 的成本与适用边界",
            "给出“先 Prompt/RAG，再 LoRA，最后全量”的收敛顺序",
        ],
    ),
    q(
        "LLM-002", "concept", "压轴",
        "LoRA 的低秩 A/B 矩阵到底改了什么",
        "请解释 LoRA 的数学形式、A/B 初始化、rank 与 alpha 的作用，以及推理时合并和动态加载的区别。",
        """
LoRA 不改原权重 W，而是学一个低秩增量：

```text
W' = W + ΔW = W + (B @ A) * (alpha / r)
A: r × d_in   （降维）
B: d_out × r  （升维）
```

初始化通常是 **A 高斯随机、B 全零**，所以训练开始时 ΔW=0，模型行为与底座完全一致，不会一上来就把输出打乱。`rank=r` 控制适配器容量；`alpha` 控制增量相对底座的影响强度，常见做法是 `alpha = r` 或 `alpha = 2r`，实际缩放是 `alpha/r`。rank 不是越大越好：8 适合格式/话术对齐，16–32 适合更复杂的指令跟随，再大就要看数据量和过拟合。

推理有两种形态：

- **合并权重**：把 ΔW 加回底座，得到一个独立模型。推理没有额外分支，适合固定业务的最终部署，但失去多 LoRA 切换能力。
- **动态加载**：底座不动，按请求加载不同 adapter。vLLM 支持多 LoRA，适合“一套底座服务多个客户/多个业务”，代价是要预留 adapter 显存并管理路由。

面试里最容易被追问的是：**LoRA 的低秩不是“参数量小所以一定不丢能力”，而是用一个小扰动去改变模型的输出分布。** 所以它擅长学“怎么答”，不擅长灌“答什么事实”。
        """,
        chapter="微调 · LoRA 机制",
        tags=["LoRA", "低秩", "rank", "alpha", "vLLM"],
        follow_ups=[
            "为什么 B 要初始化为 0，A 不初始化 0？",
            "alpha/r 这个缩放因子的作用是什么？",
            "合并 LoRA 和不合并，推理性能差在哪？",
        ],
        rubric=[
            "写出 ΔW=BA 与 alpha/r 缩放",
            "说清 A/B 初始化与训练稳定性",
            "能区分合并部署和动态加载的适用场景",
        ],
    ),
    q(
        "LLM-003", "concept", "高频",
        "QLoRA 的 4bit 量化到底省在哪",
        "QLoRA 为什么能在 24G 卡上跑 7B 模型？NF4、双重量化、paged optimizer 分别解决什么问题？",
        """
QLoRA 的核心不是“把模型压成 4bit 就完事”，而是三层组合：

1. **4bit 量化底座（NF4）**：把冻结的底座权重压到 4bit。NF4 是信息论上更适合正态分布权重的分位量化，不是均匀切格子。底座不参与梯度更新，所以可以很低精度。
2. **双重量化（double quantization）**：量化本身也有 scale/zero-point 这些常数，QLoRA 再把这些常数量化一次，进一步省显存。
3. **Paged optimizer**：优化器状态在显存紧张时分页到 CPU，避免长序列训练突然 OOM。它是“防猝死”，不是性能优化。

计算时会把 4bit 权重反量化到 BF16 做矩阵乘，LoRA 适配器本身通常仍用 BF16 训练。所以 QLoRA 省的是**底座权重和优化器状态**，不是把计算也变成 4bit。

面试口述：7B 模型全量 SFT 在 24G 卡上基本不现实；QLoRA 把冻结底座压到 4bit，只训练几十 MB 的 adapter，所以单卡 L4 24G 可以跑。代价是训练速度变慢、量化误差、部分算子兼容性差，尤其是新架构（MoE/CED）要等推理框架适配。
        """,
        chapter="微调 · QLoRA",
        tags=["QLoRA", "NF4", "量化", "显存"],
        follow_ups=[
            "QLoRA 训练时计算精度是什么？为什么不是 4bit 算？",
            "NF4 和 GPTQ/AWQ 的量化目标有什么区别？",
            "为什么 MoE 模型做 QLoRA 更容易踩坑？",
        ],
        rubric=[
            "能说出 NF4 / 双重量化 / paged optimizer 三个点",
            "明确底座冻结、adapter 仍用 BF16",
            "能说出 QLoRA 的代价而不只讲省显存",
        ],
    ),
    q(
        "LLM-004", "compare", "压轴",
        "LoRA 能不能学新知识，和 RAG 怎么分工",
        "客户想把产品手册和内部制度“训进模型”，你会选 LoRA 还是 RAG？为什么？",
        """
结论：**事实型、会变的知识优先 RAG；LoRA 负责输出范式和行为约束。** 不要让 LoRA 背大量新事实。

原因：
- LoRA 的容量和训练目标决定它更擅长学映射、格式、话术、风格、工具调用模板；大量新事实需要模型在参数里建立稳定关联，LoRA 容易学成“表面记忆”，换问法就崩。
- 事实会更新：制度一改，RAG 换文档即可；LoRA 要重新造数据、重训、回归。
- 可追溯性：RAG 能给出出处，LoRA 不能。

正确组合：
```text
RAG：召回制度/手册/工单 → 提供事实与出处
LoRA：约束“必须按固定 JSON / 固定话术 / 固定拒答策略输出”
Prompt：放临时任务约束和少量 few-shot
```

面试官如果追问“那 LoRA 一点知识都学不了吗”，回答：能学**小范围、稳定、重复出现的领域表达和映射**，比如工单分类口径、固定字段抽取；但不要把“会查手册”当成“把手册背下来”。知识量大、更新频繁、需要引用出处，一律 RAG。
        """,
        chapter="微调 · 能力边界",
        tags=["LoRA", "RAG", "知识注入", "选型"],
        follow_ups=[
            "如果客户要求“模型必须记住 500 页手册”，你怎么反驳？",
            "LoRA + RAG 同时上，怎么判断收益来自哪一层？",
            "什么情况下 RAG 反而不如微调？",
        ],
        rubric=[
            "明确 LoRA 擅长范式而非事实",
            "给出 RAG/LoRA/Prompt 的分工",
            "能说出更新成本与可追溯性",
        ],
    ),
    q(
        "LLM-005", "concept", "高频",
        "DPO 的三元组和训练目标",
        "DPO 用什么数据？为什么它能在不训练 reward model 的情况下做偏好优化？它的坑是什么？",
        """
DPO 的数据是三元组：`(prompt, chosen, rejected)`。chosen 是偏好回答，rejected 是不偏好回答。它不需要像 PPO 那样先训一个 reward model，而是把“偏好”直接写进一个分类式损失：让模型提高 chosen 的相对概率、降低 rejected 的相对概率，同时用 reference model 约束不要偏离底座太远。

关键超参是 `β`：越大越保守，越靠近 reference；越小越激进，容易模式坍塌或过拟合偏好数据。

DPO 的坑：
- 偏好数据质量比数量重要，chosen/rejected 的差异要清晰，不能两个都还行。
- 只覆盖“风格偏好”时，DPO 很容易把模型训得更啰嗦或更谄媚。
- 对事实正确性帮助有限，事实仍要靠 RAG/评测。
- reference model 要占一份显存；长序列下成本不低。

面试口述：SFT 教“正确答案长什么样”，DPO 教“两个答案里哪个更好”，GRPO 则是“同一 prompt 采样一组，按组内相对表现优化”。
        """,
        chapter="微调 · 偏好优化",
        tags=["DPO", "RLHF", "偏好数据", "beta"],
        follow_ups=[
            "DPO 的 reference model 能不能省掉？",
            "chosen 和 rejected 长度差异很大会有什么问题？",
            "DPO 之后模型变得更长了，怎么排查？",
        ],
        rubric=[
            "说出三元组与 reference model",
            "解释 β 的作用",
            "能指出 DPO 对事实能力有限",
        ],
    ),
    q(
        "LLM-006", "compare", "压轴",
        "PPO/RLHF 为什么贵，四个模型怎么占显存",
        "PPO 做 RLHF 时为什么要 actor、critic、reward、reference 四个模型？中小企业为什么很少用？",
        """
传统 RLHF-PPO 的链路：

```text
actor（要训的策略模型）
critic（价值网络，估 baseline）
reward model（打分）
reference model（KL 约束，防止策略跑飞）
```

四个模型都要前向，actor/critic 还要反向。显存不是简单“4 份模型”，而是模型权重 + 梯度 + 优化器状态 + 激活。7B 级别下，即使用 LoRA 只训 actor，critic 和 reward 仍然要常驻，长序列 rollout 还会放大激活。工程上还要处理 rollout 生成、奖励打分、GAE、clip、分布式同步，链路长、稳定性差。

所以中小企业/交付项目一般不上 PPO：成本高、调参难、效果不一定比 SFT + DPO 好。面试里把 PPO 定位成“传统 RLHF 的重型方案”，能说清它为什么重就够了，不需要手推公式。
        """,
        chapter="微调 · RLHF",
        tags=["PPO", "RLHF", "reward model", "显存"],
        follow_ups=[
            "PPO 的 clip 是解决什么问题的？",
            "critic 能不能用 reward model 代替？",
            "为什么现在工业界更多用 DPO/GRPO？",
        ],
        rubric=[
            "说清四个模型角色",
            "能算清显存不只是四份权重",
            "给出中小企业不选 PPO 的理由",
        ],
    ),
    q(
        "LLM-007", "compare", "压轴",
        "GRPO 和 DPO、PPO 的区别",
        "GRPO 是什么？它为什么不需要 critic？group-relative 到底相对在哪？适合什么任务？",
        """
GRPO（Group Relative Policy Optimization）是 PPO 的一个变体：对同一个 prompt 采样一组（group）回答，用组内奖励的均值/标准差构造相对优势，替代 critic 的 baseline 估计。

```text
advantage_i = (reward_i - mean(group_rewards)) / std(group_rewards)
```

这样就不需要单独训 critic，显存和链路都轻一截。它仍然是 on-policy 的 RL，需要采样和奖励函数；和 DPO 的离线成对偏好不是一回事。

对比：
- **DPO**：离线三元组，简单稳定，适合风格/偏好对齐，不直接优化任务成功率。
- **PPO**：在线 RL，有 critic，工程重，适合复杂奖励。
- **GRPO**：在线 RL，无 critic，组内相对优势，适合数学、代码、工具调用这类**可自动判分**的任务。DeepSeek 系列在后训练里大量使用 GRPO/混合 RL。

GRPO 的坑：奖励函数设计不好，模型会钻空子；group size 太小，均值/方差噪声大；采样成本高；对不能自动判分的业务，需要先造可验证的 reward。
        """,
        chapter="微调 · 偏好优化",
        tags=["GRPO", "PPO", "DPO", "RL"],
        follow_ups=[
            "GRPO 的 group size 一般怎么选？",
            "没有自动判分器，怎么构造 reward？",
            "GRPO 和 rejection sampling fine-tuning 的区别是什么？",
        ],
        rubric=[
            "写出组内相对 advantage",
            "说清无 critic 的代价与收益",
            "指出 GRPO 依赖可验证奖励",
        ],
    ),
    q(
        "LLM-008", "compare", "高频",
        "蒸馏、LoRA、DPO/GRPO 怎么选",
        "给你一个业务需求，什么时候用蒸馏，什么时候用 LoRA，什么时候用 DPO/GRPO？",
        """
先看你要解决的是哪类问题：

| 目标 | 首选 | 说明 |
| --- | --- | --- |
| 降推理成本/把小模型做得更像大模型 | 蒸馏 | 用 teacher 的 logits 或生成数据训 student |
| 改输出格式、话术、工具调用模板 | LoRA/QLoRA | 小数据、低成本、可多租户 |
| 改偏好、减少坏回答、提升任务成功率 | DPO/GRPO | DPO 用偏好对；GRPO 用可验证奖励 |
| 注入大量事实 | RAG | 不要硬训进参数 |
| 改底座默认推理行为 | 全量 SFT/继续预训练 | 成本最高，最后才考虑 |

蒸馏不是“把大模型复制小”：logits 蒸馏让学生学老师的分布，序列蒸馏让学生学老师的输出；前者信息更多，后者更简单。蒸馏适合你有强 teacher、要固定小模型部署的场景；LoRA 适合你已经有底座、只想改行为；DPO/GRPO 适合你已经有 SFT 底座、想进一步优化偏好或任务成功率。

交付顺序：Prompt/RAG → LoRA → DPO（有偏好数据）→ GRPO（有自动判分）→ 全量 SFT/蒸馏（有明确降本或能力重塑目标）。
        """,
        chapter="微调 · 方案选型",
        tags=["蒸馏", "LoRA", "DPO", "GRPO", "选型"],
        follow_ups=[
            "logits 蒸馏和序列蒸馏怎么选？",
            "蒸馏需要 teacher 和 student 词表一致吗？",
            "LoRA 之后再 DPO，adapter 怎么处理？",
        ],
        rubric=[
            "能按目标而不是按名词选方案",
            "说清蒸馏与 LoRA 的不同目标",
            "给出收敛式交付顺序",
        ],
    ),
    q(
        "LLM-009", "concept", "高频",
        "LoRA target modules 怎么选",
        "LoRA 只训 Q/K 够吗？q_proj、v_proj、o_proj、gate/up/down 分别影响什么？MoE 模型怎么选？",
        """
target modules 决定“把适配器插在哪”。常见经验：

- **q_proj / v_proj**：最经典的最小组合，参数量少，适合风格/格式对齐。
- **q/k/v/o 全 attention**：表达能力强一些，成本上升，适合更复杂的指令跟随。
- **加 MLP（gate/up/down）**：容量更大，适合领域表达和较复杂映射，但也更容易过拟合。
- **o_proj**：影响注意力输出投影，常和 q/v 一起做消融。
- **MoE**：要区分 router 和 experts。通常不建议训 router（容易把路由打乱），优先对选中的 expert FFN 加 adapter；不同框架对 MoE 的 target 支持不一样，必须先小规模验证。

选择方法不是背名单，而是做消融：固定数据、rank、epoch，只改 target，看验证集的任务指标和格式合规率。Agent 交付里，如果目标只是稳定 JSON/话术，q/v 或 q/k/v/o 往往够；如果发现模型“懂格式但不懂业务表达”，再加 MLP。
        """,
        chapter="微调 · LoRA 参数",
        tags=["LoRA", "target modules", "MoE", "消融"],
        follow_ups=[
            "为什么不建议训 router？",
            "target 越多越好吗？怎么证明？",
            "MoE 的 expert LoRA 在 vLLM 里怎么加载？",
        ],
        rubric=[
            "能区分 attention 与 MLP 的影响",
            "知道 MoE router 的风险",
            "用消融而不是拍脑袋选 target",
        ],
    ),
    q(
        "LLM-010", "system", "压轴",
        "rank、alpha、学习率、epoch 怎么定",
        "LoRA 的 rank、alpha、learning rate、epoch 怎么设？怎么判断过拟合和灾难性遗忘？",
        """
给一套可落地的起点，不要当万能公式：

```text
rank: 8（格式/话术） / 16（复杂指令） / 32（更难映射）
alpha: 8 / 16 / 32（常与 rank 同值或 2 倍）
learning rate: 1e-4 ~ 5e-4（LoRA 常用，远大于全量 SFT）
epoch: 2 ~ 5，先跑 2 看验证集
batch: 能塞满显存即可，配合 gradient accumulation
warmup: 3% ~ 5%
```

判断：
- **过拟合**：train loss 持续降、val loss 先降后升；验证集输出开始背样本、换问法就崩；格式合规率高但内容正确率下降。
- **灾难性遗忘**：通用能力回退，比如原来会的指令跟随、拒答、简单推理变差；用一组“通用回归集”在微调前后对比。
- **学不动**：train/val 都不降，先查数据格式、loss mask、target modules、学习率，不要盲目加 rank。

Agent 交付的验收不是只看 val loss，而是看**业务集 + 格式集 + 通用回归集**三组。val loss 只是早停信号，不是交付指标。
        """,
        chapter="微调 · 超参",
        tags=["rank", "alpha", "learning rate", "过拟合", "遗忘"],
        follow_ups=[
            "为什么 LoRA 的学习率通常比全量 SFT 大？",
            "val loss 下降但业务指标不升，为什么？",
            "怎么构造通用回归集？",
        ],
        rubric=[
            "给出可执行的参数起点",
            "能区分过拟合与遗忘",
            "强调业务集/格式集/回归集三组验收",
        ],
    ),
    q(
        "LLM-011", "system", "压轴",
        "多 LoRA 在 vLLM 里怎么热切换",
        "一套底座服务多个客户，每个客户一个 LoRA。vLLM 怎么动态加载？显存、隔离、路由怎么设计？",
        """
思路：底座只加载一份，adapter 按需加载/卸载，请求里带 `adapter_id` 或由网关根据租户映射。

```text
租户 A → adapter_A
租户 B → adapter_B
底座  → 共享
```

工程要点：
- **显存预留**：每个 adapter 的权重、临时 buffer、CUDA graph 都要算；不要按“文件几十 MB”估，实际有对齐和框架开销。设置最大并发 adapter 数，超了排队或卸载。
- **隔离**：adapter 之间不能串权重；请求级路由必须由网关注入，不能让模型自己选租户。
- **版本**：adapter 要带版本号，支持灰度、回滚；底座升级要回归所有 adapter。
- **冷启动**：首次加载有延迟，常用 adapter 预热；低频 adapter 可以懒加载。
- **一致性**：同一租户的多轮对话要固定 adapter，避免中途切换导致人格/格式漂移。

面试口述：多 LoRA 的价值是“一套底座、多业务隔离、低成本扩展”；风险是“显存碎片、路由错租户、版本漂移”。这三件事要在设计里说清楚。
        """,
        chapter="微调 · 多租户部署",
        tags=["vLLM", "多LoRA", "多租户", "路由"],
        follow_ups=[
            "adapter 加载失败怎么降级？",
            "底座升级后怎么保证 adapter 兼容？",
            "如何防止请求串到别的租户 adapter？",
        ],
        rubric=[
            "说清共享底座 + adapter 路由",
            "考虑显存预留与冷启动",
            "覆盖隔离、版本、回滚",
        ],
    ),
    q(
        "LLM-012", "troubleshoot", "压轴",
        "灾难性遗忘怎么诊断和缓解",
        "LoRA 微调后模型通用能力明显下降，你怎么定位原因、怎么缓解？",
        """
先定位，不要直接加数据重训。

**诊断顺序：**
1. 用微调前的同版底座跑一组通用回归集，确认基线。
2. 微调后同集重跑，看是全面下降还是某一类下降。
3. 看训练数据分布：是否全是单一格式、单一话术、超长输出，导致模型把“所有问题都答成这个模板”。
4. 看超参：epoch 是否过多、lr 是否过大、target 是否过宽、rank 是否过大。
5. 看 loss mask：是否把 system/user token 也算进 loss，导致模型学会“复述问题”。

**缓解：**
- 降 epoch/lr，早停。
- 数据里混入 5%–20% 的通用指令/拒答/短回答样本，做 replay。
- 缩小 target modules，先只训 q/v。
- 加 KL 约束或和底座做输出一致性正则（工程上可用 reference model / 蒸馏约束）。
- 如果业务只需要格式，优先把格式约束移到 Prompt/JSON schema，减少微调负担。

面试口述：灾难性遗忘不是 LoRA 独有的，全量 SFT 更严重；LoRA 因为扰动小反而更容易控制。关键是**别用单一业务集把模型训成复读机**。
        """,
        chapter="微调 · 排障",
        tags=["灾难性遗忘", "回归集", "replay", "早停"],
        follow_ups=[
            "replay 比例怎么定？",
            "KL 约束在 LoRA 训练里怎么加？",
            "怎么区分遗忘和数据分布偏移？",
        ],
        rubric=[
            "先基线对比再定位",
            "能从数据/超参/loss mask 三条线排查",
            "给出 replay、缩小 target、早停等缓解手段",
        ],
    ),

    # ------------------------------------------------------------------
    # 2. 数据工程
    # ------------------------------------------------------------------
    q(
        "LLM-013", "concept", "基础",
        "ChatML、ShareGPT、Alpaca 三种数据格式",
        "微调数据常见的 ChatML、ShareGPT、Alpaca 格式分别长什么样？为什么现在优先 ChatML？",
        """
三种都是“把对话变成训练样本”，差别在字段结构。

**ChatML（OpenAI messages）**
```json
{"messages":[
  {"role":"system","content":"你是客服 Agent，只输出 JSON"},
  {"role":"user","content":"订单 123 什么时候到？"},
  {"role":"assistant","content":"{\"status\":\"in_transit\"}"}
]}
```

**ShareGPT（conversations）**
```json
{"conversations":[
  {"from":"human","value":"订单 123 什么时候到？"},
  {"from":"gpt","value":"{\"status\":\"in_transit\"}"}
]}
```

**Alpaca（instruction/input/output）**
```json
{"instruction":"判断订单状态","input":"订单 123 什么时候到？","output":"{\"status\":\"in_transit\"}"}
```

现在优先 ChatML：role 清晰、天然支持 system、多轮，主流框架（Unsloth/PEFT/TRL/vLLM）都认；ShareGPT 在社区数据里常见；Alpaca 偏老，适合单轮指令任务。

必须注意：**JSONL 是一行一条 JSON，不是 JSON 数组**。文件后缀 `.jsonl`，每条样本独立一行，方便流式读取和分片。
        """,
        chapter="数据 · 格式",
        tags=["ChatML", "ShareGPT", "Alpaca", "JSONL"],
        follow_ups=[
            "system prompt 应该写进每条样本吗？",
            "多轮样本里 assistant 的空回复怎么处理？",
            "JSONL 里有坏行，训练框架会怎样？",
        ],
        rubric=[
            "三种格式字段说对",
            "明确 JSONL 一行一条",
            "能解释为什么优先 ChatML",
        ],
    ),
    q(
        "LLM-014", "compare", "高频",
        "200、500、2000、3000+ 条数据分别适合什么",
        "客户说“先准备 200 条 LoRA 数据”，这个量够吗？数据量和任务类型怎么匹配？",
        """
量不是唯一变量，先看任务复杂度：

| 数据量 | 适合 | 风险 |
| --- | --- | --- |
| 200–500 | 固定格式、固定话术、单轮抽取、简单分类 | 覆盖边界不足，换问法容易崩 |
| 500–2000 | 中等领域、多轮、带业务规则 | 交付最常用区间，要保证多样性 |
| 2000–5000 | 更复杂的指令跟随、较多边界 | 过拟合风险上升，需要验证集 |
| 3000+ / 上万 | 领域继续预训练、复杂能力 | LoRA 容量可能不够，考虑全量/蒸馏 |

关键不是“200 条能不能训”，而是“200 条能不能覆盖你的输入分布”。如果业务只有 10 种问法，200 条足够；如果用户会自由表达，200 条很容易只学到表面模板。

面试口述：**少量高质量 > 大量脏数据。** 先做 200 条高纯度种子集跑通链路，再看 bad case 扩到 500–2000；不要一开始堆 1 万条重复样本。
        """,
        chapter="数据 · 规模",
        tags=["数据量", "过拟合", "覆盖", "交付"],
        follow_ups=[
            "怎么判断 200 条覆盖够不够？",
            "数据量增加后 val loss 反而变差，为什么？",
            "长尾意图怎么补？",
        ],
        rubric=[
            "按任务复杂度而不是拍数字",
            "指出覆盖比数量重要",
            "给出先种子集再扩样的路径",
        ],
    ),
    q(
        "LLM-015", "system", "高频",
        "微调数据质量验收清单",
        "给你一批微调数据，训练前你会检查哪些项？怎么定义“可以开训”？",
        """
一份可执行的验收清单：

1. **格式**：每行合法 JSON；role 只能是 system/user/assistant；多轮顺序正确；没有空 assistant。
2. **模板一致**：system prompt 统一；JSON 输出字段、大小写、空值策略一致；不要在样本里混多种风格。
3. **输出稳定**：同一类问题，assistant 的结构和口径一致；不能一会儿 JSON、一会儿自由文本。
4. **覆盖边界**：正常、模糊、缺参数、越权、拒答、工具报错，每类都要有样本。
5. **去重**：精确重复 + 近重复（归一化后 n-gram/embedding）都要清；重复样本会让模型过度自信。
6. **去矛盾**：同一输入两个不同标准答案，必须人工裁决，不能留给模型“平均学习”。
7. **无幻觉样本**：assistant 不能编造不存在的订单、政策、数字；宁可写“不知道/需人工”。
8. **长度分布**：不能全是超短或超长；长样本要检查截断。
9. **隐私与合规**：手机号、身份证、客户名要脱敏；不能把测试集泄进训练集。
10. **划分**：train/val 按业务维度分层，不能随机切导致 val 全是简单样本。

“可以开训”的标准：随机抽 30–50 条人工过一遍，格式合规率 100%，业务口径抽检通过率 ≥ 95%，关键边界都有覆盖。
        """,
        chapter="数据 · 质量",
        tags=["数据清洗", "验收", "去重", "脱敏"],
        follow_ups=[
            "近重复怎么检测？",
            "矛盾样本怎么裁决？",
            "抽检发现 10% 格式错误，先修还是先训？",
        ],
        rubric=[
            "覆盖格式/一致性/边界/去重/矛盾/幻觉/合规",
            "给出可量化的开训门槛",
            "强调人工抽检",
        ],
    ),
    q(
        "LLM-016", "compare", "中档",
        "微调数据从哪来，人工审核占多少",
        "企业微调数据一般有哪几条来源？为什么合成数据不能直接拿来训？",
        """
四条主路径：

1. **人工标注**：业务专家写样本。质量最高、成本最高，适合 200 条种子集和关键边界。
2. **历史对话清洗**：客服/工单/IM 历史，先脱敏、去噪、按业务口径改写，再转 ChatML。
3. **种子扩写**：少量人工种子 → 大模型生成候选 → 规则过滤 + 人工抽检。适合扩覆盖，不适合直接信任。
4. **公开数据集**：通用指令/对话集，适合混入 replay 防遗忘，不适合直接当业务口径。

合成数据的风险：模型会把老师的错误、模板化表达、幻觉一起放大；同一 prompt 大量变体会让数据分布失真；如果合成数据里出现训练集/测试集泄漏，评估就失真。

可落地比例：种子人工 10%–20%，历史清洗 50%–60%，合成扩写 20%–30%，并且合成数据 100% 过规则、至少 5%–10% 人工抽检。关键业务口径不允许只靠合成。
        """,
        chapter="数据 · 来源",
        tags=["标注", "合成数据", "历史对话", "审核"],
        follow_ups=[
            "合成数据怎么去重？",
            "历史对话里的多轮上下文怎么截取？",
            "怎么防止测试集泄漏？",
        ],
        rubric=[
            "说出四条来源及适用场景",
            "能解释合成数据的放大风险",
            "给出人工审核比例",
        ],
    ),
    q(
        "LLM-017", "concept", "基础",
        "train/val 怎么切，val loss 怎么看",
        "微调数据为什么要切验证集？随机 90/10 有什么问题？val loss 上升就一定要停吗？",
        """
验证集的作用是观察泛化，不是“再训一份”。随机 90/10 的问题：如果数据里同一模板/同一订单有多个变体，随机切会让 val 和 train 高度相似，val loss 很好看但线上崩。正确做法是按**业务维度/意图/模板/时间**分层切，尽量让 val 覆盖 train 没见过的表达。

val loss 的判断：
- train 降、val 先降后升：典型过拟合，早停。
- 两者都不降：学习率/target/格式/loss mask 有问题。
- val 降但业务指标不升：验证集分布不等于业务分布，或指标设计错了。
- val 突然崩：学习率过大、数据有坏样本、batch 太小。

早停不是只看一个点：连续 N 次验证无提升就停，保留最佳 checkpoint。LoRA 一般 2–5 epoch，不要跑到 10 轮。
        """,
        chapter="数据 · 划分与早停",
        tags=["train/val", "早停", "分层", "过拟合"],
        follow_ups=[
            "按时间切和按随机切有什么区别？",
            "val loss 和业务 F1 不一致，信哪个？",
            "early stopping 的 patience 怎么定？",
        ],
        rubric=[
            "指出随机切的数据泄漏风险",
            "能读 train/val 曲线",
            "给出早停与 checkpoint 策略",
        ],
    ),
    q(
        "LLM-018", "troubleshoot", "压轴",
        "客户给 200 条脏对话，第一步做什么",
        "客户扔给你 200 条真实客服对话，想做 LoRA。你的清洗和验收流程是什么？",
        """
先不要打开训练脚本。按这个顺序：

1. **抽样读 30 条**：确认对话结构、角色、业务意图、常见噪声（表情、错别字、贴图、系统消息、多人穿插）。
2. **定义目标样本**：只保留“用户输入 → 期望 assistant 输出”；客服内部备注、转人工记录、无关寒暄要剥离。
3. **脱敏**：手机号、订单号、地址、姓名替换成占位符；保留可复现的假 ID。
4. **统一模板**：固定 system prompt；固定输出 schema；把口语化回答改写成业务口径。
5. **去重/去矛盾**：近重复合并；同一问题不同答案找业务方裁决。
6. **补边界**：从 200 条里归纳意图，缺的意图人工补 20–50 条；不要只扩正常样本。
7. **切分**：按意图/时间分层，留 10%–20% 做 val；再从业务方拿 20 条独立盲测。
8. **跑基线**：先不微调，用 Prompt + few-shot 跑一遍，确认微调到底解决什么问题。
9. **小跑验证**：2 epoch、小 rank，先看格式合规和盲测，再决定是否扩数据。

面试重点：**200 条脏对话的第一价值不是训练，而是让你看懂业务分布。** 直接训等于把噪声固化。
        """,
        chapter="数据 · 清洗流程",
        tags=["脏数据", "清洗", "脱敏", "盲测"],
        follow_ups=[
            "200 条里只有 30 条可用，怎么办？",
            "客服内部备注要不要保留？",
            "怎么证明清洗后比清洗前好？",
        ],
        rubric=[
            "先抽样理解再做数据",
            "覆盖脱敏/模板/去重/边界/切分",
            "先跑 Prompt 基线再决定微调",
        ],
    ),
    q(
        "LLM-019", "code", "压轴",
        "多轮样本的 loss mask 怎么写",
        "多轮对话微调时，为什么不能对所有 token 算 loss？用 HuggingFace/TRL 思路说明 assistant-only loss 怎么实现。",
        """
多轮样本里，system 和 user 的 token 是“条件”，assistant 的 token 才是“要学的输出”。如果全算 loss，模型会学会复述问题、生成 system prompt，甚至把用户话术当成答案。

思路：构造 `labels`，把非 assistant 位置设成 `-100`（CrossEntropy 忽略），只保留 assistant token。

```python
# 简化示意：按 messages 逐段 tokenize，并记录 assistant 区间
input_ids = []
labels = []

for msg in messages:
    ids = tokenizer.apply_chat_template(
        [msg], tokenize=True, add_generation_prompt=False
    )
    input_ids.extend(ids)
    if msg["role"] == "assistant":
        labels.extend(ids)
    else:
        labels.extend([-100] * len(ids))
```

工程上更稳的做法是用框架的 `train_on_inputs=False` / `assistant_only_loss=True`（不同框架参数名不同），或者自己按 chat template 的 assistant 起始/结束 token 定位。必须验证：打印一条样本的 labels，确认只有 assistant 段非 -100。

坑：
- 不同模型的 chat template 不一样，手工拼 token 很容易错位。
- 多轮里 assistant 的历史回复要不要算 loss？通常算，但如果你只想学最后一轮，可以只保留最后一轮 assistant。
- padding token 也要设 -100，否则会学 padding。
        """,
        chapter="数据 · 训练目标",
        tags=["loss mask", "多轮", "TRL", "labels"],
        follow_ups=[
            "为什么 padding 也要 mask？",
            "多轮历史 assistant 要不要算 loss？",
            "chat template 不统一会怎样？",
        ],
        rubric=[
            "解释为什么要 assistant-only",
            "能写出 labels=-100 的思路",
            "提醒 chat template 与 padding 坑",
        ],
    ),
    q(
        "LLM-020", "system", "压轴",
        "合成数据怎么防止污染和自嗨",
        "用大模型扩写训练数据，怎么防止“老师犯错、学生照抄”和评估失真？",
        """
把合成数据当“候选”，不是“答案”。流程：

1. **种子集人工定标准**：先写 50–100 条高质量种子，明确 system、输出 schema、拒答口径。
2. **生成时带约束**：给老师模型明确的业务规则、字段枚举、禁止编造；要求输出理由和引用（如果可用）。
3. **规则过滤**：JSON schema 校验、字段枚举校验、长度/语言/敏感词过滤、重复检测。
4. **一致性检查**：同一输入的多个生成结果做聚类，冲突的进人工；不要让矛盾样本进训练。
5. **人工抽检**：按意图分层抽 5%–10%，重点看边界、拒答、数字、政策。
6. **holdout 隔离**：合成数据生成前就锁定测试集，测试集不参与任何生成/改写；否则评估会被污染。
7. **小规模消融**：合成数据比例 0/20%/40% 各跑一次，看业务盲测是否真的提升；不提升就别加。

面试口述：合成数据能扩覆盖，但不能替代业务标准。**没有人工标准的合成，只是把老师的偏见放大。**
        """,
        chapter="数据 · 合成与评估",
        tags=["合成数据", "污染", "holdout", "抽检"],
        follow_ups=[
            "怎么检测合成数据和测试集重叠？",
            "老师模型比学生强很多，蒸馏一定有用吗？",
            "合成数据比例多少合适？",
        ],
        rubric=[
            "种子标准 + 生成约束 + 规则过滤",
            "强调 holdout 隔离",
            "用消融证明合成数据收益",
        ],
    ),

    # ------------------------------------------------------------------
    # 3. 训练与交付
    # ------------------------------------------------------------------
    q(
        "LLM-021", "system", "高频",
        "7B QLoRA 在 L4 24G 的成本和时间",
        "面试官让你估算：7B 底座、4bit QLoRA、L4 24G、200/1000/2000 条数据，大概多久、多少钱？",
        """
先给假设，再给区间，别拍一个精确数字。

假设：7B 底座、QLoRA、rank 8–16、序列长度 1k–2k、batch 1–2 + 梯度累积、Unsloth/PEFT。

| 数据量 | 训练时间（量级） | L4 按需成本（量级） |
| --- | --- | --- |
| 200 条 | 10–30 分钟 | 几元到十几元 |
| 1000 条 | 1–3 小时 | 十几到几十元 |
| 2000 条 | 2–5 小时 | 几十元 |

实际受序列长度、epoch、是否 packing、数据加载影响很大。长序列（4k+）可能翻倍。真正的大头不是 GPU，而是**业务专家标注、清洗、验收、回归测试**的时间。

面试话术：我会先跑 200 条小样验证链路和显存，再按 val 曲线决定是否扩到 1000–2000；不会一上来包 8 卡 A100。交付报价里要把数据成本和验收成本单列，不能只报 GPU 小时。
        """,
        chapter="交付 · 成本估算",
        tags=["QLoRA", "L4", "成本", "时间"],
        follow_ups=[
            "序列长度翻倍，显存和时间怎么变？",
            "为什么实际成本里标注比 GPU 贵？",
            "怎么用 spot/竞价实例降成本？",
        ],
        rubric=[
            "先声明假设再给区间",
            "能区分 GPU 成本与数据成本",
            "给出先小样再扩容的策略",
        ],
    ),
    q(
        "LLM-022", "compare", "中档",
        "Unsloth、PEFT+TRL、Axolotl 怎么选",
        "微调框架 Unsloth、HuggingFace PEFT+Transformers+TRL、Axolotl 各自适合什么场景？",
        """
- **Unsloth**：QLoRA 优化好、速度快、显存省，Notebook 友好，适合单卡快速验证和常见开源底座。缺点是自定义能力受限于它支持的模型/算子，新架构适配可能滞后。
- **PEFT + Transformers + TRL**：官方标准套件，可控性最高，方便改 loss、target、数据管线，适合研究和定制。缺点是配置多、显存优化不如 Unsloth 激进。
- **Axolotl**：YAML 配置驱动，适合批量跑多种底座/多种参数、工程化复现。缺点是学习成本，底层仍依赖 PEFT/TRL 生态。

选型：交付先用 Unsloth 跑通小样；需要精细控制或框架不支持时转 PEFT/TRL；要批量实验/可复现流水线用 Axolotl。不要为了“工具高级”牺牲可维护性。
        """,
        chapter="交付 · 工具链",
        tags=["Unsloth", "PEFT", "TRL", "Axolotl"],
        follow_ups=[
            "Unsloth 不支持你的底座怎么办？",
            "Axolotl 的配置文件应该纳入版本管理吗？",
            "怎么保证两次训练可复现？",
        ],
        rubric=[
            "说出三者定位与取舍",
            "给交付场景的选型顺序",
            "提到可复现与版本管理",
        ],
    ),
    q(
        "LLM-023", "compare", "中档",
        "云 GPU 平台怎么选",
        "国内交付和海外实验，云 GPU 平台怎么选？免费 Colab/Kaggle 能不能用于正式项目？",
        """
按四个维度选：卡型/显存、网络与合规、计费方式、数据落地。

- **国内阿里云/腾讯云等**：访问稳定、发票合规、适合客户数据不出境；单价通常高于海外按需。
- **Lambda Labs / Runpod 等**：按小时/按秒计费，A10G/L4/A100 可选，适合实验；网络从国内访问可能不稳，数据合规要单独评估。
- **Colab/Kaggle**：适合 Demo、教学、小数据调试；不能保证时长、卡型、数据隔离，不适合正式交付和含敏感数据的训练。
- **ModelScope/HuggingFace Spaces**：模板多、上手快，但自由度和持久化受限，适合快速验证。

FDE 视角：客户数据不出域是硬约束时，优先国内云或本地卡；只做公开数据实验时再用海外按需。训练完的 adapter、日志、数据版本要能落回客户可控的存储。
        """,
        chapter="交付 · 云平台",
        tags=["云GPU", "L4", "A100", "合规"],
        follow_ups=[
            "客户要求数据不出境，你怎么部署？",
            "按需和包月怎么算盈亏平衡？",
            "免费平台的数据隐私风险怎么解释？",
        ],
        rubric=[
            "按合规/网络/计费/数据四维比较",
            "明确免费平台不适合正式交付",
            "能给出数据不出域方案",
        ],
    ),
    q(
        "LLM-024", "system", "压轴",
        "从需求到上线的完整微调链路",
        "请把“客户要一个稳定输出 JSON 的业务 Agent”从需求到上线串一遍。",
        """
八步，每一步都有验收物：

1. **需求对齐**：明确输入分布、输出 schema、拒答策略、延迟/成本上限；先判断是否真的需要微调。
2. **基线**：Prompt + few-shot + JSON schema 校验先跑；记录失败类型，确认微调能解决的那部分。
3. **数据构造**：ChatML JSONL；人工种子 + 历史清洗 + 合成扩写；脱敏、去重、去矛盾。
4. **切分与验收**：train/val 分层；独立盲测集；格式合规率、字段准确率、拒答正确率。
5. **小样训练**：QLoRA + 小 rank + 2 epoch，先验证显存、loss mask、导出、推理链路。
6. **评估**：业务集 + 格式集 + 通用回归集；和基线对比；不达标先改数据/超参，不要盲目加卡。
7. **导出与部署**：合并权重或 adapter；vLLM/FastAPI 接入；加 JSON schema 校验和失败兜底。
8. **上线与回滚**：灰度、监控格式失败率/延迟/token 成本；adapter 版本化；出问题切回底座 + Prompt 方案。

面试重点：微调不是终点，**推理侧校验和回滚方案**才是交付闭环。模型输出 JSON 仍然要在服务端校验，不能把 schema 正确性全押在模型上。
        """,
        chapter="交付 · 完整链路",
        tags=["微调链路", "验收", "部署", "回滚"],
        follow_ups=[
            "哪一步最容易出问题？",
            "上线后发现格式失败率升高，先查什么？",
            "怎么设计灰度？",
        ],
        rubric=[
            "八步完整且每步有验收物",
            "先 Prompt 基线再微调",
            "包含服务端校验与回滚",
        ],
    ),
    q(
        "LLM-025", "troubleshoot", "压轴",
        "微调交付的风险清单",
        "微调项目交付前，你会列哪些风险？怎么提前兜底？",
        """
按“数据、训练、模型、部署、业务”五类列：

- **数据**：量不足、脏、矛盾、泄漏、脱敏不彻底、覆盖偏差。兜底：抽样验收、holdout、脱敏脚本、数据版本。
- **训练**：OOM、loss 不降、过拟合、灾难性遗忘、框架不兼容新架构。兜底：小样先跑、梯度累积、早停、通用回归集、备选底座。
- **模型**：格式不稳定、幻觉、拒答过度、长上下文退化。兜底：schema 校验、RAG、拒答样本、长度分桶测试。
- **部署**：adapter 加载失败、显存不足、版本错配、吞吐不达标。兜底：预热、限流、回滚、压测。
- **业务**：验收标准模糊、客户期望“什么都能答”、数据无法出域。兜底：写清范围、基线对比、离线评估报告、本地部署方案。

面试话术：我交付前会让客户一起签“验收集”，不是只看 loss。风险清单里每一项都要有 owner 和兜底动作，否则不叫交付。
        """,
        chapter="FDE · 风险管理",
        tags=["风险清单", "验收", "回滚", "交付"],
        follow_ups=[
            "客户不提供验收集怎么办？",
            "模型效果不达标但数据不能再加，怎么谈？",
            "怎么把风险写进报价？",
        ],
        rubric=[
            "五类风险覆盖",
            "每类有兜底动作",
            "强调验收集与范围管理",
        ],
    ),
    q(
        "LLM-026", "system", "压轴",
        "微调后怎么评估才算过关",
        "微调完只看准确率够吗？业务 Agent 的微调评估应该怎么设计？",
        """
不够。至少四层：

1. **格式层**：JSON 可解析率、schema 合规率、字段缺失率、拒答格式。
2. **任务层**：意图分类 F1、字段抽取 exact match、工具选择准确率、订单状态正确率。
3. **行为层**：该拒答是否拒答、越权是否拦截、长上下文是否退化、是否复读/啰嗦。
4. **系统层**：p50/p95 延迟、token 成本、并发吞吐、失败兜底率。

评估集要独立：业务盲测集（客户提供）、格式对抗集（缺字段/多语言/超长）、通用回归集（防遗忘）、历史 bad case 集。上线前和基线（Prompt/RAG）做同集对比；上线后灰度 A/B，看真实分流和人工复核率。

面试口述：**离线评估决定能不能上线，在线监控决定要不要回滚。** 两者都要有。
        """,
        chapter="交付 · 评估",
        tags=["评估", "格式合规", "回归集", "A/B"],
        follow_ups=[
            "业务盲测集怎么避免被污染？",
            "格式合规 99% 但任务准确率 70%，能上线吗？",
            "怎么评估拒答是否正确？",
        ],
        rubric=[
            "四层评估覆盖",
            "评估集独立且含对抗/回归",
            "离线 + 在线闭环",
        ],
    ),
    q(
        "LLM-027", "compare", "高频",
        "客户要稳定 JSON，先 Prompt 还是先 LoRA",
        "客户说“我要模型每次都返回固定 JSON”，你的方案顺序是什么？为什么？",
        """
顺序：**Prompt + few-shot + schema 校验 → 结构化输出/约束解码 → LoRA → 全量 SFT**。

1. Prompt 里写清 schema、字段枚举、空值策略、拒答格式；给 3–5 个 few-shot。
2. 服务端加 JSON schema 校验和重试/兜底；不要假设模型 100% 正确。
3. 如果 Prompt 越来越长、延迟/成本高，或模型经常漏字段，再上 LoRA 学格式。
4. 如果 LoRA 仍不稳，考虑约束解码/grammar-based decoding，而不是盲目全量。
5. 全量 SFT 是最后手段，成本高且不一定解决格式问题。

面试官追问“为什么不用 LoRA 一步到位”，回答：格式问题首先是指令和校验问题，不是参数问题；LoRA 会把格式学成概率行为，仍然可能错。**能用 schema 校验兜住的，不要用训练兜。**
        """,
        chapter="交付 · 方案顺序",
        tags=["JSON", "Prompt", "LoRA", "schema"],
        follow_ups=[
            "约束解码和 LoRA 哪个更稳？",
            "few-shot 放几条合适？",
            "schema 校验失败后怎么重试？",
        ],
        rubric=[
            "先 Prompt/校验再 LoRA",
            "指出 LoRA 不保证 100% 格式",
            "提到约束解码/兜底",
        ],
    ),
    q(
        "LLM-028", "code", "压轴",
        "LoRA 导出、合并与部署怎么选",
        "训练完的 LoRA adapter 怎么导出？合并权重和动态加载怎么选？部署到 vLLM/FastAPI 要注意什么？",
        """
导出物通常是一个目录：`adapter_config.json` + `adapter_model.safetensors`，几十 MB 到几百 MB，取决于 rank/target。

**合并：**
```python
from peft import PeftModel
base = AutoModelForCausalLM.from_pretrained(base_path, torch_dtype="auto")
model = PeftModel.from_pretrained(base, adapter_path)
model = model.merge_and_unload()
model.save_pretrained(out_path)
```
合并后是一个独立底座，推理无额外分支，适合固定业务；缺点是每个客户一份权重，显存/存储成本高。

**动态加载：**
底座一份，vLLM 按请求加载 adapter；适合多租户。要注意 adapter 版本、显存预留、冷启动、租户路由。

部署检查：
- tokenizer/chat template 必须和训练时一致。
- 合并后跑一遍格式集，确认没有精度/配置漂移。
- vLLM 的 `max_lora_rank`、`max_loras` 要和 adapter 匹配。
- FastAPI 侧加超时、重试、schema 校验和回滚开关。
        """,
        chapter="交付 · 导出部署",
        tags=["merge", "adapter", "vLLM", "部署"],
        follow_ups=[
            "merge 后效果变差，可能是什么原因？",
            "adapter 版本怎么管理？",
            "vLLM 加载 LoRA 失败怎么排查？",
        ],
        rubric=[
            "说清 adapter 导出物",
            "比较合并与动态加载",
            "部署检查覆盖 tokenizer/vLLM/schema",
        ],
    ),

    # ------------------------------------------------------------------
    # 4. 模型原理
    # ------------------------------------------------------------------
    q(
        "LLM-029", "concept", "基础",
        "Transformer 极简口述",
        "用 1 分钟讲清 Transformer 的前向流程，面试官不要求公式。",
        """
一句话：**把文本切成 token，变成向量，经过多层“注意力 + 前馈网络”，输出下一个 token 的概率分布。**

流程：
1. 文本 → tokenizer → token id。
2. token id → embedding 查表，得到向量；加上位置信息（现在主流是 RoPE）。
3. 每层做：
   - Self-Attention：每个 token 用 Q 去和所有 token 的 K 算相关性，加权聚合 V，得到上下文表示。
   - FFN/MLP：对每个 token 独立做非线性变换。
   - 残差 + LayerNorm/RMSNorm，保证深层可训练。
4. 最后一层 → lm_head → logits → softmax/采样 → 下一个 token。
5. 自回归：把新 token 接回去，重复，直到 EOS 或长度上限。

面试加分：现在主流大模型是 **Decoder-only**，不是原始论文的 Encoder-Decoder；注意力用 causal mask，只能看前面。MoE 只是把 FFN 换成“路由到部分专家”，注意力和残差框架不变。
        """,
        chapter="原理 · Transformer",
        tags=["Transformer", "Self-Attention", "Decoder-only", "token"],
        follow_ups=[
            "残差连接解决什么问题？",
            "LayerNorm 和 RMSNorm 的区别？",
            "为什么输出 logits 后还要采样？",
        ],
        rubric=[
            "流程完整：token→embedding→attention→FFN→logits",
            "指出主流是 Decoder-only",
            "能解释自回归",
        ],
    ),
    q(
        "LLM-030", "compare", "高频",
        "Encoder-only、Decoder-only、Encoder-Decoder、CED",
        "BERT、GPT、T5 和 DeepSeek V4.1-Flash 的 CED 分别是什么结构？各自适合什么？",
        """
- **Encoder-only（BERT）**：双向注意力，看全句，适合理解/分类/抽取，不擅长自由生成。
- **Decoder-only（GPT/LLaMA/DeepSeek V3/V4）**：causal mask，单向看前面，自回归生成；工程最简单，主流 LLM 都是这类。
- **Encoder-Decoder（T5/BART）**：编码器理解输入，解码器交叉注意力生成输出；适合翻译/摘要等输入输出分离任务。
- **CED（Causal Encoder-Decoder，V4.1-Flash）**：不是传统 T5 式双塔，而是把 40 层切成前 20 层 causal encoder + 后 20 层 decoder；decoder 的 global KV 由 encoder 最终隐状态投影生成。输入侧只激活 8B，输出侧激活 16B，prefill 计算量接近减半。

关键差异：传统 Encoder-Decoder 有独立的 cross-attention；CED 是同一骨干的前后分段，用 encoder 输出构造 decoder 的全局 KV，保留 decoder 的 sliding-window attention。面试时不要把 CED 说成 T5。
        """,
        chapter="原理 · 架构",
        tags=["Encoder", "Decoder", "CED", "T5", "BERT"],
        follow_ups=[
            "CED 和 T5 的 cross-attention 有什么不同？",
            "为什么 Decoder-only 成为主流？",
            "Encoder-only 能不能做生成？",
        ],
        rubric=[
            "四种结构对应正确",
            "CED 描述准确，不混淆 T5",
            "能说出各自适用任务",
        ],
    ),
    q(
        "LLM-031", "concept", "中档",
        "Self-Attention 的 Q/K/V 与多头",
        "为什么注意力要分 Q、K、V？缩放因子 1/sqrt(d) 是干什么的？多头解决什么问题？",
        """
Q（Query）、K（Key）、V（Value）是三种投影：
- Q：当前 token 想找什么。
- K：每个 token 能被怎样匹配。
- V：匹配上之后，实际取走的信息。

计算：`softmax(QK^T / sqrt(d)) @ V`。缩放 `1/sqrt(d)` 是为了防止维度大时点积方差过大，softmax 进入饱和区、梯度变小。

多头：把表示切成多个子空间，每个头学不同的关系（语法、指代、位置等），最后拼接/投影。多头不是简单“多算几遍”，而是让模型并行关注不同模式。

面试加分：MLA（Multi-head Latent Attention）不是普通多头，它把 K/V 压缩到低秩 latent，推理时只缓存 latent，显著降低 KV cache；DeepSeek V2/V3 的核心之一。
        """,
        chapter="原理 · Attention",
        tags=["QKV", "多头", "缩放", "MLA"],
        follow_ups=[
            "为什么 softmax 前要 mask？",
            "MHA、MQA、GQA、MLA 的区别？",
            "注意力复杂度为什么是 O(L²)？",
        ],
        rubric=[
            "Q/K/V 角色说清",
            "缩放因子解释正确",
            "能延伸到 MLA",
        ],
    ),
    q(
        "LLM-032", "concept", "高频",
        "RoPE 与长上下文外推",
        "RoPE 是怎么编码位置的？为什么长上下文会远端衰减？1M 上下文只靠 RoPE 外推行不行？",
        """
RoPE 用旋转矩阵把位置信息编码进 Q/K：不同位置旋转不同角度，点积结果自然带上相对位置关系。它比绝对位置编码更适合外推，也不是简单加一个位置向量。

远端衰减：训练时见过的相对距离有限，超出训练分布后，注意力分数会变得不稳定/模糊；加上 softmax 在长序列上被大量 token 稀释，远端信息更容易被淹没。所以“把 RoPE 外推到 1M”不等于模型真的能用 1M。

DeepSeek 的做法不是只改 RoPE：V3.2 用 DSA 稀疏注意力，V4 用 CSA/HCA 混合压缩，V4.1-Flash 用 CED + CSA2 + SWA，都是从**注意力结构和 KV 缓存**层面解决长上下文，不是单靠位置编码。

面试话术：RoPE 解决“位置怎么表示”，长上下文还解决“算得起、存得下、找得到”三件事。
        """,
        chapter="原理 · 位置编码",
        tags=["RoPE", "长上下文", "外推", "衰减"],
        follow_ups=[
            "YaRN 是怎么扩上下文的？",
            "RoPE 和 ALiBi 的区别？",
            "长上下文“找得到”怎么评估？",
        ],
        rubric=[
            "RoPE 旋转/相对位置说清",
            "解释远端衰减",
            "指出长上下文不只靠 RoPE",
        ],
    ),
    q(
        "LLM-033", "concept", "压轴",
        "KV Cache 是什么，为什么吃显存",
        "KV Cache 缓存了什么？为什么长上下文/高并发时显存爆炸？footprint 怎么估算？",
        """
自回归生成时，每生成一个新 token，都要和前面所有 token 做注意力。前面 token 的 K/V 不会变，所以缓存起来，避免重复计算。缓存的是每层、每个 token 的 K 和 V（MLA 架构缓存的是压缩后的 latent）。

显存近似：
```text
KV bytes ≈ 2 * layers * kv_heads * head_dim * seq_len * batch * dtype_bytes
```
（K 和 V 各一份；GQA/MLA 会显著减少 kv_heads 或缓存维度。）

长上下文 + 高并发 = `seq_len * batch` 同时放大；所以 1M 上下文不是“模型能读”，而是“服务端要有对应的 HBM/SSD 分层”。这也是 PagedAttention、prefix cache、量化 KV、稀疏 KV、CSA2 这些技术存在的原因。

面试加分：区分 **模型权重显存** 和 **KV cache 显存**；前者固定，后者随并发/长度增长，是推理服务的主要变量。
        """,
        chapter="原理 · KV Cache",
        tags=["KV Cache", "显存", "并发", "MLA"],
        follow_ups=[
            "GQA 为什么能省 KV cache？",
            "prefix cache 命中条件是什么？",
            "KV cache 能放到 CPU/SSD 吗？",
        ],
        rubric=[
            "说清缓存 K/V 的目的",
            "给出 footprint 公式",
            "区分权重与 KV 显存",
        ],
    ),
    q(
        "LLM-034", "compare", "高频",
        "PagedAttention、Chunked Prefill、Prefix Cache",
        "vLLM 的 PagedAttention、Chunked Prefill、Prefix Cache 分别解决什么问题？别混在一起。",
        """
- **PagedAttention**：把 KV cache 按页管理，像操作系统虚拟内存，减少碎片和过度预留；解决“显存利用率/并发”问题。
- **Chunked Prefill**：把长 prompt 的 prefill 切成小块，和 decode 交错调度，避免长 prefill 阻塞其他请求；解决“尾延迟/调度公平”。
- **Prefix Cache**：相同前缀的 KV 复用，比如固定 system prompt、few-shot、多轮对话历史；解决“重复算同一段前缀”。

三者不替代：
```text
PagedAttention → 省显存、提并发
Chunked Prefill → 降长请求对短请求的阻塞
Prefix Cache   → 少算重复前缀
```
再加上量化 KV（省字节）、稀疏 KV（少读）、推测解码（少步数），才是完整的推理优化栈。

面试时如果被问“PagedAttention 能不能解决长上下文”，回答：它解决显存管理，不减少 KV 本身；长上下文还要靠模型结构（MLA/CSA/DSA）或缓存压缩。
        """,
        chapter="原理 · 推理优化",
        tags=["PagedAttention", "Chunked Prefill", "Prefix Cache", "vLLM"],
        follow_ups=[
            "PagedAttention 的 page 大小怎么影响性能？",
            "Chunked Prefill 会牺牲什么？",
            "Prefix Cache 什么时候失效？",
        ],
        rubric=[
            "三者各自问题说清",
            "不把它们当成同一个优化",
            "能延伸到量化/稀疏/推测",
        ],
    ),
    q(
        "LLM-035", "compare", "压轴",
        "量化 KV、稀疏 KV、SWA 怎么取舍",
        "长上下文推理优化里，量化 KV、稀疏 KV、滑动窗口各有什么代价？",
        """
- **量化 KV**：把 KV 存成 FP8/FP4，直接省字节和带宽。代价是精度损失、反量化开销、硬件支持差异。DeepSeek V4.1-Flash 把 global KV 压到 FP4，是典型案例。
- **稀疏 KV / 稀疏注意力**：只保留/计算 Top-K 相关 token，降低注意力和读取量。代价是 indexer 本身有成本，可能漏掉远处关键信息；DSA 用 lightning indexer + top-k 2048，把核心注意力从 O(L²) 降到 O(Lk)。
- **SWA（滑动窗口注意力）**：只保留最近 W 个 token 的 KV，远处信息不直接可见。代价是长程依赖弱；通常要和全局压缩分支配合（V4 的 CSA/HCA、V4.1 的 CED+CSA2）。

没有单一赢家：量化省“字节”，稀疏省“读取/计算”，SWA 省“缓存长度”。生产上通常叠加，并按任务评估长程检索、摘要、多轮一致性。
        """,
        chapter="原理 · 长上下文优化",
        tags=["量化KV", "稀疏KV", "SWA", "长上下文"],
        follow_ups=[
            "FP4 KV 对精度影响怎么评估？",
            "Top-K 选错 token 会怎样？",
            "SWA 窗口一般设多大？",
        ],
        rubric=[
            "三种手段的代价说清",
            "能对应到 V4/V4.1 的设计",
            "强调按任务评估",
        ],
    ),
    q(
        "LLM-036", "concept", "高频",
        "推测解码与 DSpark",
        "推测解码（Speculative Decoding）怎么加速？DSpark 的 confidence-scheduled verification 是什么？",
        """
推测解码：小 drafter 先快速猜接下来 k 个 token，大模型一次前向并行验证这 k 个；接受的前缀保留，第一个拒绝位置由大模型给出正确 token。因为大模型一次验证 k 个比逐 token 生成 k 次便宜，所以吞吐提升。

关键指标是**接受率**：drafter 越准，收益越大；接受率低时，验证开销反而浪费。常见 drafter：小模型、EAGLE、Medusa、MTP 头。

DSpark（V4.1-Flash）：3 层 Transformer drafter，滑动窗口 128，一次前向给出 5 个草稿位置的 base logits；轻量 Markov 头建模草稿 token 间依赖；confidence head 预测逐位置接受概率，调度器结合引擎吞吐曲线动态选择验证长度。它不是 V3 那种和主干联合训练的 MTP，而是预训练后单独训练，后训练阶段不回传梯度到主干。

面试话术：推测解码是“用算力换延迟”，不是无损压缩；接受率、drafter 成本、batch 大小决定实际收益。
        """,
        chapter="原理 · 推测解码",
        tags=["Speculative Decoding", "DSpark", "MTP", "接受率"],
        follow_ups=[
            "接受率低时怎么调？",
            "推测解码会影响输出分布吗？",
            "MTP 和 DSpark 的区别？",
        ],
        rubric=[
            "drafter + 验证流程说清",
            "指出接受率是核心",
            "DSpark 描述准确",
        ],
    ),
    q(
        "LLM-037", "concept", "高频",
        "MoE 路由、共享专家与负载均衡",
        "MoE 的专家、路由、共享专家、fine-grained experts 分别是什么？负载不均衡会怎样？",
        """
MoE 把 Transformer 的 FFN 换成多个专家，每个 token 只激活其中一部分：

- **Router/Gate**：给 token 打分，选 Top-k 专家。
- **Routed experts**：被选中的专家做 FFN。
- **Shared experts**：所有 token 都走的公共专家，承载通用知识，减少路由碎片化。
- **Fine-grained experts**：把专家切得更细、数量更多，路由组合更灵活，但通信/调度更复杂。

负载不均衡：少数专家被打爆、多数闲置，导致训练不稳定、显存/通信瓶颈、专家塌缩。DeepSeek V3 用 **auxiliary-loss-free** 负载均衡（给路由加 bias 调整），比传统 aux loss 更不伤性能；V4 还加了 sequence-wise balance loss 防单序列内极端不平衡。

面试加分：MoE 的“参数量大”不等于“计算量大”，每 token 只激活部分专家；但显存要装下所有专家，通信也更复杂。
        """,
        chapter="原理 · MoE",
        tags=["MoE", "router", "共享专家", "负载均衡"],
        follow_ups=[
            "auxiliary-loss-free 怎么工作？",
            "MoE 为什么通信成本高？",
            "专家塌缩怎么诊断？",
        ],
        rubric=[
            "MoE 角色说清",
            "负载不均衡后果说清",
            "能提到 DeepSeek 的负载均衡",
        ],
    ),
    q(
        "LLM-038", "troubleshoot", "压轴",
        "MoE 模型做 LoRA 为什么坑多",
        "为什么很多微调框架对 MoE 支持差？给 MoE 做 LoRA 要注意什么？",
        """
MoE 多了 router 和专家并行，微调难点：

1. **target 映射复杂**：expert FFN 的参数名和 dense 不一样，不同框架的 target_modules 匹配规则不同；有的只支持 attention，不支持 expert。
2. **路由漂移**：训练时如果 router 也更新，token 可能被分到不同专家，导致专家负载变化、训练不稳；通常冻结 router 或只训 expert adapter。
3. **专家并行/通信**：训练框架要支持 EP/TP，LoRA adapter 的切分和合并更复杂。
4. **显存**：所有专家都要加载，QLoRA 对 MoE 的量化支持不一定完整。
5. **评估难**：dense 的指标不能直接套，路由分布变化会带来不可解释的性能波动。

落地建议：优先选官方/社区验证过的底座和框架；先冻结 router，只对 attention + 部分 expert 做小 rank 消融；小数据先跑通，不要直接上生产。
        """,
        chapter="原理 · MoE 微调",
        tags=["MoE", "LoRA", "router", "专家并行"],
        follow_ups=[
            "冻结 router 后效果不够怎么办？",
            "MoE 的 adapter 怎么合并？",
            "怎么监控路由分布？",
        ],
        rubric=[
            "指出 target/路由/通信/显存四类坑",
            "给出冻结 router 的保守策略",
            "强调小样验证",
        ],
    ),
    q(
        "LLM-039", "concept", "压轴",
        "DeepSeek V3 的四个关键设计",
        "DeepSeek V3 为什么能用 671B 参数、37B 激活做到低成本训练和推理？",
        """
四个关键：

1. **MLA（Multi-head Latent Attention）**：把 K/V 压缩成低秩 latent，推理只缓存 latent，显著降 KV cache；这是 DeepSeek V2 起就验证过的。
2. **DeepSeekMoE**：fine-grained routed experts + shared experts，每 token 只激活部分专家，参数量大但计算省。
3. **Auxiliary-loss-free 负载均衡**：用路由 bias 调整代替传统 aux loss，减少负载均衡对语言建模性能的损害。
4. **MTP（Multi-Token Prediction）**：训练时同时预测多个未来 token，提升数据效率和表示能力；推理时可配合投机解码。

数据：14.8T tokens；训练成本 2.788M H800 GPU hours；训练过程稳定，没有不可恢复的 loss spike/rollback。这些数字面试时能报出来，比“很强”有说服力。
        """,
        chapter="DeepSeek · V3",
        tags=["DeepSeek V3", "MLA", "MoE", "MTP"],
        follow_ups=[
            "MLA 和 GQA 的区别？",
            "MTP 训练和推理分别怎么用？",
            "auxiliary-loss-free 的 bias 怎么更新？",
        ],
        rubric=[
            "四个设计说全",
            "能报出 671B/37B/14.8T/2.788M",
            "解释 MLA 省 KV 的原理",
        ],
    ),
    q(
        "LLM-040", "concept", "压轴",
        "DeepSeek V3.2 的 DSA 到底改了什么",
        "V3.2 相对 V3.1-Terminus 的唯一架构改动是什么？DSA 的两个组件、复杂度和训练流程是什么？",
        """
唯一架构改动：引入 **DSA（DeepSeek Sparse Attention）**，通过继续训练注入；其余结构与 V3.2-Exp 相同。参数 671B/37B，上下文 128K。

DSA 两个组件：
1. **Lightning Indexer**：轻量多头，算每个 query 对历史 token 的 index score；用 ReLU、FP8，成本很低。
2. **Fine-grained Token Selection**：每个 query 只保留 Top-k（默认 k=2048）个 KV 做注意力。

复杂度：核心注意力从 O(L²) 降到 O(Lk)；indexer 本身仍是 O(L²)，但比 MLA 便宜得多，且可用 FP8。

训练：从 V3.1-Terminus 继续训练。第一阶段 dense warm-up（2.1B tokens，1000 步），冻结主模型只训 indexer，让 indexer 模仿 dense attention 分布；第二阶段 sparse 训练（943.7B tokens，15000 步），打开 top-k，全模型适配稀疏注意力，indexer 输入 detach。

配套：大规模 RL（后训练算力 > 预训练 10%）、Agentic 任务合成管线；V3.2-Speciale 是高算力推理变体。NVIDIA 的 TensorRT-LLM 实现里 Top-K 取 2048，短序列 ≤2048 直接走 dense fast path。
        """,
        chapter="DeepSeek · V3.2",
        tags=["DeepSeek V3.2", "DSA", "lightning indexer", "top-k"],
        follow_ups=[
            "DSA 的 indexer 为什么用 ReLU/FP8？",
            "Top-K 2048 怎么选？短序列怎么办？",
            "DSA 和 NSA 的区别？",
        ],
        rubric=[
            "唯一架构改动说对",
            "indexer + top-k 说清",
            "复杂度和训练两阶段说清",
        ],
    ),

    # ------------------------------------------------------------------
    # 5. DeepSeek V4 / V4.1-Flash
    # ------------------------------------------------------------------
    q(
        "LLM-DS-01", "concept", "压轴",
        "DeepSeek V4 的混合注意力与 mHC",
        "DeepSeek V4 的 Pro/Flash 规格、CSA+HCA、mHC、Muon、推理模式分别是什么？",
        """
V4 是 MoE 系列，保留 DeepSeekMoE + MTP，2026-04-24 预览，V4-Flash 7 月、V4-Pro 8 月正式版：

| 型号 | 总参 | 激活 | 上下文 |
| --- | --- | --- | --- |
| V4-Pro | 1.6T | 49B | 1M |
| V4-Flash | 284B（模型卡写 285B） | 13B | 1M |

关键设计：
- **混合注意力 CSA + HCA**：CSA 沿序列压缩 KV 并接 DSA 稀疏注意力；HCA 用更大压缩率但保持 dense 注意力。两者互补。
- **mHC（Manifold-Constrained Hyper-Connections）**：把残差映射约束到双随机矩阵流形（Birkhoff 多面体），提升深层信号传播稳定性，同时保留表达能力。
- **Muon 优化器**：更快收敛、训练更稳。
- **三种推理模式**：Non-think / Think High / Think Max。

效率：1M 上下文下，V4-Pro 单 token 推理 FLOPs 约为 V3.2 的 27%，KV cache 约为 10%。预训练 32T tokens。

注意：**V4 是 CSA+HCA 混合；V4.1-Flash 才是 pure CSA2。** 不要把两者混着说。
        """,
        chapter="DeepSeek · V4",
        tags=["DeepSeek V4", "CSA", "HCA", "mHC", "Muon"],
        follow_ups=[
            "HCA 和 CSA 的分工是什么？",
            "mHC 解决什么问题？",
            "V4-Pro 的 27%/10% 是相对谁？",
        ],
        rubric=[
            "Pro/Flash 规格说对",
            "CSA+HCA、mHC、Muon 说清",
            "明确 V4 与 V4.1 的注意力差异",
        ],
    ),
    q(
        "LLM-DS-02", "concept", "压轴",
        "V4.1-Flash 的 CED 非对称编解码",
        "V4.1-Flash 的 CED 是怎么把 prefill 计算量减半的？为什么输入 8B、输出 16B？",
        """
V4.1-Flash 是 552B 主干 MoE，40 层 Transformer，前 20 层是 causal encoder，后 20 层是 decoder。关键：**decoder 的 global KV 由 encoder 最终隐状态投影生成**，不再让每个 prompt token 完整穿过全部 40 层。

效果：
- prefill 每 token 激活约 8B，decode 激活约 16B。
- 长输入 prefill 计算量接近减半（从 O(N·L) 降到约 O(N·L/2 + n_win·L/2)）。
- decode FLOPs 随上下文增长几乎恒定：4K→1M 只增加约 1/4，而 V4-Flash 增长更大。

为什么非对称：Agent 负载是 input-heavy（大量文档、工具结果、历史），prefill 贵；生成阶段只出少量 token，decode 可以更重。把“读”和“写”拆开，输入侧轻、输出侧重，正好匹配 Agent 的 token 比例。

注意：CED 不是 T5 式双塔，也没有独立 cross-attention；它是同一骨干的前后分段 + 全局 KV 投影。面试时这句话能区分你是不是真读过报告。
        """,
        chapter="DeepSeek · V4.1-Flash",
        tags=["DeepSeek V4.1", "CED", "prefill", "decode"],
        follow_ups=[
            "CED 的 decoder 还保留 SWA 吗？",
            "为什么 decode 激活比 prefill 大？",
            "CED 对微调生态有什么影响？",
        ],
        rubric=[
            "20+20 层与 global KV 投影说清",
            "8B/16B 与非对称动机说清",
            "不混淆 T5",
        ],
    ),
    q(
        "LLM-DS-03", "concept", "压轴",
        "CSA2 的 Full / Reindex / Reuse 三种模式",
        "CSA2 跨层复用了什么？三种模式分别怎么工作？为什么能省 KV 和索引计算？",
        """
CSA2（Compressed Sparse Attention 2）沿三个维度压缩：head 维（投影共享）、序列维（每 m 个 token 压成一个 entry）、层维（跨层复用）。

三种静态分配模式：
- **Full**：当前层自己算 main KV、indexer K，并生成 Top-K indices。
- **Reindex**：复用前一个 Full 层的 main KV 和 indexer K，但用自己的 indexer Q 重新打分，选新的 Top-K。
- **Reuse**：连 Top-K indices 也复用前一个产索引的层，直接做稀疏注意力。

所有模式都保留自己的 global Q 和 SWA KV；共享的是 global KV / indexer K / Top-K indices。这样减少重复缓存和索引计算。Reuse 层在 prefill 只需约 15 个 kernel，decode 约 11 个。

面试加分：CSA2 和 V3.2 的 DSA 不是一回事。DSA 是单层 lightning indexer + top-k；CSA2 是跨层复用 + 层次化稀疏索引器 + 压缩，目标是压 KV footprint 和索引成本。
        """,
        chapter="DeepSeek · V4.1-Flash",
        tags=["CSA2", "Full", "Reindex", "Reuse", "跨层复用"],
        follow_ups=[
            "Reindex 和 Reuse 的取舍是什么？",
            "CSA2 和 DSA 的区别？",
            "为什么每层还要保留自己的 SWA KV？",
        ],
        rubric=[
            "三种模式说清",
            "共享/不共享的边界说清",
            "能对比 DSA",
        ],
    ),
    q(
        "LLM-DS-04", "concept", "压轴",
        "V4.1-Flash 的 KV 压缩数字",
        "890 bytes/token、1/4、1/8、437 倍分别指什么？SWA Bounded Replay 怎么做到？",
        """
四个数字对应不同口径：

- **890 bytes/token**：global KV（常驻 HBM）的 footprint，约为 V4-Flash 的 1/4。
- **1/8**：persistent KV（落 SSD/主机内存、用于前缀复用的部分）约为 V4-Flash 的 1/8，靠 SWA Bounded Replay。
- **437 倍**：相对 DeepSeek V1 的 389,120 bytes/token，KV cache 累计缩小约 437 倍。
- **FP4**：global KV 用 FP4 存储，进一步省字节。

SWA Bounded Replay：把 encoder 的局部 SWA 状态（只在活跃会话短时间内有用）从长期存储里移走；状态过期后，如果用户继续任务，就重算最近 128 个 token，近似恢复局部状态。用少量重算换掉长期保存开销。官方称已测场景质量影响很小，但极端长上下文检索/会话恢复仍是后续测试重点。

面试提醒：这是**部署优化 + 缓存精度 + 架构**三者联合的结果，不是单一“压缩算法”。
        """,
        chapter="DeepSeek · V4.1-Flash",
        tags=["KV Cache", "FP4", "SWA Bounded Replay", "890 bytes"],
        follow_ups=[
            "global KV 和 persistent KV 的区别？",
            "Bounded Replay 的质量风险在哪？",
            "FP4 KV 对硬件有什么要求？",
        ],
        rubric=[
            "四个数字口径不混",
            "Bounded Replay 说清",
            "指出质量风险",
        ],
    ),
    q(
        "LLM-DS-05", "concept", "压轴",
        "Engram、DSpark、SinglePass mHC 是什么",
        "V4.1-Flash 除了 CED/CSA2，还加了 Engram、DSpark、SinglePass mHC，各自解决什么？",
        """
- **Engram（196B 条件记忆）**：查表式条件记忆，不增加每 token 激活计算。用 2/3/4-gram 多哈希头，把常见短语存到大量小表里；推理时确定性寻址，可从主机内存后台 RDMA 预取。放在第 1、14 层，FP8。作用是“记忆与计算解耦”，让 MoE 专注组合推理。
- **DSpark（推测解码）**：3 层 drafter，窗口 128，一次前向给 5 个草稿位置；Markov 头建模依赖，confidence head 预测接受率，调度器按引擎吞吐动态选验证长度。预训练后单独训练，不回传梯度到主干。
- **SinglePass mHC**：原 mHC 的输入混合系数要等隐藏维规约，导致 kernel 串行；SinglePass 让每个 block 消费上一个 block 的混合系数，依赖消失，Mega-mHC kernel 把激活访存从 (4n+4)d 降到 (2n+2)d，约减半。

这三个点分别对应：记忆、解码速度、训练/推理 kernel 效率。面试时能各用一句话说清，比堆名词强。
        """,
        chapter="DeepSeek · V4.1-Flash",
        tags=["Engram", "DSpark", "SinglePass mHC", "条件记忆"],
        follow_ups=[
            "Engram 为什么不增加激活计算？",
            "DSpark 和 MTP 的区别？",
            "SinglePass mHC 为什么能减半访存？",
        ],
        rubric=[
            " three 组件各自目标说清",
            "Engram 查表机制说清",
            "DSpark 调度说清",
        ],
    ),
    q(
        "LLM-DS-06", "compare", "压轴",
        "DeepSeek V3/V3.2/V4/V4.1 一页对照",
        "把 DeepSeek V3、V3.2、V4、V4.1-Flash 的关键差异讲清楚，并纠正常见错误说法。",
        """
| 版本 | 参数/激活 | 上下文 | 核心架构 | 关键点 |
| --- | --- | --- | --- | --- |
| V3 | 671B/37B | 128K | MLA + DeepSeekMoE + MTP | 14.8T tokens，2.788M H800 hours |
| V3.2 | 671B/37B | 128K | V3 + DSA | 唯一架构改动；lightning indexer + top-k 2048；RL >10% 预训练 |
| V4-Pro | 1.6T/49B | 1M | CSA+HCA、mHC、Muon | 32T tokens；1M 下 FLOPs 27%、KV 10% vs V3.2 |
| V4-Flash | 284B/13B | 1M | 同上 | 正式版 2026-07 |
| V4.1-Flash | 552B/8B prefill、16B decode | 1M | CED + pure CSA2 + FP4 KV + Engram + DSpark | 890 B/token；persistent KV 1/8；45T 多模态 tokens |

常见错误：
1. “V4.1-Flash 是 CSA2 + HCA 混合” — 错。V4 是 CSA+HCA，V4.1-Flash 是 **pure CSA2**。
2. “V4.1-Flash 1M 下 FLOPs 是 V3.2 的 27%” — 这是 V4-Pro 的数据；V4.1-Flash 的说法是 decode FLOPs 随上下文几乎恒定，4K→1M 只增约 1/4。
3. “V4.1-Flash 是 285B” — 技术报告写 552B 主干；V4-Flash 才是 284B/285B 口径。
4. “V4.1 Pro 已发布” — 截至 2026-10-31 没有；V4 Pro 继续提供，V4.1-Flash 在 10-17 升级到 1017。

面试话术：先讲“每一代在解决什么瓶颈”——V3 解决 MoE 训练效率，V3.2 解决长上下文注意力成本，V4 解决百万上下文，V4.1-Flash 解决 Agent input-heavy 的 prefill 和 KV 存储。
        """,
        chapter="DeepSeek · 版本对照",
        tags=["DeepSeek", "版本对照", "纠错", "V4.1-Flash"],
        follow_ups=[
            "哪一代开始引入 DSA？",
            "V4.1-Flash 为什么不是 decoder-only？",
            "V4.1 Pro 现在能用吗？",
        ],
        rubric=[
            "四代关键差异说清",
            "至少纠正 CSA2+HCA 的错误",
            "能用“解决什么瓶颈”串起来",
        ],
    ),

    # ------------------------------------------------------------------
    # 6. Jev / System One
    # ------------------------------------------------------------------
    q(
        "LLM-JEV-01", "concept", "高频",
        "Jev 是什么，和 LLM/JSON Mode/规则引擎的区别",
        "TypeSafe 的 Jev 是什么？它和生成式 LLM、LLM 的 JSON mode、手写规则引擎有什么不同？",
        """
Jev 是 TypeSafe AI 的 **System One 决策模型**：输入一段 state（文本/JSON/图片等）+ 一组结构化问题，输出 typed decision（Choice / Noul / Score）和校准概率；不生成自然语言。

对比：
- **生成式 LLM**：逐 token 生成文本，慢、贵、可能格式错；Jev 一次并行评估所有问题，70–500ms 量级，输出天然符合 schema。
- **LLM JSON mode**：仍然是自回归生成再解析，格式错误率低但非零；Jev 从训练目标上就是结构化决策，官方称 schema 错误率为 0（注意：这不等于决策一定正确）。
- **规则引擎**：确定性、便宜，但覆盖不了模糊语言；Jev 用语义理解做判断，但仍可能错，需要置信度阈值和人工兜底。

官方定位：给软件用的“小脑”，不是聊天/写作/代码模型。它适合高频、固定选项、需要概率的判定；不适合开放式推理、长文生成、复杂规划。

一句话：**LLM 负责“想和写”，Jev 负责“快速判”。**
        """,
        chapter="Agent · Jev / System One",
        tags=["Jev", "System One", "决策模型", "JSON mode"],
        follow_ups=[
            "Jev 0% schema 错误是什么意思？",
            "Jev 会幻觉吗？",
            "什么任务不该用 Jev？",
        ],
        rubric=[
            "定位为 typed decision 而非生成",
            "四类对比说清",
            "明确 schema 正确≠判断正确",
        ],
    ),
    q(
        "LLM-JEV-02", "code", "压轴",
        "Choice / Noul / Score 三种原语怎么用",
        "Jev 的 Choice、Noul、Score 分别返回什么？给一个 Agent 工具护栏的例子，说明怎么用置信度阈值分流。",
        """
三种原语：

- **Noul**：是/否概率，返回 0–1。适合过滤、拦截、是否继续。
- **Choice**：从你给的候选里选一个（最多 255 个），返回选中项、全分布、confidence。适合意图路由、工具选择。
- **Score**：按你定义的有序等级打分（2–10 级），返回概率加权位置、每级分布、confidence。适合风险/优先级/相关性。

Agent 工具护栏示例：
```python
questions = {
  "risk": {
    "type": "score",
    "criteria": "1=只读查询；5=写文件；10=删除/转账/提权",
    "levels": 10,
  },
  "needs_confirm": {
    "type": "noul",
    "criteria": "这条命令是否会造成不可逆副作用？",
  },
}
# 伪代码
decision = jev.decide(state=tool_call, questions=questions)
if decision["risk"].score >= 8 and decision["risk"].confidence > 0.8:
    block()
elif decision["risk"].score >= 5 or decision["needs_confirm"].noul > 0.6:
    ask_human()
else:
    allow()
```

阈值不是拍脑袋：按“误放行”和“误拦截”的成本定；高 stakes 动作阈值高，低 stakes 可以低。所有低置信都走人工/大模型复核，不要让 Jev 单独做不可逆动作。
        """,
        chapter="Agent · Jev / System One",
        tags=["Jev", "Choice", "Noul", "Score", "护栏"],
        follow_ups=[
            "阈值怎么用历史数据校准？",
            "Choice 的 255 个选项够用吗？",
            "Score 的等级怎么设计？",
        ],
        rubric=[
            "三种原语返回说清",
            "护栏例子可运行",
            "置信度阈值与人工兜底",
        ],
    ),
    q(
        "LLM-JEV-03", "system", "压轴",
        "Jev 怎么评估，为什么校准度是关键",
        "Jev 这类决策模型不看 BLEU，应该看哪些指标？可靠性图怎么读？",
        """
核心不是“答对率” alone，而是**校准（calibration）**：模型说 80% 置信时，是否真的约 80% 正确。

评估集：带标签的历史决策样本，覆盖正负、边界模糊、分布漂移。指标：
1. **AUC / F1 / accuracy**：基础判别能力。
2. **ECE（Expected Calibration Error）**：分桶比较置信度与真实准确率。
3. **Reliability Diagram**：横轴置信度、纵轴实际准确率，理想是对角线；高于对角线=欠自信，低于=过自信。
4. **分流收益**：自动放行比例、人工复核量、降级到大模型比例、端到端 p95 延迟、单位成本。
5. **子群校准**：按意图/语言/渠道分组，防止整体校准好但某个子群过自信。

上线后：记录每次决策的置信度、阈值、人工复核结果，定期重算校准；分布漂移时重新标注一批样本评估，而不是盲目调阈值。
        """,
        chapter="Agent · Jev 评估",
        tags=["Jev", "calibration", "ECE", "可靠性图"],
        follow_ups=[
            "ECE 怎么分桶？",
            "整体校准好但子群差，怎么办？",
            "阈值调整后怎么验证收益？",
        ],
        rubric=[
            "校准是核心",
            "可靠性图/ECE 说清",
            "分流收益与子群校准",
        ],
    ),
    q(
        "LLM-JEV-04", "system", "压轴",
        "快慢分离架构怎么设计",
        "Agent 里怎么把慢模型（LLM）和快模型（Jev）组合？Jev 应该放在哪些决策点？",
        """
原则：**慢模型做开放推理/生成/工具编排，快模型做高频、固定选项、可阈值化的分支。**

可放 Jev 的位置：
1. **入口路由**：意图分类、语言、租户/模型档位选择。
2. **工具前护栏**：风险评分、是否需确认、是否越权。
3. **检索后过滤**：文档相关性、是否含敏感信息、是否该进上下文。
4. **上下文瘦身**：keep / truncate / drop 每条历史或工具结果。
5. **输出后校验**：是否满足用户诉求、是否该拒答、是否需要人工。
6. **循环控制**：是否继续、是否重试、是否切换工具。

架构：
```text
用户请求
  → Jev 入口路由（快）
  → 慢模型规划/生成
  → Jev 工具护栏（快）
  → 工具执行
  → Jev 结果过滤/继续判定（快）
  → 慢模型最终回答
  → Jev 输出校验（快）
```
关键：Jev 的每个决策都要有 fallback；低置信/高 stakes 升级到慢模型或人工。不要把 Jev 放在需要开放式推理的位置。
        """,
        chapter="Agent · 快慢架构",
        tags=["Jev", "快慢分离", "路由", "护栏"],
        follow_ups=[
            "Jev 和 LLM 路由器的区别？",
            "怎么衡量快慢分离的收益？",
            "Jev 挂了怎么办？",
        ],
        rubric=[
            "慢模型/快模型分工说清",
            "至少 4 个决策点",
            "每个决策有 fallback",
        ],
    ),
    q(
        "LLM-JEV-05", "troubleshoot", "压轴",
        "Jev 的边界、误判与供应商风险",
        "Jev 这么便宜，能不能全面替代 LLM 分类/审核？它有哪些风险和边界？",
        """
不能全面替代。边界：

1. **不能生成**：不会写解释、摘要、代码、长文；需要语言输出的地方仍要 LLM。
2. **判断仍会错**：schema 正确不等于语义正确；高 stakes 必须人工/慢模型复核。
3. **选项/评分标准由你定义**：候选设计不好，Jev 只能在坏选项里选；评分 rubric 模糊会导致漂移。
4. **分布漂移**：业务话术变化、对抗输入、跨语言可能让置信度失准；要持续评估校准。
5. **供应商锁定/可用性**：托管 API 有延迟、限流、价格/条款变化风险；关键链路要有本地分类器/规则/LLM 兜底。
6. **合规**：客户数据出境、日志留存、是否允许第三方决策，需要提前确认。

面试话术：Jev 是“把 if 变成可校准概率”的工具，不是“更便宜的 GPT”。用它之前先问：这个决策是否固定选项？错了代价多大？能不能人工兜底？三个都过关再上。
        """,
        chapter="Agent · Jev 风险",
        tags=["Jev", "边界", "误判", "供应商风险"],
        follow_ups=[
            "Jev 误放行造成损失，怎么定责？",
            "怎么设计 fallback 分类器？",
            "哪些数据不能发给 Jev？",
        ],
        rubric=[
            "明确不能生成/仍会错",
            "覆盖 rubric/漂移/供应商/合规",
            "给出使用前三个问题",
        ],
    ),
    q(
        "LLM-JEV-06", "compare", "压轴",
        "RAG、LoRA、Jev 三层怎么分工",
        "面试官问：RAG、LoRA、Jev 分别解决 Agent 的哪一层问题？会不会重复？",
        """
三层互补，不重复：

| 层 | 解决什么 | 典型位置 |
| --- | --- | --- |
| RAG | 事实、私有知识、可追溯出处 | 回答前检索、工具结果补充 |
| LoRA | 模型默认输出范式、话术、工具调用模板 | 底座行为对齐、多租户适配 |
| Jev | 循环内高频分支判定、路由、护栏 | 入口、工具前、检索后、输出后 |

一句话：**RAG 管“知道什么”，LoRA 管“怎么说/怎么做”，Jev 管“走哪条路/要不要停”。**

面试口述：我不会用 LoRA 背手册，也不会用 Jev 写答案，更不会用 RAG 做权限判断。三层各司其职，再用 Agent 编排串起来；评估时也分开看——RAG 看召回/忠实度，LoRA 看格式/业务指标，Jev 看校准和分流收益。
        """,
        chapter="Agent · 三层分工",
        tags=["RAG", "LoRA", "Jev", "分工"],
        follow_ups=[
            "三层都上，延迟怎么控制？",
            "哪一层最容易成为瓶颈？",
            "怎么证明每一层都有收益？",
        ],
        rubric=[
            "三层职责不混",
            "给出典型位置",
            "评估指标分开",
        ],
    ),

    # ------------------------------------------------------------------
    # 7. Agent 评估与 FDE
    # ------------------------------------------------------------------
    q(
        "LLM-EVAL-01", "system", "压轴",
        "Agent 评估的三层结构",
        "Agent 评估为什么不能只看单条正确率？单元 case、端到端 benchmark、业务回放集分别怎么设计？",
        """
三层：

1. **单元 case**：单个能力点。格式/字段、工具选择、指代消解、权限判断、拒答。快、可回归，适合 CI。
2. **端到端 Agentic benchmark**：多步任务，如 Terminal-Bench、Automation-Bench、DeepSWE、AgentBench。看规划、工具编排、错误恢复、长程一致性。成本高，适合版本里程碑。
3. **业务回放集**：真实历史请求 + 人工标注的期望结果/可接受结果。最贴近上线，覆盖长尾和脏输入；用来做上线门槛和 A/B。

指标不能只有 accuracy：
- 任务成功率、步骤数、工具调用正确率、无效调用率。
- 格式合规率、幻觉率、拒答正确率、越权率。
- p50/p95 延迟、token 成本、人工接管率。
- 失败模式分布：循环、卡死、工具错、上下文丢失、过早结束。

面试话术：单元 case 保证不回归，benchmark 证明能力上限，回放集决定能不能上线。三层缺一层都会自欺。
        """,
        chapter="Agent · 评估",
        tags=["Agent评估", "benchmark", "回放集", "指标"],
        follow_ups=[
            "回放集怎么脱敏？",
            "端到端 benchmark 分数高但业务差，为什么？",
            "怎么把失败模式做成回归 case？",
        ],
        rubric=[
            "三层评估说清",
            "指标不止 accuracy",
            "每层用途说清",
        ],
    ),
    q(
        "LLM-EVAL-02", "troubleshoot", "压轴",
        "Agent 失败模式怎么分类和定位",
        "Agent 线上答错，你怎么判断是检索、规划、工具、模型还是权限的问题？",
        """
按链路分五段定位：

1. **输入理解**：意图错、指代错、语言/格式不熟。看分类/实体抽取结果。
2. **检索**：没召回、召回脏、排序错、上下文超长被截。看 recall@k、命中块、重排分。
3. **规划**：步骤错、顺序错、该调工具不调、绕圈。看 trace 的 plan/step 数/重复动作。
4. **工具**：参数错、超时、返回格式变、权限拒绝。看工具入参/出参/错误码。
5. **生成**：幻觉、格式错、拒答过度、复读。看最终输出与引用/校验结果。

方法：每次失败保存完整 trace（输入、检索块、计划、工具调用、模型输出、校验结果），按失败模式打标签；每周聚类 Top 失败模式，转成回归 case。不要只看最终答案，否则永远定位不到根因。

面试加分：把“模型答错”拆成“链路哪一段错”，是 Agent 工程师和调包选手的分水岭。
        """,
        chapter="Agent · 排障",
        tags=["失败模式", "trace", "定位", "回归"],
        follow_ups=[
            "trace 要记哪些字段？",
            "怎么区分检索错和生成错？",
            "工具超时怎么归类？",
        ],
        rubric=[
            "五段链路定位",
            "trace 完整记录",
            "失败模式转回归",
        ],
    ),
    q(
        "LLM-FDE-01", "behavioral", "高频",
        "FDE 怎么控微调项目的范围",
        "客户说“你们不是 AI 吗，顺便把知识库、微调、Agent 都做了”，你怎么控范围？",
        """
先拆“必须/应该/可以/不做”，再谈验收：

- **必须**：一个明确业务场景、一个可量化指标、一个验收集、一个回滚方案。
- **应该**：数据清洗、基线对比、监控。
- **可以**：多轮、多语言、多租户、微调。
- **不做（本期）**：开放式问答、全知识库自动更新、模型自训练。

话术：
1. “我们先定义一个问题：用户输入什么、系统输出什么、错了谁兜底。”
2. “先跑 Prompt/RAG 基线，证明微调的必要性；如果基线够，就不花训练钱。”
3. “验收集由您提供/共同确认，覆盖正常、边界、拒答；上线看这个集，不看 demo。”
4. “范围外需求进 backlog，按二期评估；本期先保证一个场景闭环。”

FDE 的核心不是“什么都能做”，而是**把不确定性变成可验收的边界**。
        """,
        chapter="FDE · 范围管理",
        tags=["FDE", "范围", "验收", "基线"],
        follow_ups=[
            "客户不接受“先基线后微调”怎么办？",
            "验收集谁标注、成本谁出？",
            "范围蔓延怎么记录？",
        ],
        rubric=[
            "必须/应该/可以/不做四档",
            "基线先行",
            "验收集与回滚",
        ],
    ),
    q(
        "LLM-FDE-02", "system", "压轴",
        "客户数据不能出域，微调怎么做",
        "客户要求数据不出内网，但又想微调/部署 Agent，你的方案是什么？",
        """
三条路径，按客户资源选：

1. **本地 GPU + 开源底座 + QLoRA**：客户内网服务器/工作站，LoRA 训练和推理都在本地；模型、adapter、日志不出域。适合有 24G+ 显卡的客户。
2. **私有云/专有云**：客户自己的云账号、VPC、对象存储；训练镜像和数据都在客户租户内；我方只交付脚本和镜像，不接触原始数据。
3. **离线交付包**：训练脚本 + 数据模板 + 评估脚本 + 推理服务 Docker；客户自己跑，我方远程指导（不看数据）。适合数据极敏感、无 GPU 的场景。

工程要点：
- 依赖和模型权重提前离线打包，避免运行时联网。
- 数据脱敏/审计在客户侧做；日志默认脱敏。
- adapter 版本、评估报告可回传，但不回传原始样本。
- 明确谁负责合规、谁负责模型效果。

面试话术：数据不出域不是“不能做”，而是“把训练和推理搬进客户边界”；交付形态从 API 变成镜像/脚本/本地服务。
        """,
        chapter="FDE · 离线交付",
        tags=["数据不出域", "本地部署", "QLoRA", "离线交付"],
        follow_ups=[
            "客户没有 GPU 怎么办？",
            "离线环境怎么装依赖？",
            "模型权重许可要注意什么？",
        ],
        rubric=[
            "三条路径",
            "数据/日志不出域",
            "交付形态与责任边界",
        ],
    ),
]
