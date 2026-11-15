# PR-001 多用户鉴权与网关加固

- **分支**：`feat/security-hardening`
- **合并提交**：`5a82093`
- **影响面**：认证、授权、数据隔离、网关、部署
- **风险等级**：高（改动了所有写端点的准入）

---

## 为什么

起因是一个问题：**「这东西能不能扔出去给人用」**。

审计完发现不能。根因不是代码写得差，是**它从设计上就假设只有一个人用** ——
一台机器、一个浏览器、没人会恶意访问。这个假设在 5 月成立，在「给别人用」时同时失效于三处。

实测发现的 P0（完整的见 `docs/security-audit.md`）：

| 问题 | 危害 |
|---|---|
| 密码用无盐 SHA-256 | 库泄露 = 密码明文水平，相同密码哈希相同 |
| `/api/admin/*` 22 个端点零鉴权 | 能读到 LLM API Key 明文、清空队列、改模型地址 |
| `/api/auth/migrate` 任意调用 | 能建号并覆盖任意用户数据 |
| `/api/assistant/models` SSRF | 服务器被当成内网探测器 |
| 34 个写端点无鉴权 | 见上 |

---

## 改了什么

**认证层**（`app/auth.py` 重写）

- SHA-256 → PBKDF2-HMAC-SHA256，600k 迭代，16 字节随机盐，带算法前缀
- 旧格式兼容并**在登录时透明升级**：用户无感知，存量弱哈希随登录自然消失
- `users.role` / `token_version` / `is_active` / `last_login_at`
- `require_admin` / `get_optional_user`

**授权**（`app/routers/*`）

- `admin.py` 用路由级依赖，一处覆盖 22 个端点
- `assistant.py` 全端点鉴权 + 会话按用户
- `learning.py` 全端点鉴权 + 目标/路径按用户
- `videos.py` 进度按用户；转写、改字幕限管理员
- `ai_jobs.py` 批量转写限管理员

**数据隔离**（`app/services/profile.py` + `app/migrations.py`）

- `watch_history` 补 `user_id` 列
- 历史 NULL 数据一次性归属给 owner（`_claim_legacy_ownership`）
- 画像查询从 `if user_id is not None` 改成严格用 `resolved_id`

**网关**（`nginx.conf`）

- 从 `conf.d` 片段提升为完整配置（`limit_req_zone` 只能在 `http` 块定义）
- 安全头抽成独立文件 `nginx-security-headers.conf`
- 限流：登录 20r/m、API 30r/s、单 IP 并发 40
- 隐藏版本号；`/api/docs` 网关层硬拒绝

**部署**（`docker-compose.yml`）

- 5432/6379 从 `0.0.0.0` 收回 `127.0.0.1`

---

## 怎么验证

```bash
# 1. 未登录一律 401，公共接口仍 200
for p in /api/admin/health /api/learning/profile /api/assistant/sessions; do
  printf "%-26s -> %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' http://localhost$p)"
done
curl -s -o /dev/null -w "公开视频库 -> %{http_code}\n" 'http://localhost/api/videos?page=1&page_size=1'

# 2. 跨用户隔离：A 建目标，B 看不到
# 3. 角色控制：member 访问 admin 403，提升后同一令牌立即 200
# 4. 旧哈希自动升级：写回 SHA-256 后登录成功，库里变 pbkdf2_sha256$600000
# 5. 令牌撤销：改密码后同一令牌 401
# 6. 限流：第 9 次错误密码 429
```

实测结果全部通过，细节见 `docs/security-audit.md`。

---

## 风险与回滚

**风险**：所有需要登录的接口在升级瞬间会对旧前端全部返回 401。
**回滚**：`git revert 5a82093`，同时把 `users` 表的新列留着（不影响旧代码运行）。

**数据风险**：`_claim_legacy_ownership` 会把 NULL 数据归属给 owner。
如果系统里有多个真实用户，归属可能不符合预期。**执行前应先备份。**

---

## 复盘

### 1. 最该早做的是「问一句谁能访问」

`/api/admin/*` 22 个端点裸奔了半年，不是没能力加鉴权，是**从来没问过「谁会来访问」**。

一个可复用的自检：**列出所有 `@router.post/put/patch/delete`，逐个问「谁该能调」。**
答不上来的就是缺口。这个检查不需要工具，肉眼过一遍就够，成本 20 分钟。

### 2. 「有 user_id 字段」不等于「按用户隔离」

`watch_events` 有 `user_id`，但写入时从不赋值；`watch_history` 连列都没有；
`profile.py` 解析出 `resolved_id` 却用入参过滤。

这类问题的共同特征：**代码看起来是对的**。
`if user_id is not None: filter(...)` 读起来毫无破绽，只有意识到「调用方永远传 None」才会发现。

防线是：**隔离逻辑必须能被执行结果证伪**。
做法很简单 —— 造两个用户，各写一条数据，互相查一次。
不这么做的隔离都只能算「写了隔离代码」，不能算「实现了隔离」。

### 3. 一个反例：改动耦合太紧

这个 PR 里塞了安全加固 + 学习路径 TAB（PR-004），因为学习路径的隔离本来就是安全的一部分。

结果：**这个 PR 没法独立评审，也没法独立回滚。**
后面 PR-002、PR-003 就拆开了 —— 宁可多提一次 PR，也不要一个提交里混两个主题。

### 4. 安全默认值比安全选项有用

`ENABLE_DOCS` 从 `true` 改成 `false`、`ALLOW_REGISTRATION` 默认 `false`、
端口默认绑回环 —— 这些「默认安全」的改动，比写十页安全文档有效。

**因为没人会去读文档，但所有人都会用默认值。**
