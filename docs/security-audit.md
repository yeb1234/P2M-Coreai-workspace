# 上线前安全与稳定性审计

审计时间：2026-11-15
审计范围：`backend/app`（96 个路由、48 个写端点）、`nginx.conf`、`docker-compose.yml`、前端 `apiFetch`

---

## 一、结论先说

**这个系统在上线前不能直接用。** 不是代码质量差，是**它从设计上就假设只有一个人用**：
只有一台机器、一个浏览器、没人会恶意访问。这个假设在 5 月成立，在「给别人用」的场景下直接失效。

审计发现 **9 个 P0**（会直接导致密码泄露、数据被篡改、或服务器被当成跳板）、
**11 个 P1**、**6 个 P2**。P0 和 P1 已全部修复，P2 修了 4 项。

最严重的三个问题，按危害排序：

| # | 问题 | 如果没修会发生什么 |
|---|---|---|
| 1 | 密码用**无盐 SHA-256** 存储 | 数据库泄露 = 密码明文。彩虹表几秒反查出 `admin123` 这类密码，相同密码的用户哈希完全相同，一眼能看出谁和谁用同一个密码 |
| 2 | `/api/admin/*` **22 个端点完全无鉴权** | 任何能打开网页的人都能：读到你的 LLM API Key 明文、清空所有转写任务、改写模型配置、触发全盘扫描 |
| 3 | `/api/auth/migrate` **无鉴权** | 任何人可以批量创建账号，并**覆盖任意用户的键值数据**（笔记、设置、进度） |

---

## 二、P0：认证与授权

### 1. 密码哈希：无盐 SHA-256 → PBKDF2-HMAC-SHA256

**证据**：`backend/app/auth.py` 原第 15-20 行

```python
def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()
```

**问题**：
- 无盐。相同密码 → 相同哈希，一次计算可以同时破解所有用同一密码的账号
- SHA-256 是**为速度设计**的。现代 GPU 每秒能算百亿次，8 位密码几小时内穷举完
- 没有迭代次数，等于没有成本门槛

**修复**：PBKDF2-HMAC-SHA256，600,000 次迭代，16 字节随机盐，带算法前缀存储：

```
pbkdf2_sha256$600000$<salt_hex>$<hash_hex>
```

三个细节值得说明：

- **为什么要算法前缀**：以后换 Argon2 时，可以在登录路径上按前缀分流，老用户继续用 PBKDF2 校验、下次登录自动升级，不需要强制所有人重置密码。
- **旧密码怎么办**：兼容裸 64 位十六进制（旧格式）。用户登录时校验通过后**立即重写为 PBKDF2**，用户无感知。存量弱哈希会随着登录自然消失，不需要一次性迁移。
- **比较要用 `hmac.compare_digest`**：普通 `==` 会在第一个不同字节就返回，攻击者能通过响应时间差逐字节猜出哈希。

**验证**：新旧格式双向自检通过（`verify_password` 对两种格式都返回正确结果，`needs_rehash` 能正确识别旧格式）。

---

### 2. 管理端 22 个端点零鉴权

**证据**：`backend/app/routers/admin.py` 原第 21 行

```python
router = APIRouter(prefix="/api/admin", tags=["admin"])   # 没有任何依赖
```

22 个端点全部裸奔。其中三个是「打开浏览器就能造成实际损失」的：

| 端点 | 后果 |
|---|---|
| `GET /api/admin/assistant-settings` | 返回 `external_api_key` **明文**，你的 DeepSeek 额度可以被别人用完 |
| `POST /api/admin/ai-jobs/clear-all` | 一次请求清空所有转写任务与历史 |
| `PUT /api/admin/assistant-settings` | 改模型地址，把请求导到攻击者控制的服务，你的对话内容全部外流 |
| `POST /api/admin/rescan` | 触发全盘扫描，14,000 个视频的目录遍历，可被用来做 DoS |

**修复**：路由级依赖，一处生效覆盖全部

```python
router = APIRouter(
    prefix="/api/admin",
    tags=["admin"],
    dependencies=[Depends(require_admin)],
)
```

**顺带修了密钥泄露**：`GET /assistant-settings` 现在返回 `__MASKED__` 占位符，不再回明文。
前端设置页仍能正常回填，保存时如果收到占位符就保留库里的原值 —— 这样既不泄露，又不破坏「改一半字段」的编辑体验。

---

### 3. `/api/auth/migrate` 可被任意调用

**证据**：`backend/app/routers/auth.py` 原第 58 行

```python
def migrate(body: UserDataBulkImport, db: Session = Depends(get_db)):
```

这个接口能创建账号、能覆盖任意 `user_data`（笔记、设置、学习进度都在这张表里）。
原本设计是「本地数据迁移专用」，但**没有做任何限制**，公网暴露就是一个开放的写入接口。

**修复**：加 `require_admin`。同时保留旧 `passwordHash` 原样写入 —— 那些是裸 SHA-256，
保留它们意味着老用户还能用原密码登录，登录时自动升级。

---

### 4. 新增：角色与令牌撤销机制

原来所有用户是平权的，没有「管理员」这个概念。加了 `users.role`（`admin` / `member`）和
`users.token_version`。

**token_version 解决什么**：JWT 是无状态的，签发后收不回来。用户改密码后，
旧令牌在 24 小时内依然有效 —— 如果令牌已经泄露，改密码等于没改。

现在的做法：令牌里带 `ver`，校验时与库里的值比对。**改密码 → version + 1 → 此前所有令牌立即失效**，
包括当前这台设备，强制重新登录。这是无状态 JWT 唯一廉价的撤销手段。

**JWT 有效期**：24 小时 → 12 小时。没有实现 refresh token，原因是：
refresh token 需要服务端存储 + 轮换 + 盗用检测，工作量接近重做认证体系，
而单机/小团队场景下「12 小时 + 改密码即撤销」已经够用。**这个取舍写在这里，别在面试时说过头。**

---

### 5. 登录限流

原来没有任何限流。`/api/auth/login` 可以被无限次尝试。

**修复**：基于 Redis 的固定窗口计数（`backend/app/services/rate_limit.py`）

| 维度 | 限制 |
|---|---|
| 同一 IP | 15 分钟 30 次 |
| 同一账号 | 15 分钟 8 次 |
| 注册 | 1 小时 5 个账号 |
| 对话 | 1 分钟 20 轮 |
| 路径规划 | 10 分钟 6 次 |

两个设计决定：

- **Redis 挂掉时放行**，只打告警。限流是保护措施，不是业务前置条件。
  因为 Redis 抖动让所有人登不上，是更严重的故障。
- **登录成功清空计数**，避免正常用户被自己之前的失败次数拖累。

**顺带修了账号枚举**：原来「用户不存在」和「密码错误」都返回「用户名或密码错误」——
这点原本是对的，但没有记录失败日志，攻击者仍可通过响应体差异（比如是否存在该用户导致的锁定时长）区分。
现在统一返回同一句话，只在服务端日志里区分。

---

## 三、P0：多用户数据隔离（这是半成品）

### 现状：一半的表有 `user_id`，一半没有；一半的接口鉴权，一半没有

| 表 | 有 user_id | 接口鉴权 | 状态 |
|---|---|---|---|
| `user_data` | ✅ | ✅ | 正常 |
| `schedule_items` | ✅ | ✅ | 正常 |
| `calendar_events` | ✅ | ✅ | 正常 |
| `watch_events` | ✅ 有字段 | ❌ **写入时从不赋值** | **全库都是 NULL，画像把所有用户的行为加在一起算** |
| `watch_history` | ❌ **没有这个列** | ❌ | **所有用户的观看进度混在一起，2 分钟内会互相覆盖** |
| `user_profiles` | ✅ 主键 | ❌ | 查询传 `None`，落到「最早创建的用户」 |
| `learning_goals` / `learning_paths` | ✅ 有字段 | ❌ | **A 能看到并修改 B 的学习路径** |
| `agent_runs` / `chat_sessions` | ✅ 有字段 | ❌ | 会话全局共享，任何人能读任何人的对话 |
| `notes` | ❌ | ❌ | 见下方说明 |

### 最隐蔽的一个：画像把所有人加在一起算

**证据**：`backend/app/services/profile.py` 原第 174-182 行

```python
def recompute_profile(db: Session, user_id: int | None = None) -> UserProfile:
    resolved_id = resolve_user_id(db, user_id)   # 解析出真实 id
    event_query = db.query(WatchEvent)
    if user_id is not None:                      # 但这里用的是入参！
        event_query = event_query.filter(WatchEvent.user_id == user_id)
```

`resolved_id` 算出来了，却没用它过滤。传 `None` 时**跳过过滤 = 统计全库**。
单用户场景下看不出来，多用户下就是「你的画像里混进了别人的学习时长」。

这类 bug 不会报错、不会空值，数字看起来完全合理 —— 和之前那个「近 7 天 44 分钟实际 338 分钟」
是同一类问题。已经吃过一次亏了。

**修复**：严格用 `resolved_id` 过滤 `watch_events` / `watch_history`，签名不变但语义明确。

### 历史数据归属：迁移时一次性解决

改成严格按 `user_id` 过滤后，owner 自己的历史数据（全是 NULL）会集体消失。
所以在 `migrations.py` 里加了 `_claim_legacy_ownership()`：

```
1. ADMIN_USERNAMES 白名单里第一个存在的账号
2. 最早创建的非占位账号（username != 'local'）
3. 最早创建的任何账号
```

然后把 `watch_events` / `watch_history` / `learning_goals` / `learning_paths` 里
所有 NULL 归属给这个 owner，并保证系统里至少有一个 admin（否则升级后管理端没人能进）。

**注意**：这一步是幂等的，但**只在第一次有意义** —— 迁移后再产生的 NULL 数据
（比如未登录用户上报的埋点）不会被重新归属。

### 关于笔记（`notes` 表）的一个发现

审计时以为「笔记没有 user_id 是严重问题」，查下来发现不是：

**前端的笔记根本不走数据库。** `src/stores/notesStore.ts` 是 Zustand + `persist`，
数据在浏览器 localStorage 里。后端的 `notes` 表只被 `ai_jobs.py` 用来存**AI 转写产物**，
属于视频的附属资源，共享是合理的。

所以 `notes` 的 PUT 接口设成 `require_admin`（改转写产物等于改检索语料），但不加 `user_id`。

**真正的问题是另一件事**：笔记、番茄钟这些存在 localStorage，
**换账号登录能看到上一个账号的数据**。这是浏览器级隔离，不是账号级隔离。
要改成账号级需要把它们迁到后端（`user_data` 表已经具备条件）。
**这次没做，因为涉及前端 5 个 store 的改造，风险高于收益。记在遗留项里。**

---

## 四、P0：SSRF —— 服务器被当跳板

**证据**：`backend/app/routers/assistant.py` 原第 168-176 行

```python
@router.post("/models")
def assistant_models(payload: AssistantModelListCreate):
    client = OpenAICompatibleClient(base_url=payload.base_url, ...)   # 用用户传的地址发请求
```

`base_url` 完全由请求方控制，服务端会真的去 `GET {base_url}/models`。
这是典型的 SSRF：攻击者传入 `http://169.254.169.254/latest/meta-data/` 就能读云主机元数据，
传入内网地址就能探测内网拓扑。

**修复**：
1. 这两个端点改为 `require_admin`（管理员本身就有配置模型的权限）
2. 校验协议只允许 `http` / `https`，挡住 `file://`、`gopher://` 这类
3. **没有做内网 IP 黑名单** —— 因为本地 LM Studio 就在 `127.0.0.1:1234`，挡了就废掉核心功能。
   风险降级为「管理员能配置模型地址」，这是原本就该有的权限。

同类问题：`/api/ai-jobs/batch` 也没有鉴权，任何人都能让服务器批量跑 whisper，
把 CPU 占满几小时。已改为 `require_admin`。

---

## 五、网关层

### 端口暴露：数据库和 Redis 对全世界开放

**证据**：`docker-compose.yml` 原第 58-59、74-75 行

```yaml
ports:
  - "${POSTGRES_PORT:-5432}:5432"    # 等价于 0.0.0.0:5432
  - "${REDIS_PORT:-6379}:6379"      # Redis 没有任何认证
```

`0.0.0.0` 意味着只要这台机器有公网 IP，5432 和 6379 就暴露在互联网上。
Redis 尤其危险：**没有密码**，任何人都能读写队列、注入任务。

**修复**：改绑 `127.0.0.1`。容器之间走 Docker 内部网络，不受影响；
宿主机上的工具（psql、redis-cli）照常能连；公网扫不到。

### 安全响应头：一个都没有

原来响应头只有 `Server: nginx/1.31.8`（还顺带告诉别人版本号）。

**修复**（`nginx.conf`）：

| 头 | 取值 | 挡住什么 |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | 上传 .txt 被当 .js 执行 |
| `X-Frame-Options` | `SAMEORIGIN` | 点击劫持（把站点嵌进钓鱼页） |
| `Content-Security-Policy` | `frame-ancestors 'self'; object-src 'none'; base-uri 'self'` | 同上，且禁止加载插件对象 |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | 跳转外站时泄露完整 URL（可能含会话标识） |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` | 页面被注入脚本后调用设备能力 |

**没有启用严格的 `script-src`**：Vite 产物含内联引导代码，收紧会白屏。
真要上严格 CSP 需要先给内联脚本加 nonce，这是单独的活。

### 限流：网关层原本完全没有

**修复**：把 `nginx.conf` 从 `conf.d` 片段提升为完整配置（`limit_req_zone` 只能定义在 `http` 块）：

| 路径 | 限制 |
|---|---|
| `/api/auth/login` | 20 次/分钟，突发 10 |
| `/api/auth/register` | 20 次/分钟，突发 5 |
| `/api/assistant/chat/stream` | 30 次/秒，突发 20 |
| `/api/` 其余 | 30 次/秒，突发 60 |
| 单 IP 并发连接 | 40 |

### 接口文档默认关闭

`ENABLE_DOCS` 默认 `true` → `false`。`/api/docs` 会把所有端点、参数结构、
内部枚举值完整交出去，等于给攻击者一份地图。nginx 层额外加了硬拒绝作为第二道防线。

---

## 六、稳定性

### 1. 健康检查在统计 300 万行

**证据**：`backend/app/database.py` 原 `check_database()`

```python
info["segment_embeddings"] = connection.execute(text("SELECT count(*) FROM segment_embeddings")).scalar()
```

Docker healthcheck 每 30 秒打一次 `/health`，每次都 `count(*)` 一张 300 万行的表。
这是给数据库加了一份**与业务无关的持续负载**，而且随数据量线性变差。

**修复**：`check_database(deep=False)` 跳过行数统计。存活探针只需要知道「连得上、查得动」。
详细指标在 `/ready` 与 `/api/admin/health`。

### 2. AI worker 崩了不会重启

**证据**：`backend/app/main.py` 原 `lifespan`

```python
worker_proc = subprocess.Popen([sys.executable, "-m", "app.worker"], ...)
yield    # 之后再也没有人看它
```

worker 是独立进程（faster-whisper 崩溃不能带走 API），但**只在启动时拉起一次**。
进程死了没人知道，AI 任务会一直排队，前端看到「排队中」永远不动。

**修复**：`WorkerSupervisor` —— 监督线程，`proc.wait()` 返回且不是主动停止时，
记录退出码并 5 秒后重启。关闭时先 `terminate()`，10 秒不退出再 `kill()`。

### 3. 后台线程抛一次异常就永久死亡

**证据**：`_run_background_thumbnails()` —— `while True` 里没有任何 `try`。
ffmpeg 偶发失败（文件被占用、磁盘暂时不可写）就会让整个线程退出，
此后缩略图再也不生成，而且**没有任何报错**。

**修复**：每次生成包 `try/except` 并记日志，单轮失败跳过继续。
另外加了一个判断：**两个开关都关着时直接返回**，不要每 2 秒空转一次。

### 4. 规划任务会无限排队

**证据**：`backend/app/routers/learning.py` 原 `generate_path()`

```python
_executor = ThreadPoolExecutor(max_workers=2)
...
_executor.submit(_work)    # 没有任何上限
```

用户连点 10 次「生成路径」= 10 个 30 秒的任务排队，
第 10 个要等 5 分钟，而前端还在转圈。而且进程重启后，`agent_runs` 里的 `running` 记录
**永远卡住**，前端无限轮询。

**修复**（三件一起）：

| 措施 | 效果 |
|---|---|
| **去重**：同一用户 + 同一目标 + 15 分钟内有 running 任务 → 直接复用 run_id | 连点不再产生重复任务 |
| **并发上限** `MAX_INFLIGHT = 4` | 超出立刻 429，而不是排队 5 分钟后失败 |
| **僵尸清理** `_reap_stale_runs()` | 超过 15 分钟还在 running 的标记失败，前端能拿到结果 |

「排队 5 分钟后失败」比「立刻拒绝」体验更差 —— 用户等了 5 分钟才知道失败，还会以为系统卡死。
这是有意的产品取舍。

### 5. 前端所有请求都是匿名的

**这是审计中意外发现的**：`src/lib/videoApi.ts` 的 `apiFetch` **从来不带 `Authorization` 头**。

后端加鉴权后，前端会全部 401。同步修复：

- 自动附加 `Bearer` 令牌
- **401 统一处理**：清除本地令牌 + 广播 `p2m:auth-expired` 事件 → `authStore` 清空登录态
- 错误信息解析后端结构化错误（`{error: {code, message}}`），而不是把 JSON 原文丢给用户
- 修了一个潜伏 bug：`{ headers: {...}, ...fetchInit }` 的展开顺序会让调用方传的
  `headers` **覆盖**掉默认的 `Content-Type`。改成先展开 `fetchInit` 再写 `headers`

---

## 七、没有修的问题（说清楚，别假装都解决了）

| 问题 | 为什么不修 | 风险等级 |
|---|---|---|
| **令牌存在 localStorage** | 改 httpOnly Cookie 需要同时做 CSRF 防护 + 跨域策略调整，是认证体系重做 | 中：XSS 可窃取令牌。已用 12 小时过期 + 改密码撤销缓解 |
| **没有 refresh token** | 见上文，工作量接近重做认证 | 低：12 小时重新登录一次可接受 |
| **没有 HTTPS** | 需要证书 + 域名。当前是局域网/本机访问 | **高（若上公网）**：明文传输密码和令牌。公网部署必须加反向代理 + 证书 |
| **笔记/番茄钟在 localStorage，不按账号隔离** | 涉及前端 5 个 store 改造 | 中：同一浏览器换账号能看到上一个账号的数据 |
| **视频文件、缩略图公开可访问** | `<video>` 标签不会带自定义 header。要鉴权得改成签名 URL 或 Cookie 鉴权 | 低：视频库是小团队共享资源，不涉隐私 |
| **没有备份策略** | 需要外部存储 | **高**：PG 数据卷是单点。`docker compose down -v` 会全丢 |
| **单进程 ThreadPoolExecutor** | 多副本部署时任务会分散到不同进程，状态在库里所以能工作，但没有分布式锁 | 低：单机部署无影响 |

---

## 八、上线前检查清单

```bash
# 1. 密钥必须换掉（默认值等于没有）
python -c "import secrets; print(secrets.token_urlsafe(48))"   # 填进 JWT_SECRET

# 2. 关掉注册（账号建好后）
ALLOW_REGISTRATION=false

# 3. 确认文档接口关闭
ENABLE_DOCS=false

# 4. 确认数据库端口只绑本地
docker compose config | grep -A2 "5432:5432"    # 应看到 127.0.0.1:

# 5. 确认安全头生效
curl -sI http://localhost/ | grep -iE "x-content-type|x-frame|content-security"

# 6. 确认管理端挡住了普通用户
curl -s -o /dev/null -w "%{http_code}\n" http://localhost/api/admin/health    # 应为 401

# 7. 确认密码不再是无盐 SHA-256
docker exec siteyeb-pg psql -U p2user -d p2learning -c \
  "SELECT username, left(password_hash, 16) FROM users;"    # 应为 pbkdf2_sha256$6
```

**公网部署额外必做**：
1. 前置 HTTPS（Caddy 自动证书最省事，或 nginx + certbot）
2. 开防火墙，只放 80/443
3. 数据库做定时备份（`pg_dump` + 异地存储）
4. 把 `WEB_PORT` 改成非 80，前面再挂一层反代

---

## 九、改动清单

| 文件 | 改动 |
|---|---|
| `backend/app/auth.py` | 全量重写：PBKDF2 哈希、令牌版本、`require_admin`、`get_optional_user` |
| `backend/app/routers/auth.py` | 注册开关、密码强度、登录限流、哈希自动升级、`change-password`、`create-user`、`migrate` 加权限 |
| `backend/app/routers/admin.py` | 路由级 `require_admin`；密钥掩码 |
| `backend/app/routers/assistant.py` | 全端点鉴权、会话按用户、SSRF 防护 |
| `backend/app/routers/learning.py` | 全端点鉴权、按用户隔离、任务去重/上限/僵尸清理 |
| `backend/app/routers/watch_events.py` | 埋点绑定用户、统计按用户 |
| `backend/app/routers/videos.py` | 进度按用户、转写/改字幕限管理员 |
| `backend/app/routers/notes.py` | 改笔记限管理员 |
| `backend/app/routers/ai_jobs.py` | 批量转写限管理员 |
| `backend/app/services/rate_limit.py` | **新增** Redis 限流 |
| `backend/app/services/learning_context.py` | **新增** 路径 → LLM 上下文 |
| `backend/app/services/profile.py` | 画像严格按 `resolved_id` 过滤 |
| `backend/app/migrations.py` | `watch_history.user_id` 列、历史数据归属、管理员兜底 |
| `backend/app/main.py` | `WorkerSupervisor`、后台线程异常保护、健康检查轻量化 |
| `nginx.conf` | 提升为完整配置：安全头、限流、隐藏版本、屏蔽文档 |
| `docker-compose.yml` | 端口绑回环、安全环境变量透传 |
| `src/lib/videoApi.ts` | `apiFetch` 自动带令牌、401 统一处理、错误解析 |
| `src/stores/authStore.ts` | 监听登录失效事件 |
