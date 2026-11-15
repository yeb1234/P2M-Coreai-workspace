# 多用户系统诊断报告

时间：2026-11-16 03:00 – 04:10
范围：数据隔离、权限模型、越权检查、配额

---

## 一、结论先说

**隔离本身是好的**（15/15 测试通过），但**发现一个真实的越权漏洞并已修复**：

> 93 个会话里有 **87 个 `user_id` 为空**，而代码里写的是
> `if session.user_id is not None and ...: raise 404` ——
> 无主会话直接放行。等于**任何登录用户都能读别人 162 条对话消息**。

这是迁移前的历史数据，单用户时代没问题，多用户之后变成后门。

---

## 二、数据隔离矩阵

### 私有（按 user_id 隔离）

| 表 | 内容 | 状态 |
|---|---|---|
| `watch_events` | 观看事件 | ✓ |
| `watch_history` | 观看进度 | ✓ |
| `chat_sessions` | 对话会话 | ✓（本次修复） |
| `memory_items` | 记忆条目 | ✓ |
| `user_data` | 档案/助手设定/番茄钟 | ✓ |
| `schedule_items` | 日程 | ✓ |
| `calendar_events` | 日历 | ✓ |
| `user_profiles` | 派生画像 | ✓ |
| `learning_goals` / `learning_paths` | 目标与路径 | ✓ |
| `agent_runs` | Agent 审计 | ✓ |

### 共享（所有用户可见）

| 表 | 内容 | 是否合理 |
|---|---|---|
| `videos` / `categories` | 视频库 2.8 万条 | ✓ 知识库本来就该共享 |
| `subtitle_segments` | 359 万字幕 | ✓ |
| `content_chunks` | 6 万语义块 + 向量 | ✓ |
| `notes` | AI 生成的学习笔记 | ✓ 但有前提，见第四节 |
| `app_settings` | 全局配置 | ✓ 只有 admin 能改 |

### 间接私有（靠父级保护）

| 表 | 通过什么保护 | 风险 |
|---|---|---|
| `chat_messages` | `session_id` → `chat_sessions.user_id` | 低（父级已修） |
| `learning_path_steps` | `path_id` → `learning_paths.user_id` | 低 |

---

## 三、实测结果（15 项全过）

用两个临时账号交叉验证：

```
[1] A 写入私有数据              3/3  ✓  记忆 / 档案 / 日程
[2] B 不能看到 A 的数据          5/5  ✓  记忆 / 档案 / 日程 / 经验值 / 观看时长
[3] B 不能改动 A 的数据          2/2  ✓  改记忆 404 / 删记忆 404
[4] A 仍能正常读自己的           1/1  ✓
[5] 未登录不能访问私有接口       3/3  ✓  401/403
[6] 共享知识库对所有用户可见     1/1  ✓
```

脚本在 `backend/scripts/test_multi_user.py`，可在容器内跑：

```bash
docker exec siteyeb-backend python scripts/test_multi_user.py http://127.0.0.1:8000
```

**为什么脚本里用 `127.0.0.1:8000` 而不是 `localhost`**：容器内 `localhost` 指向容器自己，而服务监听在 8000。踩过一次。

---

## 四、修的那个漏洞

### 问题

```python
# 修复前
if session.user_id is not None and session.user_id != user.id and role != "admin":
    raise HTTPException(404)
return session
```

`session.user_id is None` 时**短路放行**。

### 数据现状

```
总会话 93  |  无主 87  |  有主 6
总消息 174 |  属于无主会话 162 条
```

87/93 = **93.5% 的会话是无主的**。

### 修复

**数据侧**：把 87 个无主会话归给最早的 admin（id=1）。现在 0 条无主。

**代码侧**：无主会话收紧为「只有 admin 可读」。

```python
is_admin = (user.role or "") == "admin"
if session.user_id is None:
    if not is_admin:
        raise HTTPException(404)
elif session.user_id != user.id and not is_admin:
    raise HTTPException(404)
```

**为什么状态码统一用 404 而不是 403**：403 会泄露「这个 id 存在」。用 404 让攻击者分不清「不存在」和「不属于你」。原代码注释里已经写了这个考虑，我沿用了。

---

## 五、权限模型

```
admin   全库读写、用户管理、AI 任务、笔记编辑
member  只能读共享库，只能写自己的私有数据
```

关键点：

- `notes` 的 PUT 需要 `require_admin` —— 因为它是 AI 转写的附属产物，属于共享库
- 用户管理界面已有（`UserManagementSection.tsx`，277 行），可以升降级角色
- 配额 `chat_quota_for(user.role)` 按角色分档

**一个可疑的地方**：`users` 表里有个 username=`admin` 的用户，但 `role=member`。名字叫 admin 却不是管理员，容易误判。建议改名或提权，看实际需要。

---

## 六、多用户下的产品设计问题（需要你定）

### 笔记到底是共享还是私有？

现在的设计是**共享**：

```
AI 转写视频 → 自动生成 note(source='ai') → 所有人看到同一份 → 只有 admin 能改
```

这在「学习库」场景是合理的：视频是共享的，笔记是视频的附属物。

**但如果你希望「每个用户能写自己的学习笔记」**，那就需要：

1. `notes` 加 `user_id`
2. 区分 `scope`：`shared`（AI 生成）/ `private`（用户手写）
3. 前端笔记页分「共享笔记」和「我的笔记」两个 tab

改动量：加一列 + 迁移（现有 8770 条都是 AI 生成，可以全标 shared，user_id 留空）+ 接口加过滤 + 前端分 tab。

**我倾向做**，因为「个人学习系统」里，用户的笔记必然私有。但这是产品决策，等你确认。

---

## 七、顺带发现的三个小问题

**1. `journey` 的笔记统计在多用户下语义模糊**

现在统计的是全局手写笔记数（排除 AI 生成）。多用户下，A 的手写笔记会被 B 的成就墙算进去。

修法取决于第六节的决策：
- 如果笔记改私有 → 统计加 `user_id` 过滤，语义自然清晰
- 如果保持共享 → 成就描述要改成「库里的笔记」，而不是暗示「你写的」

**2. 无主会话归给 id=1 是「最不坏」的选择**

不知道历史会话属于谁，只能归给最早的 admin。如果那些会话其实是别人的，归属就错了。但比起「所有人都能读」，归给 admin 更安全。

**3. 注册接口是开放的**

`POST /api/auth/register` 任何人可调，只有 IP 级限流。如果将来公网部署，需要考虑：
- 邀请码
- 或邮箱验证
- 或直接关闭注册，只由 admin 创建

现在是本机环境，问题不大。

---

## 八、建议的下一步

按优先级：

| 优先级 | 事 | 理由 |
|---|---|---|
| 1 | 定笔记的归属模型（第六节） | 影响数据结构和前端，越晚改成本越高 |
| 2 | 注册入口加开关（可关闭） | 公网部署前必须 |
| 3 | 给 `admin` 用户名那个账号改名或提权 | 避免运维误判 |
| 4 | 把隔离测试接进 CI | 现在只能手动跑 |

第 1 项需要你决策，其余我可以直接做。
