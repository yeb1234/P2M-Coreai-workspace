# 部署与上线

这份文档解决一个问题：**从「本机能跑」到「可以给别人用」，中间还差什么。**

---

## 三种部署形态

先想清楚给谁用，形态不同，要求差很多。

| 形态 | 适用场景 | 需要什么 | 安全要求 |
|---|---|---|---|
| **A. 本机/内网** | 自己用、家里或工位局域网 | 一条 `docker compose up -d` | 基本够用，别忘了关注册 |
| **B. 公网 + 域名** | 给面试官、给朋友试用 | 一台 VPS + 一个域名 | **必须 HTTPS** |
| **C. 内网穿透** | 不想买 VPS，临时演示 | Cloudflare Tunnel / frp | 至少开 Tunnel 侧鉴权 |

**不要做的**：把 80 端口直接映射到公网就开始用。密码和会话令牌都是明文过网，
等于每次登录都在广播凭据。

---

## A. 本机 / 内网

```bash
cp .env.example .env
# 必填：POSTGRES_PASSWORD、JWT_SECRET、EXTERNAL_LLM_API_KEY
python -c "import secrets; print(secrets.token_urlsafe(48))"   # 生成 JWT_SECRET
docker compose up -d --build
```

打开 `http://localhost`，注册第一个账号 —— **它会自动成为管理员**（系统里没有管理员时，
首个注册者提权，这是为了升级兼容；`ADMIN_USERNAMES` 白名单优先）。

建完自己的账号后：

```bash
# .env
ALLOW_REGISTRATION=false     # 关掉公开注册
JWT_EXPIRE_HOURS=12
```

重启生效：`docker compose up -d backend`。

后续加人走「设置 → 用户管理 → 新建账号」，或 `POST /api/auth/create-user`。

---

## B. 公网 + 域名（面试演示用这个）

### 1. 前置条件

- 一台能跑 Docker 的机器（2C4G 起，向量回填会吃满 CPU）
- 一个域名，A 记录指向这台机器
- 80 / 443 端口可从公网访问（安全组/防火墙放行）

### 2. 起服务

```bash
# .env 里补两行
DOMAIN=learn.your-domain.com
COOKIE_SECURE=true          # HTTPS 必须开，否则 Cookie 安全属性不生效

docker compose -f docker-compose.yml -f docker-compose.https.yml up -d --build
```

Caddy 会自动申请 Let's Encrypt 证书，**不需要手工跑 certbot**。
首次申请需要 80 端口能被访问（HTTP-01 挑战）。

### 3. 为什么用 Caddy 而不是 nginx + certbot

证书申请、续期、HTTP→HTTPS 跳转、HTTP/2、HTTP/3 全是默认行为，配置只有三行。
nginx 方案要写 webroot、配 cron、处理续期失败、自己加 HSTS，出错面大得多。

现有的 nginx 容器仍然保留（负责 SPA 托管和 API 反代），Caddy 只在最外层做 TLS 终止：

```
用户 → Caddy(443, TLS) → nginx(前端+API 反代) → backend
```

### 4. 证书持久化

证书存在命名卷 `siteyeb-caddy-data` 里。**不要删这个卷** ——
Let's Encrypt 对同一域名有申请频率限制（每周 5 次），反复重建会触发限流。

---

## 多用户管理

管理员在「设置 → 用户管理」里可以：

| 操作 | 效果 |
|---|---|
| 新建账号 | 直接可用，无需邮箱验证 |
| 设为管理员 / 降为成员 | 立即生效（权限判断读数据库，不是读令牌） |
| 停用 | **该用户已登录的所有设备立即掉线**（token_version +1） |
| 重置密码 | 同上，旧密码和旧会话同时失效 |
| 删除账号 | 连同其学习记录、路径、笔记一起删除；视频库和字幕不受影响 |

三条防呆规则（后端强制，不是只靠前端）：

1. 不能停用、降级、删除自己
2. 系统始终保留至少一个启用的管理员
3. 越权访问别人的资源返回 **404 而不是 403** —— 403 会暴露「这个 id 存在」

### 数据隔离边界

| 数据 | 隔离方式 |
|---|---|
| 学习记录、画像、路径、对话历史 | 数据库按 `user_id` 过滤 |
| 笔记、待办、番茄钟 | 前端存储按 `user_id` 分区（`u{id}:{key}`），后端 `user_data` 已按用户鉴权 |
| 视频库、字幕、向量索引 | **共享资源**，所有登录用户可见。这是产品选择：小团队共享一个视频库 |
| 管理配置、任务队列 | 仅管理员 |

---

## 备份

```bash
./scripts/backup.sh                 # 备份到 backups/，保留 7 天
KEEP_DAYS=30 ./scripts/backup.sh    # 自定义保留期
```

备份走 `pg_dump -Fc`（自定义格式，可选择性恢复单表），完成后会校验文件头。

定时任务（Linux）：

```bash
crontab -e
0 3 * * * cd /path/to/project && ./scripts/backup.sh >> backups/backup.log 2>&1
```

**体积注意**：含向量表时约 500MB+，因为 `segment_embeddings` 存了 300 万条 1024 维半精度向量。
如果只想备份业务数据，可以加 `--exclude-table=segment_embeddings`，但恢复后需要重跑回填。

### 恢复

```bash
./scripts/restore.sh backups/p2learning-20261115-031500.dump
```

脚本会先自动做一次当前状态的备份（回滚点），再执行恢复，并要求输入 `yes` 确认。

---

## 上线自检

```bash
./scripts/preflight.sh                       # 检查本机
./scripts/preflight.sh https://your-domain   # 检查线上
```

检查 16 项，输出 PASS / WARN / FAIL：

```
== 配置 ==
  PASS  JWT_SECRET 长度 64，非默认值
  WARN  注册仍开放：公网会被灌号
  PASS  HTTPS 部署且 COOKIE_SECURE=true
== 网络暴露 ==
  PASS  5432/6379 未暴露到公网
== 接口边界 ==
  PASS  未登录访问 /api/admin/health -> 401
  ...
== 结果 ==
  通过 14 / 警告 2 / 失败 0
```

有 FAIL 就别发布。WARN 要么解决，要么能解释清楚为什么可以接受。

---

## 故障排查

**登录成功但立刻被踢回登录页**
`COOKIE_SECURE=true` 但用 http 访问 —— 浏览器不会保存 Secure Cookie。
要么上 HTTPS，要么改回 `false`。

**改完 JWT_SECRET 后所有人都要重新登录**
正常。令牌是用旧密钥签的，验不过。一次性代价。

**证书申请失败**
80 端口被占用或域名没解析到本机。先 `curl -I http://your-domain` 确认能到。
Let's Encrypt 有频率限制，调试时可以先设 `ACME_EMAIL` 为真实邮箱并等 1 小时。

**容器 healthy 但页面白屏**
看 `docker logs siteyeb-frontend`。前端构建期 `VITE_API_BASE_URL` 留空才走同源反代；
设了值而值与实际域名不一致会导致所有 API 404。

**想清空所有数据重来**
```bash
docker compose down            # 停容器，保留数据
docker compose down -v         # 连数据卷一起删，不可恢复
```

---

## 面试时可以怎么讲这一段

如果被问「你这个能上线吗」，有说服力的答法不是「能」，而是**讲清楚边界**：

> 单机到小团队规模可以直接跑。我做了三层：
> 传输层用 Caddy 自动证书，会话令牌放 httpOnly Cookie 而不是 localStorage；
> 应用层做了 RBAC、CSRF 双保险、登录限流和账号级数据隔离；
> 运维层有 pg_dump 定时备份和一份 16 项的上线自检脚本。
>
> 但我也清楚它现在**不适合**多租户 SaaS：没有组织/团队概念，视频库是全局共享的，
> 计费、审计日志、跨区域都没做。要做成 SaaS，数据模型得先加 tenant_id，
> 那是重构不是迭代。

**主动说「不适合什么」，比声称「什么都能做」可信得多。**
