# 数据质量管线与存量去重

> 状态：部分现行（最后校对 2026-11-16）。四段入库/清洗管线现行；§四存量去重的 dry-run 数字
> 与执行步骤为 2026-11-16 凌晨那批记录，存量残留情况本次未连库复核，标注「未核实」。
> 数据基线（截至 2026-11-16）：`videos` 14,327、`content_chunks` 60,259（向量覆盖 100%）、
> `subtitle_segments` 3,593,723、有字幕视频 8,785。
> 代码见 commit `6380394`、`5abeb47`、`e8e447c`、`97f3521`。

---

## 一、问题是怎么来的

项目从「本机直跑」迁到 Docker 时，扫描根路径变了：

```
旧（2026-05-16）  D:\ITJC\产品经理\...\01、AI产品经理.mp4
新（2026-11-15）  /videos/产品经理/.../01、AI产品经理.mp4
```

`upsert_video` 只按 `filepath` 精确匹配，认不出这是同一个文件 —— 于是**整库重新入库一遍**
（下面是当时 dry-run 实测，历史数字）：

```
视频总数        28654
唯一标题        13995
多出的行        14659   ← 一半是重复的
```

后果不只是占空间：检索结果里同一内容占两个坑，准确率直接被稀释一半。

---

## 二、四段数据质量管线

不是修一次重复，是让这类问题不再产生。按「入库 → 分块 → 检索 → 展示」逐段加防护。

### 1. 入库：指纹去重（根治）

`upsert_video`（`file_scanner.py:152-186`）改成两段匹配：

1. 先按绝对路径查（最快命中，`file_scanner.py:155`）
2. 没命中时退到「**文件名 + 字节数**」再查一次，命中就只修正路径（`file_scanner.py:171-172,179`）

**为什么不算法内容 hash**：要对 28GB 视频跑一遍，每次扫描都算等于自杀。同名同大小的概率已经足够低。

命中后只改 `filepath`，不动 `title` / `chunks` / 观看记录 —— 那条记录可能已经带着几万条 chunks 和历史进度。

### 2. 标题清洗

新增 `clean_video_title()`，去掉高置信度的广告后缀：

```
01、01-【基础认知】AI产品经理岗位及就业规划 [itjc8.com]     → 01、01-【基础认知】AI产品经理岗位及就业规划
2-7 Agent落地案例：Agent如何融入企业业务中 [itjc8.com](1)  → 2-7 Agent落地案例：Agent如何融入企业业务中
第 3 章 依赖注入（完整版）                                  → 保留不动
```

只处理 `[itjc8.com]` 类标记和 `(1)` 后缀。「（完整版）」这种正常括注保留。全删光时退回原文。

### 3. 检索：过滤废块

- SQL 加 `end_sec > start_sec`：当时库里有 **190 条零长度块**（改造前实测；当前存量未核实），展示出来是「一段文字 + 0 秒跳转目标」，点了什么也没发生
- 候选里剔除 `looks_like_promo()` 的整块（`textclean.py:84`）：音乐类/搬运课里有些块通篇是「关注微信 xxx」，命中后既讲不了内容又占掉 top_k 名额

### 4. 展示：文本清洗

`backend/app/utils/textclean.py`，清三类（`clean_promo_text` :93，`clean_video_title` :125）：

| 类型 | 规则 | 例子 |
|---|---|---|
| 资源站域名 | 明确域名表 | `itjc8.com`、`www.xxx.com` |
| 微信/公众号 | 引导动词 + 平台词 + 到句末 | 「请大家关注微信更正号产品人气地…」→ 整段删 |
| UP 主套话 | **连续 2 个以上**动作词才删 | 「点赞 订阅 转发 打赏」删除；「订阅这个事件」不动 |

接入三处：

1. **工具返回给模型的片段** —— 不清的话模型会照抄广告进回答
2. **引用卡片文本** —— 用户直接看到的
3. **检索过滤** —— 纯广告块不进候选

**原则：只删不改写，宁可漏不可错。**

---

## 三、检索准确率的其他修复

| 问题 | 根因 | 修复 |
|---|---|---|
| AI 答得对、相关片段不相关 | 旧实现两批结果来自**两次不同检索**：工具用 `candidate_k=30, use_rerank=True`，卡片另跑 `15, False` | 现行：引用区优先取本轮工具实际召回的 trace 命中（`tools.py:49,52-72`）；trace 为空才回落 `hybrid_search(top_k=6, candidate_k=30, use_rerank=True)`（`chat_agent.py:586,615`）。另注：「相关片段」卡片前端渲染 2026-11-16 起由 `FEATURES.chatVideoReferences=false` 关闭，后端仍生成 references |
| `rerank_score` 方向不一致 | LLM 分支 `float(len(reranked))`（第 1 名 0 分），交叉编码器 `round(score,4)`（越大越相关） | 统一成 `[0,1]` 越大越相关 |
| 时间戳看着不对 | 块平均跨 **114 秒**，最长 7333 秒；卡片只显示起点 | 显示区间 `27:27 – 29:30` |
| 开新对话后引用标签消失 | `sendMessage` 开头 `setReferences([])`，新一轮没结果就永远回不来 | 不清空；没结果时保留旧引用并标「上一轮」 |
| 正文里的视频名不能点 | 工具返回给模型的文本里没有 `video_id` | done 阶段提取《…》→ 去时长 → 回查视频表 → 前端渲染成按钮 |

### 块时间跨度实测（改造前 60,431 个块，历史记录；截至 2026-11-16 为 60,259 块，分布本次未重跑）

```
平均块长      565 字（符合设计）
平均块跨度    114 秒
最长块跨度    7333 秒
跨度 >10 分钟  87 块 / 57 个视频
零长度块      190 块
向量覆盖      60431 / 60431 = 100%
```

那 87 个超长块抽查是音乐类视频（重复歌词），字幕时间轴稀疏导致整段并成一块。
当前超长块 / 零长度块存量未核实。

---

## 四、存量去重

### 脚本

宿主机路径 `backend/scripts/dedupe_videos.py`；容器内位于 `/app/scripts/`（Dockerfile `COPY backend/ .`）。

```bash
python scripts/dedupe_videos.py            # 只统计，不动数据
python scripts/dedupe_videos.py --apply    # 真正执行
```

### 保留策略

保留 `filepath` 以 `/videos/` 开头的那条 —— **只有它在容器里能播**。

旧记录的 chunks 更全（当时跑过向量化），所以要**把 chunks 迁过来**，而不是删掉重建 —— 重建要重跑约 6 小时。

退路：两条都是容器路径时，取 id 最大。

### 迁移表

**行为数据（必须保留）**：`watch_history` / `watch_events` / `notes` / `chat_sessions` / `ai_jobs`

**派生数据（keep 已有就丢弃，没有才迁）**：`content_chunks` / `subtitle_segments`

`watch_history` 迁移后同一 `(user, video)` 可能有多条，按 `updated_at` 保留最新的。这个清理 SQL 在所有迁移**结束后只跑一次**（放在组循环里会变成 13995 次全表自连接）。

### dry-run 实测数字（2026-11-16 凌晨那批，历史记录；本次未连库重跑）

```
重复组            13995
待删除视频         14659
chunks 将迁入      60183
chunks 将丢弃      125
字幕将迁入         3588452
watch_history 迁移 427
watch_events 迁移  8868
notes 迁移         8770
```

截至 2026-11-16 基线：`videos` 14,327、`content_chunks` 60,259、`subtitle_segments` 3,593,723；
上述迁移是否已全部落地、残留重复多少，未核实。

### 执行步骤

> 容器名由 compose 项目 `p2-siteyeb` 生成：postgres `p2-siteyeb-postgres-1`、backend `p2-siteyeb-backend-1`。
> 端口（P2，2026-11-16 换号后）：API `127.0.0.1:12402`、PG `127.0.0.1:12502`、Redis `127.0.0.1:12602`、Web `80` + `12302`、dev `12322`；监控段未分配。
> 旧号段 `11102` / `11112` / `11122` / `11132` / `11142` / `11162` 已作废，勿再引用。
> 下面的备份 / 执行 / 验证都走 `docker exec` 容器内命令，不经过宿主端口。

```bash
# 1. 备份（必须）
docker exec p2-siteyeb-postgres-1 pg_dump -U p2user p2learning > backup-before-dedupe.sql

# 2. 确认备份非空
ls -lh backup-before-dedupe.sql

# 3. 执行
docker exec -e PYTHONPATH=/app p2-siteyeb-backend-1 python scripts/dedupe_videos.py --apply

# 4. 验证
docker exec p2-siteyeb-postgres-1 psql -U p2user -d p2learning -c \
  "SELECT count(*) AS videos FROM videos; SELECT count(*) AS chunks FROM content_chunks;"
```

预期（当时测算）：视频 28654 → **13995**；chunks 60431 → **约 60306**（丢掉 125 个重复的）。
截至 2026-11-16 实际为 14,327 视频 / 60,259 块；与预期的差额来自去重后的新扫描还是残留重复，未核实。

### 回滚

```bash
docker exec -i p2-siteyeb-postgres-1 psql -U p2user -d p2learning < backup-before-dedupe.sql
```

---

## 五、已知限制（2026-11-16 现状）

- **历史标题未批量清洗** —— `clean_video_title`（`textclean.py:125`）只在入库时生效。存量标题里是否仍有 `[itjc8.com]` 类后缀，本次未核实；要么等下次扫描（新记录 + 修正路径时会更新 title），要么跑批量 UPDATE。
- **重复视频残留情况未核实** —— dry-run 已完成；`--apply` 是否执行、当前是否还有同标题重复行，本次未连库复核（基线 `videos` 14,327）。
- **广告清洗只删不改** —— 现行限制。字幕识别成中文乱码的微信 ID 无法 100% 覆盖（靠「引导动词 + 平台词 + 到句末」兜底）。
