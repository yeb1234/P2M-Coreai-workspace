# 上腾讯云

目标：从「本机跑」到「公网可访问、多用户可用、能扛住基本滥用」。

先说三个**实测出来的硬约束**，它们决定了方案长什么样。

---

## 一、三个硬约束

### 1. 视频 1.57 TB，不可能整库搬

```
视频总数    21,136 个
总大小      1,574 GB
平均单个      76 MB
```

家庭宽带上行 30Mbps 传完要 **约 5 天**；云硬盘按 1.5TB 计费也不划算
（高性能云硬盘约 ¥0.35/GB/月，一年小一万）。

**结论：演示部署只带子集。** 用 `backend/scripts/pack_media_subset.py` 挑 20–50 个
有字幕、体积适中的视频，通常 3–5 GB，半小时传完。

完整库留在本地，需要时再同步 —— 见文末「完整库怎么办」。

### 2. embedding 依赖 LM Studio，云上没有

```
EMBEDDING_BASE_URL=http://localhost:1234/v1      ← LM Studio
EMBEDDING_MODEL=text-embedding-bge-m3@q8_0
```

这是**最容易低估的一项**。换 embedding 服务不是改个地址：
库里 22 万条向量是用这个模型的 q8_0 量化版算出来的，
换一个实现（哪怕是同名的 bge-m3）向量分布会有漂移，
查询向量和库内向量不在同一空间，检索质量直接掉。

> 之前踩过一次更严重的：建库用 qwen3、查询用 bge-m3，余弦距离恒为 1.35，
> 整整 14GB 向量全是废数据。所以这件事必须认真对待。

三种方案：

| 方案 | 一致性 | 成本 | 说明 |
|---|---|---|---|
| **A. llama.cpp 跑同一 GGUF** | ✅ 完全一致 | 内存 ~2.5GB | LM Studio 底层就是 llama.cpp，同模型同量化 = 同一条推理路径 |
| B. TEI 跑 BAAI/bge-m3 | ⚠️ 有漂移 | 内存 ~3GB | 原版 PyTorch 权重，需要**重建全部向量** |
| C. 外部 API（如硅基流动） | ⚠️ 看实现 | 按 token 计费 | 数据出网，向量大概率也和 q8_0 不同 |

**推荐 A**，`docker-compose.tencent.yml` 里已经写好 `embedding` 服务，用
`profiles: ["embedding"]` 控制是否启动：

```bash
# 先把 bge-m3 的 q8_0 GGUF 放到 ./models/
docker compose -f docker-compose.yml -f docker-compose.tencent.yml \
  --profile embedding up -d
```

启动后确认向量口径没变：

```bash
curl -s "http://localhost/api/search/hybrid?q=事件循环&top_k=3&rerank=false" \
  | python -c "import sys,json;d=json.load(sys.stdin);print([h['vector_score'] for h in d['hits']])"
```

如果分数明显低于原来的 0.6–0.9 区间，说明实现不一致，**必须重建向量**
（`scripts/backfill_embeddings.py --all`，186 万条约 6 小时）。

### 3. 中国大陆节点必须备案

域名解析到中国大陆的 CVM/轻量，**未备案会被拦截**，而且备案要 10–20 个工作日。

三种绕法：

| 做法 | 代价 |
|---|---|
| 用香港/新加坡节点 | 免备案，但大陆访问延迟 40–80ms，且跨境带宽贵 |
| 只给 IP 访问（不开域名） | 不能上 HTTPS，Cookie 的 `Secure` 用不了；面试演示够用，正式用不行 |
| 走备案 | 一次性成本，长期最省心 |

**面试演示建议**：香港轻量 + 域名（或直接用 `https://IP` 自签证书）。
**正式上线**：老老实实备案。

---

## 二、两种档位

### 档位 A：轻量应用服务器（演示 / 小团队）

| 项 | 规格 | 说明 |
|---|---|---|
| 机型 | 2 核 4GB | 够跑全部容器 |
| 系统盘 | 60GB SSD | 镜像 + 子集视频 |
| 带宽 | 5Mbps | 演示够用，视频会卡 |
| 数据库 | 容器内自建 | 数据量小 |
| 成本 | 约 ¥60–100/月 | 以官网为准 |

**能演示什么**：登录、多用户、检索、对话、学习路径、用户管理 —— 全部功能。
**不能做什么**：流畅播放 1GB 以上的视频（带宽限制），跑 whisper 转写（CPU 太弱）。

### 档位 B：CVM 标准型（正式）

| 项 | 规格 | 说明 |
|---|---|---|
| 机型 | 4 核 16GB（SA3/S5） | 向量索引 + 转写都要内存 |
| 系统盘 | 100GB SSD | |
| 数据盘 | 200GB 高性能云硬盘 | 视频子集 + 备份 |
| 带宽 | 100Mbps 按流量 | 视频按需 |
| 数据库 | 优先自建 | 见下方说明 |
| 成本 | 约 ¥700–1200/月 | 以官网为准 |

**关于 TencentDB for PostgreSQL**：支持 pgvector，但扩展版本和 `halfvec` 类型
需要确认（部分版本要提工单开启）。当前代码用的是 `halfvec(1024)` + HNSW，
如果云数据库不支持 halfvec，得改成 `vector(1024)`，索引体积翻倍。
**保守做法：先用 CVM 自建 PG 容器**，确认业务稳定后再评估托管库。

---

## 三、必改的三处配置

### 1. Docker 镜像加速

这台机器直连 Docker Hub 不通（构建时会卡死十几分钟），腾讯云配镜像加速：

```bash
# /etc/docker/daemon.json
{
  "registry-mirrors": ["https://mirror.ccs.tencentyun.com"]
}
```

```bash
sudo systemctl daemon-reload && sudo systemctl restart docker
```

如果镜像要长期托管，推到 **TCR（容器镜像服务）**，内网拉取不走公网流量。

### 2. 真实 IP（放在 CLB 后面时必做）

`nginx.conf` 里已经加了：

```nginx
set_real_ip_from 10.0.0.0/8;
set_real_ip_from 172.16.0.0/12;
set_real_ip_from 192.168.0.0/16;
set_real_ip_from 100.64.0.0/10;   # 腾讯云 CLB 常用段
real_ip_header X-Forwarded-For;
real_ip_recursive on;
```

**不做这一步会同时坏三件事**：

1. `limit_req` 按 IP 计数 → 所有用户共用一个桶，一个人刷满**全员 429**
2. 登录失败锁定 → 一个人输错 8 次，**全员被锁**
3. 访问日志全是 LB 的 IP，出事查不到人

上云后建议把 CIDR 收紧到 CLB 的实际网段（控制台可查）。

### 3. 日志轮转

Docker 默认**不限制**日志体积。云硬盘写满后 PG 会直接崩，
这是云上最常见的一类事故。`docker-compose.tencent.yml` 已经给每个服务设了
`max-size` / `max-file`。

---

## 四、三层限流与配额

云上的限流不是 nginx 一层的事，得三层配合：

| 层 | 位置 | 管什么 | 配置 |
|---|---|---|---|
| **1. 边缘** | CLB / WAF | CC 攻击、恶意 IP、SQL 注入 | 控制台开 WAF 的 CC 防护，阈值建议 100 QPS/IP |
| **2. 网关** | nginx | 路径级速率、并发连接 | 登录 20r/m、API 30r/s、单 IP 并发 40 |
| **3. 应用** | 后端 | 按**用户**的速率与每日配额 | 见下表 |

为什么必须有三层：nginx 看不到「谁在请求」（它只看得到 IP），
而配额只能按用户算。反过来，应用层拦不住 L7 洪水，那个要靠边缘。

### 应用层默认配额

| 维度 | 普通成员 | 管理员 | 超限 |
|---|---|---|---|
| 对话轮数 | 200/天 | 1000/天 | 429 + 明确提示 |
| 路径生成 | 20/天 | 100/天 | 429 |
| 对话速率 | 20/分钟 | 20/分钟 | 429 |
| 登录尝试 | 8 次/15 分钟 · 账号维度 | 同左 | 429 |
| 注册 | 5 个/小时 · IP 维度 | 同左 | 429 |

调整方式（`.env`）：

```bash
QUOTA_CHAT_DAILY=200
QUOTA_PLAN_DAILY=20
QUOTA_ADMIN_MULTIPLIER=5
```

**为什么配额在应用层而不是 nginx**：外部 LLM 按 token 计费，
一个人连续提问能把整月额度跑光，而账单只显示一个总额。
必须按用户记账，这需要在应用层识别身份。

### 一个容易忽略的细节：NAT 出口

公司网络、校园网、手机热点后面，多个用户共享一个公网 IP。
按 IP 限流会**误伤**：一个人刷满，其他人也被拦。

所以登录限流做了双维度：IP 30 次/15 分钟（宽松）+ 账号 8 次/15 分钟（严格）。
真正起作用的拦住暴力破解的是账号维度，IP 维度只是兜底。

---

## 五、安全组

**只开三个端口，其余全部关闭。**

| 方向 | 端口 | 来源 | 说明 |
|---|---|---|---|
| 入站 | 22 | **你的固定 IP/32** | 不要开 0.0.0.0/0，会被爆破 |
| 入站 | 80 | 0.0.0.0/0 | 证书申请 + HTTP 跳转 |
| 入站 | 443 | 0.0.0.0/0 | 业务 |
| 出站 | ALL | 0.0.0.0/0 | 拉镜像、调 LLM API |

**绝不开**：5432（PG）、6379（Redis）、8000（后端）。
compose 里这几个端口已经绑在 `127.0.0.1`，安全组是第二道。

如果用了 TencentDB，数据库走**内网**（同一个 VPC），不要开公网访问。

---

## 六、上线步骤

```bash
# 1. 基础环境
sudo apt update && sudo apt install -y docker.io docker-compose-plugin git
sudo usermod -aG docker $USER   # 重新登录生效

# 2. 配镜像加速（见上文）

# 3. 拉代码
git clone <repo> && cd <repo>
cp .env.example .env && vim .env

# 4. .env 必改项
#    JWT_SECRET          <- 64 位随机串
#    POSTGRES_PASSWORD   <- 强密码
#    DOMAIN              <- 有域名才填
#    COOKIE_SECURE       <- 有 HTTPS 就 true，只有 http 就 false
#    ALLOW_REGISTRATION  <- 首次 true，建完账号改 false
#    QUOTA_*             <- 按团队规模调

# 5. 起服务（带腾讯云覆盖层）
docker compose -f docker-compose.yml -f docker-compose.tencent.yml up -d --build

# 6. 上传媒体子集（本地打包后 scp）
#    本地：python scripts/pack_media_subset.py --limit 30 --out D:/export/subset
#    然后：scp -r D:/export/subset root@<ip>:/opt/media

# 7. 让容器看到媒体
#    .env: VIDEO_HOST_PATH=/opt/media/media

# 8. 自检
./scripts/preflight.sh https://your-domain
```

---

## 七、验收清单

```bash
# 未登录必须 401
curl -s -o /dev/null -w "%{http_code}\n" https://your-domain/api/learning/profile

# 管理端不能被普通用户访问（用普通账号的 Cookie）
# 安全头齐全
curl -sI https://your-domain/ | grep -iE "x-content-type|x-frame|content-security|strict-transport"

# 端口不能从公网访问（在另一台机器上执行，应该全部超时）
nc -zv <公网IP> 5432
nc -zv <公网IP> 6379

# 配额生效（连续调用超过上限应返回 429）
for i in $(seq 1 25); do
  curl -s -o /dev/null -w "%{http_code} " -b cookie.txt \
    "https://your-domain/api/learning/paths/generate" -X POST \
    -H "Content-Type: application/json" -d '{"title":"压测"}'
done
```

---

## 八、完整库怎么办

1.57TB 不适合放云硬盘。三种做法：

| 做法 | 适用 | 代价 |
|---|---|---|
| **COS + 按需下载** | 视频不常看 | 改 `resolve_media_path` 走对象存储，要写适配层 |
| **cosfs 挂载** | 想保持现有代码 | 挂载点当本地盘用，但随机读延迟高，播放大文件会卡 |
| **只同步最近在看的** | 个人使用 | 最简单，用 `pack_media_subset.py` 定期同步 |

**面试场景不需要完整库。** 30 个视频足够演示检索、对话、路径规划 ——
这些功能的价值在于「Agent 能基于你的真实数据说话」，
不在于「库有多大」。

---

## 九、成本速算（量级参考，以官网为准）

| 项 | 档位 A | 档位 B |
|---|---|---|
| 服务器 | ¥60–100/月 | ¥400–700/月 |
| 云硬盘 | 含在系统盘 | +¥70/月（200GB） |
| 带宽 | 含 5Mbps | 按流量 ¥0.8/GB |
| 对象存储 | 不用 | 按量 |
| WAF | 不用 | ¥300/月起 |
| SSL 证书 | 免费（Caddy/Let's Encrypt） | 免费 |
| **合计** | **约 ¥100/月** | **约 ¥800–1200/月** |

演示用档位 A 足够。真要长期对外提供服务，先跑档位 A 观察真实用量，
再决定要不要上 B —— **不要一上来就买贵的**。
