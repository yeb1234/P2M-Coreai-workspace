# 日志：够用就好

时间：2026-11-16

## 一句话结论

**单人自托管不需要 ELK/Loki。** 需要的是四件事，成本低得多：

| 需求 | 做法 | 成本 |
|---|---|---|
| 磁盘不会被写满 | docker 轮转 + 应用侧 RotatingFileHandler | 一行配置 |
| 容器重建后还能查历史 | 日志落到 `./logs/*.jsonl`（挂载出来） | 一条 volume |
| 能按 request_id 串起一次请求 | 已有（含 worker 的 job id） | 0 |
| 能快速找错误 | `bash scripts/logq.sh errors` | 50 行脚本 |

Loki + Promtail 能吃 300-800MB 内存，而这里一天的数据量是「几万行」。
够不着的规模，别提前上。

---

## 一、日志去哪了

```
应用进程
  ├─ stderr  → docker json-file（轮转 20MB × 3）→ docker logs
  └─ 文件    → /data/logs/{backend,worker}.jsonl（轮转 20MB × 5）
                 └─ 挂载到宿主机 ./logs/
```

**为什么要两份**：`docker logs` 随容器消失，排查「昨天那次 500」只能靠文件；
文件用 `less`/`grep`/`jq` 都要自己找路径，日常看实时还是 `docker logs` 顺手。

**为什么 backend 和 worker 分文件**：`RotatingFileHandler` 不是多进程安全的，
两个进程同时轮转到同一个文件会互相截断。

单个 JSONL 行：

```json
{"ts":"2026-11-16T06:58:10.970","level":"ERROR","logger":"app.core.errors",
 "msg":"未捕获异常","request_id":"test-abc123","svc":"backend",
 "exc":"Traceback ...\nValueError: 视频不存在 id=99999999"}
```

字段说明：`ts` 本地时间（毫秒）、`level`、`logger`、`msg`、`request_id`、
`svc`、可选 `exc`、访问日志额外带 `method/path/status/ms/client`。

---

## 二、怎么查

```bash
bash scripts/logq.sh errors --since 1h      # 错误（含异常类型）
bash scripts/logq.sh req test-abc123        # 一次请求/一个任务的完整日志
bash scripts/logq.sh path /api/notes        # 某个接口
bash scripts/logq.sh grep 转写失败           # 全文
bash scripts/logq.sh stats --since 24h      # 按级别/logger/状态码聚合
bash scripts/logq.sh tail 30                # 最近 30 条
bash scripts/logq.sh files                  # 有哪些日志文件、多大
```

加 `--json` 输出原始行，方便接 `jq`。轮转出来的 `.1` `.2` 会自动带上，
不用手动指定。

**request_id 是重点**，没有它就只能靠时间戳猜：

- HTTP 请求：中间件生成，回在 `X-Request-ID` 头，也会写进 500 的响应体
- 转写任务：`job-{job_id}`
- 后台任务：`bg-{task_id}`

所以「用户报错给了个 id」和「某个转写任务跑到哪一步了」都能一条命令拉出来。

---

## 三、踩过的三个坑

### 1. 脱敏只做了一半

第一版只过滤 `extra_fields` 的**键名**，于是

```python
logger.info(f"登录失败 user={u} pwd={p}")   # 密码原样落盘
```

现在加了一层**内容级正则**：`password=`/`token:`/`Bearer xxx`/`sk-xxx`/JWT
都会被盖成 `***`。规则只在「敏感词 + 分隔符 + 值」同时出现时才动手，不误伤正常文案。

### 2. 异常堆栈截断把最关键的一行切掉了

`exc[:2000]` 保留的是前 2000 字 —— 而那正好是「谁调了谁」，
**最后那行「到底什么错」被切没了**。日志里只剩一句「未捕获异常」，等于没记。

改成保留首尾（前 60% + 后 40%），中间标注省略了多少字。

### 3. 500 的 request_id 是 `-`

`@app.exception_handler(Exception)` 挂在 `ServerErrorMiddleware` 上，比
`BaseHTTPMiddleware` 更外层，那个上下文里读不到中间件设的 contextvar。
于是日志里 `request_id: "-"`，而响应体又写着「请附带 request_id 反馈」——
让人拿个空号来查。

修法：中间件同时把 id 写进 `request.scope`，异常处理器从 scope 回填。

---

## 四、保留策略

| 日志 | 轮转 | 上限 | 位置 |
|---|---|---|---|
| 应用（backend） | 20MB × 5 | 100MB | `./logs/backend.jsonl*` |
| 应用（worker） | 20MB × 5 | 100MB | `./logs/worker.jsonl*` |
| docker stdout | 20MB × 3 | 60MB/服务 | `/var/lib/docker/containers/…` |

按现在的量（一天几万行、约几十 MB），够留两周以上。

**nginx 访问日志没有单独落盘**：它基本是 `/api/` 请求的重复记录，
而真正有价值的是 error log（502 的 `connect() failed`），
已经从 `docker logs siteyeb-frontend` 里看（diagnose.sh 第 6 段）。

---

## 五、什么时候该升级

满足任一条，就值得上 Loki + Promtail（应用侧不用改，JSON 单行本来就是为此准备的）：

- 超过一台机器
- 需要留存 30 天以上
- 需要按多个维度做看板（PV/错误率/慢请求 Top N）
- **有第二个人同时查日志**

在那之前，多装一套东西只会多一个会挂的组件。

---

## 六、运维入口

```bash
bash scripts/diagnose.sh        # 出问题时的第一条命令（只读）
bash scripts/logq.sh errors     # 找错误
```

`diagnose.sh` 的第 8 段会列出现有日志文件和大小；
第 2 段会打出健康探针的历史输出，能还原「什么时候开始退化的」。
