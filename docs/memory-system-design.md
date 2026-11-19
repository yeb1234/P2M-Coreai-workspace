# 记忆系统设计与现状

> 状态：部分现行（最后校对 2026-11-16）
> 范围：`backend/app/services/memory.py`、`memory_extract.py`、`services/profile.py`、
> `models.py`（`ChatSession` / `ChatMessage` / `MemoryItem` / `UserData`）、
> `agents/chat_agent.py`、`routers/memory_admin.py`
> 说明：后端记忆层已落地（会话压缩 + 长期记忆条目 + 档案/设定 KV）。本文最初按
> Profile / Persona / Memories / Derived 四层写的设计稿见 §5，属未实施历史设计；
> 现行实现以 §1–§3 为准。

## 1. 现状总览

现行四层（与代码核对，`models.py`）：

| 层 | 表 / 存储 | 职责 | 代码位置 |
|---|---|---|---|
| L1 原始消息 | `chat_messages` | 短期原文，压缩窗口内按需读回 | `models.py:222-235` |
| L2 会话摘要 | `chat_sessions.summary` + `summary_upto_message_id` | 滑动窗口之外的历史压缩成摘要，避免上下文无限增长 | `models.py:215-216`；`memory.py:27-28` |
| L3 长期记忆 | `memory_items` | 跨会话稳定事实 / 偏好 / 约束 / 目标 / 能力 | `models.py:464-497` |
| L4 档案 / 设定 KV | `user_data`（`p2m-profile-v1`、`p2m-persona-v1`） | 用户自填档案与助手设定，键值存储不改表结构 | `memory.py:368-396` |

另有「学习者真实数据」画像：由 `profile.py` 从学习行为 SQL 聚合（30 天窗口活跃习惯 +
全量累计投入），经 `profile_summary_text` 压成一段话进 prompt；它不是用户填写的长期记忆，
和 L4 KV 是两回事（`chat_agent.py:206-207`）。

## 2. 现行实现细节

### 2.1 L1 原始消息（chat_messages）

字段：`id`、`session_id`、`role`、`content`、`references_json`、`tool_calls_json`、
`model`、`tokens_in`、`tokens_out`、`latency_ms`、`created_at`（`models.py:225-235`）。
消息表不存向量。

归属校验在 `ensure_session`：`session_id` 归属不符时当作不存在、走新建分支，
避免横向越权读别人的历史（`memory.py:42-50`）。

### 2.2 L2 会话压缩（ChatSession.summary）

- 触发阈值：消息数超过 `COMPRESS_THRESHOLD=24` 就压缩；压缩后保留最近
  `KEEP_RECENT=10` 条原文（`memory.py:27-28,230-233`）。
- 压缩模型：external LLM，`temperature=0.0, max_tokens=400, timeout_s=20`（`memory.py:251`）。
- 摘要要求：中文、不超过 300 字、分条；保留目标 / 已确认结论 / 待办与未解决问题 /
  明确偏好，丢弃寒暄、重复、模型推理过程（`memory.py:252-257`）。
- 防并发覆盖：用 `summary_upto_message_id` 标记已压到哪条；压缩期间若别的请求已经压得更远，
  丢弃本次旧结果（`memory.py:272-275,277-278`）。
- 失败降级：压缩调 LLM 失败或返回空串时保留原文，不写空摘要（`memory.py:260-265`）。

### 2.3 L3 长期记忆（MemoryItem）

字段（`models.py:476-497`）：

| 字段 | 取值 / 默认 | 说明 |
|---|---|---|
| `id` | 字符串主键 | |
| `user_id` | FK users，可空 | 归属；匿名会话可空 |
| `kind` | `fact` / `preference` / `goal` / `constraint` / `ability` | 抽取侧白名单同此（`memory_extract.py:29`） |
| `content` | 文本，写入截断 1000 字 | |
| `source` | `chat` / `manual` / `inferred` | 注意：现行取值不是设计稿里的 `user_stated` |
| `importance` | 1–5，默认 3，越界夹取 | |
| `confidence` | 0–1，模型默认 0.8；抽取默认 0.7 | 抽取结果带模型给出的置信度；手动写入为 1.0 |
| `pinned` | bool，默认 False | 置顶；pinned 条目绝不被自动覆盖 |
| `expires_at` | 可空 | 现行两条写入路径都不传，恒为 NULL（见 §3.4） |
| `superseded_by` | 可空 / `"__auto__"` | 软删除或被新记忆替代 |
| `hit_count` / `last_hit_at` | 整数 / 时间戳 | 每次召回命中计数 |
| `created_at` / `updated_at` | 时间戳 | |

召回（`recall_memories`，`memory.py:311-347`）：

- `limit` 默认 12；过滤条件：未过期（`expires_at IS NULL OR > now`）且
  `superseded_by IS NULL`；按 `user_id`、`kind` 可选过滤。
- 排序：`pinned DESC` → `importance DESC` → `updated_at DESC`。
- 命中后 `hit_count +1`、`last_hit_at = now`。

注入 prompt（`memory_text`，`memory.py:350-361`）：`limit` 默认 10，按 kind 加中文标签
（偏好 / 约束 / 目标 / 事实 / 能力），拼成 `- [标签] 内容` 列表；在 `build_system_prompt`
里挂在「## 长期记忆（用户已确认的事实与偏好）」段下（`chat_agent.py:247-249`）。

### 2.4 L4 档案 / 助手设定（user_data KV）

- 两个键：`p2m-profile-v1`（档案）、`p2m-persona-v1`（助手设定）（`memory.py:368-369`）。
- `read_user_settings` 两侧分别读 `user_data` JSON；任一侧取不到或解析失败返回空 dict，
  不影响对话（`memory.py:372-396`）。
- 注入顺序（`chat_agent.py:216-242`）：档案段「## 用户档案（用户自己填的，以此为准）」
  支持 `nickname / occupation / goal / weekly_hours / timezone`；设定段
  「## 助手设定（用户指定，优先级高于默认风格）」支持 `tone / proactivity / cite_sources / freeform`。
- 读写接口：`memory_admin.py` 提供档案 / 设定编辑与记忆条目增删改；`user_data.py`
  提供通用 KV 读写删。

### 2.5 异步抽取链路

- 时机：助手回答落库后，`_schedule_memory_extract` 把「用户消息 + 助手回答」丢进单线程池
  `ThreadPoolExecutor(max_workers=1, prefix="mem-extract")`；失败一律吞掉，不影响对话本身
  （`chat_agent.py:164,167-184`）。
- 门槛：拼成的对话少于 20 字跳过（`memory_extract.py:93`）。
- 抽取模型：external LLM，`max_tokens=800, timeout_s=40`（`memory_extract.py:114`）。
- 输出：`kind / content / importance / confidence`；kind 不在白名单则丢弃。
- 覆盖规则：已有同主题条目且新条目 `confidence >= 0.6` 才覆盖；冲突时旧条目
  `superseded_by="__auto__"`，新条目 `source="inferred"`；`pinned` 条目绝不覆盖
  （`memory_extract.py:151-152,160,162`）。
- 去重：与现有条目 `content` 完全相同才跳过（`memory_extract.py:126,134`）。
- 手动写入：`POST /memory/items` 直接建条目，`source="manual"`、`confidence=1.0`、
  `pinned=False`（`memory_admin.py:167-176`）。

## 3. 已知缺陷（2026-11-16 现状，未修）

> 四条均按代码现状如实记录，不是计划待办里的乐观描述。

### 3.1 召回不过滤 confidence / source，注入却标注「用户已确认」

`recall_memories` 只过滤过期与被替代条目（`memory.py:323-326`），不看 `confidence`、
也不区分 `source`。抽取路径写入的低置信 `inferred` 条目同样会被召回，而 prompt 段标题是
「用户已确认的事实与偏好」（`chat_agent.py:249`）。模型据此把推断内容当成用户亲口确认的
事实使用。抽取侧注释虽写「低置信不进 prompt 优先队列」（`memory_extract.py:88`），
但召回侧并没有对应的置信度过滤，这条规则目前没有落地。

### 3.2 按 importance 而非相关性召回

召回排序是 `pinned → importance → updated_at`（`memory.py:333-338`），没有与当前问题的
语义或关键词相关性排序。高重要度但与本轮问题无关的条目会占住名额；真正相关但 importance
低的条目可能进不了 top N。

### 3.3 去重只认完全相同字符串

抽取侧去重比较的是 `content` 精确相等（`memory_extract.py:126,134`）。同义改写、
措辞不同、语序调整后说的同一件事，会被当成新条目重复入库；跨轮次的同一偏好也无法归并。

### 3.4 TTL 两条写入路径都不传，`expires_at` 恒为 NULL

`add_memory` 虽有 `ttl_days` 参数（`memory.py:292,303`），但没有调用方传值；抽取路径直接
构造 `MemoryItem`（`memory_extract.py:155-166`）、手动路径（`memory_admin.py:167-176`）
都不设 `expires_at`。后果：召回的过期过滤条件（`memory.py:324`）对存量记忆恒成立，
记忆不会自然过期，只能靠手动删除或被替代。

## 4. 已 resolved 的旧问题

- **notes 归属**：原设计稿担心「notes 表没有 `user_id`，多用户混写」。现状 `notes` 已有
  `user_id`（shared 笔记为 NULL）与 `scope`（`shared` / `private`）字段
  （`models.py:173-178`）；成就墙与私有笔记按 scope 区分。

## 5. 原设计稿存档（历史，未实施）

> 下面是本系统最初按「Profile / Persona / Memories / Derived」四层写的设计稿，保留作背景。
> 与现行实现的对应关系：Profile / Persona 落到了 L4 的两个 KV 键（§2.4）；Memories 落到了
> L3 `memory_items`；Derived（学习画像）由 `profile.py` 的 SQL 聚合实现，不是表存记忆。
> 设计稿里的字段名、source 取值与现行代码不一致处，以 §2 为准。

### 5.1 背景与问题（原稿）

旧实现里用户画像散落在备注、聊天历史、学习记录、前端设置里，没有统一结构。AI 助手每次回答
重新读一遍聊天记录，既贵又抓不住重点；用户换个对话就被当成新人。

### 5.2 原稿四层设计

1. **Profile（静态档案）**：称呼、职业、当前目标、每周可投入时长、时区。用户自填，以此为准。
2. **Persona（助手设定）**：语气、主动程度、是否引用来源、自由要求。用户指定，优先级高于默认风格。
3. **Memories（长期记忆）**：偏好、约束、目标、事实、能力；带置信度、来源、重要度、命中次数、
   过期时间、置顶、被替代关系。
4. **Derived（派生画像）**：由学习行为统计派生，不手写。

### 5.3 原稿冲突合并规则（未落地）

- 新记忆与已有条目冲突：高置信覆盖低置信；同置信度保留更新的；旧条目标记被替代而非删除。
- 自动抽取的条目可被用户手动确认 / 否决；否决后不再自动生成同类条目。
- 过期记忆归档而非物理删除。

### 5.4 原稿安全与隐私（部分已落地）

- 所有记忆按 `user_id` 隔离，匿名会话单独处理。
- 前端设置可查看 / 清空自己的记忆；清空走后端按用户删除。
- 敏感信息不进长期记忆；抽取 prompt 显式排除账号、密码等。

## 待用户确认

- §3 四条缺陷是否排期修；若修，优先级排序（建议先做 3.1 置信度过滤与 3.4 TTL 落地）。
- L3 召回是否要加与当前问题的相关性排序（语义召回或关键词匹配）。
- 原稿 §5.3 的「否决后不再自动生成同类条目」是否需要实现。

## 未核实项

- 记忆条目存量条数、各 kind / source 分布：本次未连库统计。
- 压缩摘要当前覆盖率（多少会话已有 `summary`）：未核实。
