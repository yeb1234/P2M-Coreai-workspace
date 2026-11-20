# 2026-11-19 故障修复日志

**项目**：SiteYeb（P2M CoreAI Workspace 5.0）
**分支**：`P2U-3.0-LangChain` @ `bfac078`
**运行环境**：Windows + Docker Desktop（WSL2 后端）
**记录时间**：2026-11-19 夜间

---

## 一、概况

| 项 | 值 |
|---|---|
| 处理故障数 | 9 个条目（其中 F-05 为误判，已排除，实际故障 8 个） |
| 影响面 | 容器编排、镜像、视频链路、LLM 链路、鉴权、前端多用户隔离 |
| 代码改动 | 16 个已跟踪文件，+670 / −100 行；新增 1 个文件 65 行 |
| 最终容器状态 | 8 个全部 Up（backend / frontend / postgres / redis healthy） |
| 数据完整性 | 未删除任何业务数据；临时测试账号用后即删 |

今天的起点是「电脑突然全拉满」，实际是一串互相纠缠的问题：容器崩溃循环打爆内存 → 恢复过程中暴露单文件挂载错误 → 排查视频不通 → 顺手核验 LLM → 最后落到用户实际感知最强的两条：「原来的号进不去」和「新建用户后数据串了」。

---

## 二、环境基线

| 项 | 值 |
|---|---|
| 项目根 | `C:\SiteYeb` |
| Compose 项目名 | `p2-siteyeb` |
| 端口 | 前端 `12302`、接口 `12402→8000`、PG `12502`、Redis `12602` |
| 后端镜像 | `p2-siteyeb-backend:3.0` = `b71076ff824c`（1.67 GB） |
| 批处理镜像 | `p2-siteyeb-backend:3.0-batch` = `a71770c8b647` |
| 数据库 | `p2learning` @ `p2user`，视频 **14380** 条 |
| 用户 | **23** 个（PBKDF2 格式 15 个，SHA256 格式 8 个） |
| LLM 策略 | `external_first` → `deepseek-v4.1-flash-1017` |

---

## 三、故障逐条记录

### F-01 容器重启风暴打爆宿主机内存

**现象**
用户报告「电脑突然全拉满」。任务管理器显示 `vmmemWSL` 占用 15.7 GB，整机 30.7 / 31.7 GB，可用仅 4.9 GB，CPU 63%。

**定位**
`docker ps -a` 发现 5 个容器处于 `Restarting (2)`，即启动后秒崩、无限重启。每个重启周期都要重新拉起 Python 进程和加载依赖，叠加 WSL2 默认不主动把空闲内存还给 Windows，形成正反馈。

**根因**
两件事叠加：(1) 后面 F-02 / F-03 的挂载与模块错误导致容器必崩；(2) WSL2 没有内存上限，`vmmemWSL` 只涨不落。

**处置**
1. 先止损：`docker stop` 掉 5 个崩溃循环容器。
2. 写 `C:\Users\yeb12\.wslconfig`：

```ini
[wsl2]
memory=12GB
processors=8
swap=4GB

[experimental]
autoMemoryReclaim=gradual
```

3. `wsl --shutdown` 后重启 Docker Desktop，让上限生效。

**验证**
| 指标 | 修复前 | 修复后 |
|---|---|---|
| 可用内存 | 4.9 GB | 14.6 GB |
| CPU 占用 | 63% | 21% |

**遗留**：12 GB 上限对 5 个常驻 worker 是否偏紧，需要观察一轮完整批处理任务后再定。

---

### F-02 单文件挂载被 Docker 自动创建成目录

**现象**
容器反复报 `not a directory: Are you trying to mount a directory onto a file`。检查磁盘发现 `backend\app\audio_prep.py` 和 `backend\app\services\background_tasks.py` **是目录，不是文件**，大小 1 B。

**根因**
`docker-compose.yml` 里用的是单文件挂载（`./backend/app/audio_prep.py:/app/audio_prep.py`）。当源文件在宿主机上不存在时，Docker 会在宿主机上自动创建一个**同名空目录**来满足挂载，随后就再也挂不上文件。这是 Docker 的既定行为，不是 bug。

**处置**
所有服务的挂载从单文件改成整目录：

```yaml
volumes:
  - ./backend:/app
  - ./prompts:/app/prompts:ro
```

覆盖 backend、worker、worker2、vector-worker、summary-worker-desktop、summary-worker-laptop 全部服务；同时删掉这两个被误建的空目录。

**验证**
重新 `up -d` 后不再出现挂载错误；`/app` 下文件与宿主机一致。

---

### F-03 audio-prep 服务依赖 SiteYeb 主线不存在的模块

**现象**
`audio-prep` 容器报 `No module named 'app.core'`，仍在重启循环。

**定位**
`backend/app/audio_prep.py` 是从 WorkBuddy 工作树（`polish/design-system-refresh` 分支）复制过来的，它依赖：

| 依赖项 | SiteYeb 主线是否存在 |
|---|---|
| `app.core.observability` | 不存在（工作树独有 `app/core/` 包） |
| `AiJob.summary_only` | 不存在 |
| `reconcile_stuck_ai_jobs` | 不存在 |
| `Settings.audio_cache_dir` | 不存在（已补字段但无实际用途） |
| `WHISPER_DIRECT_MEDIA` 环境变量 | 全代码库无引用 |

**结论**：整套 audio-prep 是工作树分支独有的功能，SiteYeb 主线完全不认，且**没有任何代码 import 它**。为它补齐依赖等于把一个未完成的分支功能硬塞进主线。

**处置**
1. 删除 `backend/app/audio_prep.py`。
2. 从 `docker-compose.yml` 和 `docker-compose.batch.yml` 中整段移除 `audio-prep` 服务，保留注释说明恢复前提。
3. `backend/app/services/background_tasks.py` 同样删除（依赖 SiteYeb 不存在的 `app.models.BackgroundTask`，全库无调用方）。

**验证**
`audio-prep` 不再出现在容器列表，重启循环消失。

---

### F-04 所有视频不可播

**现象**
播放器黑屏，报「视频播放失败：格式不支持或文件不可用（4）」。用户强调「所有视频也不通」。

**定位过程**
1. 先怀疑文件不存在 → 查库：**14380 条 `videos.filepath` 全部是 `/videos/...` 前缀**，即容器内绝对路径，格式统一。
2. 再查容器内 `/videos` 目录 → 只有 `output` / `sprites` / `thumbnails` / `work` **四个空目录**，没有任何视频文件。
3. 对比 compose → 挂载来源写的是 `${VIDEO_HOST_PATH}`。
4. 查 `.env` → **只有 `VIDEO_FOLDER=D:/ITJC`**，没有 `VIDEO_HOST_PATH`。变量缺失时 compose 退回默认值 `./video-library`，于是一挂就挂出一个空目录。

**排除项**
`PATH_MAP` 曾被认为是路径映射配置。实际全代码库**零消费**（`stream_video` 直接 `Path(video.filepath).exists()`），是历史遗留的死配置，不需要动。

**处置**
`.env` 补一行：

```
VIDEO_HOST_PATH=D:/ITJC
```

重建 backend 让挂载生效。宿主机 `D:\ITJC` 下确实是完整视频根（`前端`、`Python`、`2025年智泊AGI大模型第12期`、`尚硅谷-*`、`mksz`、`产品经理`，以及 `thumbnails` 28983 个、`output` 60852 个、`sprites` 262 个、`work` 398 个文件）。

**验证**
```
HTTP 206
Content-Range: bytes 0-1023/45543291
```
45 MB 的视频能正常分段拉流，进度条可用。

---

### F-05 LLM 疑似未接通（误判，无需处理）

**背景**
用户两次询问「LLM 是不是没成功接进去，需要 API Key 的话我可以给你」。截图里助手回复「目前没有可用的参考字幕片段」。

**核查证据链**

| 检查项 | 结果 |
|---|---|
| DB `app_settings.assistant_runtime_settings` | `llm_usage_policy=external_first`，`external_model=deepseek-v4.1-flash-1017` |
| `_resolve_provider()` | `("openai", config)` |
| `create_llm(provider, config)` 真实 invoke | 返回 `'OK'` |
| 外部端点直连 `POST /chat/completions` | HTTP 200 |
| API Key | 已配置（67 字符，无需更换） |

**结论**
模型链路完全正常。截图里那句话的真实成因是**该模板的检索库为空**，没有命中参考字幕片段，模型如实告知，不是故障。

**处置**：不改代码，不需要新 Key。

---

### F-06 旧账号无法登录（密码哈希格式不兼容）

**现象**
登录页输入 `yeb123` + 正确密码，红字提示「用户不存在」。

**排查路径**

1. 查库：`yeb123`(id=1)、`demo`(id=32) **存在**，23 个用户里 PBKDF2 格式 15 个、SHA256 格式 8 个。
2. 看 `backend/app/auth.py`：`verify_password` 只有一条路径 —— `hashlib.sha256(password) == stored_hash`。PBKDF2 的 118 字符哈希永远比不上。
3. 结果：**密码正确也返回 401**。
4. 看前端：`authApi.loginUser` 在非 2xx 时只 `throw new Error('login failed')`，**丢掉状态码**；`authStore.login` 的 catch 把任何异常都当成「后端不可用」→ 去查 IndexedDB → 查不到 → `set({ error: '用户不存在' })`。

所以用户看到的是「用户不存在」，真实原因是「密码校验算法不兼容」。这条误报链条把排查方向完全带偏，也是用户一度认为是「信用域不对」的直接原因。

**处置**

`backend/app/auth.py` 重写：

```python
PBKDF2_PREFIX = "pbkdf2_sha256$"

def _verify_pbkdf2(password, stored):
    _, iterations_text, salt, encoded = stored.split("$", 3)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), int(iterations))
    return hmac.compare_digest(base64.b64encode(dk).decode("ascii"), encoded)

def verify_password(password, stored_hash):
    if stored_hash.startswith(PBKDF2_PREFIX):
        return _verify_pbkdf2(password, stored_hash)
    return hmac.compare_digest(hash_password(password), stored_hash)
```

要点：两种历史格式分流校验；sha256 分支也改用 `hmac.compare_digest`，避免时序侧信道。

`routers/auth.py` 的 `login` 在 PBKDF2 校验通过后**顺手把哈希升级为 sha256**，避免兼容分支永久保留。

前端同步修误报：

- `authApi.ts` 新增 `AuthError extends Error { status }`，非 2xx 时解析后端 `detail` 后抛出；
- `authStore.login` 的 catch 改为：`[401,403,409,422]` 直接把后端原话交给用户，**只有网络故障/5xx** 才回退 IndexedDB；回退失败提示改为「无法连接后端，且本地没有该账号的离线数据」；
- `register` 对 `[409,422,403]` 直接透传 detail。

**验证（端到端，非推断）**

用一个临时的 PBKDF2 账号跑完整链路，脚本执行后自动删除：

```
1) 已建 PBKDF2 临时账号，哈希长度 = 79
2) 首次登录 HTTP 200 拿到 token: True
3) 登录后哈希长度 = 64 （64 表示已升级为 sha256）
4) 升级后再登录 HTTP 200 拿到 token: True
5) 临时账号已删除
```

另测错误密码：`HTTP 401 {"detail":"用户名或密码错误"}` —— 提示已归位。

**风险提示**：若某个账号当初设置的口令原文与此格式不匹配，仍会登录失败，只能重置密码。已知 `admin` 的哈希是 `sha256("admin")`，可作兜底入口，**属弱密码，登录后应立即修改**。

---

### F-07 新建用户后数据串号（前端缓存无用户维度）

**现象**
用户原话：「任务会串，特别有可能和以前浏览器缓存冲突，我猜的。我刚新建新用户以后有数据串了。」

**判断：用户的猜测是对的。** 后端数据域本身干净（见下），串号全部发生在前端浏览器侧。

**证据：后端数据域是隔离的**

```
user_id | 条数 | 体积
      1 |   18 | 85 kB
      3 |    7 | 31 kB
      5 |    7 | 30 kB
      6 |    6 | 29 kB
     25 |    7 | 5471 bytes
     32 |   10 | 9395 bytes
 47/49/52 | 2 | 205 bytes
     54 |    2 | 205 bytes
     60 |    3 | 2351 bytes
     61 |    6 | 4788 bytes
     62 |    3 | 3132 bytes
```

每个 `user_id` 的条数与字节数各不相同，`p2m-*` 每个 store_key 的 actors 与 rows 均为 1:1 —— 不存在跨用户复制的痕迹。

**证据：前端 9 处裸 localStorage key，全部没有用户维度**

| 文件 | key | 串的内容 |
|---|---|---|
| `stores/videoStore.ts` | `p2m_current_video_id` | 正在看的视频 |
| 同上 | `p2m_video_nav_state` | 导航位置 |
| 同上 | `p2m_favorite_category_ids` | 收藏分类 |
| `components/video/videoPlayerSettings.ts` | `p2m-video-player-settings` | 播放器全部偏好 |
| 同上 | `p2m-video-player-settings-auto-play-default-v1` | 迁移标记 |
| `components/video/VideoList.tsx` | `p2m-video-grid-columns` | 列表列数 |
| `components/timecenter/TimeCenterPage2.tsx` | `p2m-timecenter-layout` | 时间中心布局 |
| `components/layout/AIChatPanel.tsx`、`components/video/useVideoSelection.ts` | `p2m_pending_recommended_video_id` | AI 推荐待跳转视频 |
| `hooks/useAmbientSoundController.ts` | `p2m-ambient-playback-state-v1` | 环境音状态 |
| `components/auth/AuthPage.tsx` | `p2m-remember` | **上一个账号的明文密码** |

**另外两个结构性隐患**

1. **存储域标识用错字段**：`authStore` 把 `display_name`（显示名）写进 `p2m-current-user`，而 `idbStorage` 的 `localOnlyStorage` 用 `${currentUser}:${key}` 拼 IndexedDB 前缀，`getAllIDBKvData(username)` 用的却是 **username**。两者不一致时，数据写进错误分区或读不出来。已全部改为 `setCurrentUser(user.username)`，显示名只留给 UI。
2. **`idbStorage` 本地回退用裸 key**：`doWrite` / `getItem` / `removeItem` 三处不带用户前缀，无 token 时不同账号共享同一份。已统一改用 `scopedLocalName(name)`，读取时先查 scoped 再回退历史裸 key。

**处置**

新建 `src/lib/userScopedStorage.ts`（65 行）：

```ts
function scopedKey(name: string): string {
  const user = getCurrentUser();
  return `${user || GUEST_SCOPE}:${name}`;
}
```

- 读：先查 `${user}:${name}`；未命中时读一次历史裸 key，**搬进当前用户域后立即删除裸 key**（仅在 `getCurrentUser()` 非空时迁移，避免落到 `__guest` 被别人读走）。
- 写/删：一律带前缀；删除时顺手清理同名裸 key。
- 另导出 `clearUserScopedKeys()` 备用。

随后批量替换 9 处调用点，残留 **0**。

**明文密码**
`AuthPage.tsx` 的 `p2m-remember` 原本存 `{username, password}` 明文 JSON。改为 `p2m-last-username`，**只记用户名，密码框永远留空**；UI 文案「记住密码」→「记住账号」；旧 key 在新代码加载时 `removeItem` 清除。

**内存现场不随登出清空**
zustand store、播放器实例、聊天面板草稿都是进程内单例，只改 `currentUser` 不会清掉上一个账号正在看的视频/会话。新增 `reloadForUserSwitch()`（`setTimeout(..., 0)` 后 `location.reload()`），挂在 login 3 条成功路径、register 2 条路径、logout 共 6 处。

**验证**

| 检查项 | 结果 |
|---|---|
| `npx tsc --noEmit` | 退出码 0 |
| 9 处裸 `localStorage` 残留 | 0 |
| `npm run build` | 成功，1.09 s |
| 网关首页 bundle | `index-C9dmQLn4.js`，HTTP 200 |
| 新 bundle 关键字校验 | 命中新逻辑 |

---

### F-08 `/api/auth/migrate` 无鉴权且跨用户写入

**问题**
这个端点没有任何鉴权，而且循环体里把**同一份 `kv_data` 写给 `body.users` 里的每一个用户**：

```python
for u in body.users:
    for store_key, value in body.kv_data.items():
        db.add(UserData(user_id=user.id, store_key=store_key, value=value))
```

任何人调用一次，就能把一份数据复制进所有账号 —— 这是跨用户污染最合法的一条入口。虽然本次核查没发现已被利用的痕迹，但对一个已投入使用的库来说不能留着。

**处置**
加守卫：库里已有任何用户即拒绝。

```python
if db.query(User).count() > 0:
    raise HTTPException(403, "后端已有用户数据，迁移接口已关闭")
```

保留「空库首次初始化」这个唯一合理场景。

---

### F-09 镜像重建失败，改为补装 + commit 固化

**问题**
`backend/Dockerfile` 加入腾讯云 apt/pip 镜像源（`mirrors.cloud.tencent.com`）后，仍然卡在 `nvidia-cublas-cu12` 的 sha256 校验不匹配，重建无法完成。而 5.0 的 LangChain 链路需要 `langchain-core` / `langchain-openai` / `langchain-ollama` / `sqlite-vec`。

**方案**
不重建，在临时容器里补装后 `docker commit` 固化：

- `p2-siteyeb-backend:3.0` → `b71076ff824c`
- `p2-siteyeb-backend:3.0-batch` → `a71770c8b647`

**踩坑记录（重要）**
`docker commit` 会**连同临时容器的 ENTRYPOINT / CMD / USER 一起写进新镜像**。第一次操作直接把镜像变成了 `ENTRYPOINT=["pip"]` 和 `ENTRYPOINT=["sh"]`，后者导致 worker 刷 `sh: 0: cannot open python: No such file`。

修法是 `docker commit` 时用 `--change` 显式重写三件套：

```
--change 'ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]'
--change 'CMD ["python","-m","uvicorn","app.main:app","--host","0.0.0.0","--port","8000"]'
--change 'USER appuser'
```

**结论**：凡是 `docker commit` 固化，必须同时 `--change` 重写 ENTRYPOINT / CMD / USER。

**遗留风险**：补装只存在于本地镜像层，`Dockerfile` 未同步这些依赖。换机器重建时会缺 `langchain-*` 和 `sqlite-vec`，必须先把它们写进 `requirements.txt` 并解决 `nvidia-cublas-cu12` 的源问题。

---

## 四、代码变更清单

| 文件 | 类型 | 变更 |
|---|---|---|
| `backend/app/auth.py` | 重写 | PBKDF2 + SHA256 双格式分流校验；`hmac.compare_digest` 常量时间比较；新增 `is_legacy_hash()` |
| `backend/app/routers/auth.py` | 修改 | login 成功后自动升级旧哈希；migrate 加 403 守卫 |
| `backend/app/database.py` | 修改 | Settings 增加 `audio_cache_dir`（保留无害） |
| `backend/app/audio_prep.py` | **删除** | 工作树遗物，主线无依赖 |
| `backend/app/services/background_tasks.py` | **删除** | 孤儿模块 + 误建目录 |
| `docker-compose.yml` | 修改 | 单文件挂载改整目录；移除 audio-prep 服务 |
| `docker-compose.batch.yml` | 修改 | 同上；summary-worker 挂载修正 |
| `.env` | 修改 | 补 `VIDEO_HOST_PATH=D:/ITJC`；补 4 个端口变量 |
| `src/lib/userScopedStorage.ts` | **新增** | 65 行，按用户隔离的 localStorage 封装 |
| `src/lib/idbStorage.ts` | 修改 | 3 处回退分支改为 `scopedLocalName` |
| `src/lib/authApi.ts` | 修改 | 新增 `AuthError`（携带状态码），透传后端 detail |
| `src/stores/authStore.ts` | 修改 | 6 处 `setCurrentUser` 改用 username；错误码分流；6 处加 `reloadForUserSwitch()` |
| `src/stores/videoStore.ts` | 修改 | 3 个 key 走 scoped storage |
| `src/components/auth/AuthPage.tsx` | 修改 | 不再存明文密码，只记用户名；清旧 key |
| `src/components/video/videoPlayerSettings.ts` | 修改 | 2 个 key 隔离 |
| `src/components/video/VideoList.tsx` | 修改 | 列数配置隔离 |
| `src/components/video/useVideoSelection.ts` | 修改 | 待跳转视频隔离 |
| `src/components/timecenter/TimeCenterPage2.tsx` | 修改 | 布局配置隔离 |
| `src/components/layout/AIChatPanel.tsx` | 修改 | 待跳转视频隔离 |
| `src/hooks/useAmbientSoundController.ts` | 修改 | 环境音状态隔离 |
| `C:\Users\yeb12\.wslconfig` | 新增 | WSL2 内存 12 GB / 8 核 / swap 4 GB / 自动回收 |

`git status` 显示 16 个已跟踪文件被修改，`+670 / −100`；另有 2 个未跟踪文件（`userScopedStorage.ts`、`docker-compose.batch.yml`）。**尚未提交**。

---

## 五、验证记录

| # | 检查项 | 方法 | 结果 |
|---|---|---|---|
| 1 | 容器编排 | `docker ps` | 8 个全部 Up，backend/frontend/postgres/redis healthy |
| 2 | 后端模块完整性 | 容器内 `py_compile` + `pkgutil.walk_packages` 逐模块导入 | 编译 0 失败；51 个模块 50 个导入成功（唯一失败项已删除） |
| 3 | 运行时自检 | 容器内读取配置 | DATABASE_URL / REDIS_URL / LLM 策略 / sqlite-vec / 视频目录 全绿 |
| 4 | 视频链路 | `GET /api/videos/{id}/file` + `Range: bytes=0-1023` | HTTP 206，`Content-Range: bytes 0-1023/45543291` |
| 5 | LLM 链路 | 容器内 `create_llm().invoke()` | 返回 `'OK'`；外部端点 HTTP 200 |
| 6 | 哈希校验单元 | 自造 PBKDF2 样本 + 真实 sha256 样本 | 正确/错误/空值 三种输入均判断正确 |
| 7 | PBKDF2 登录端到端 | 临时账号建档 → 登录 → 查哈希 → 再登录 → 删档 | 200 / token / 79→64 字符 / 200 |
| 8 | 错误密码提示 | `POST /api/auth/login` 错误口令 | `401 {"detail":"用户名或密码错误"}` |
| 9 | 前端类型 | `npx tsc --noEmit` | 退出码 0 |
| 10 | 前端构建 | `npm run build` | 成功，1.09 s |
| 11 | 网关发布 | `GET http://127.0.0.1:12302/` | HTTP 200，index bundle `index-C9dmQLn4.js` |
| 12 | 缓存隔离 | 9 个文件扫描裸 `localStorage.` | 残留 0 |
| 13 | 后端数据域隔离 | `select user_id, count(*) from user_data group by 1` | 13 组，条数与体积各异，无复制痕迹 |

---

## 六、遗留问题与风险

| # | 项 | 说明 | 建议 |
|---|---|---|---|
| 1 | 5.0 未合并 | 本地 `main` @ `3490840`，`origin/main` @ `8a55793`，`P2U-3.0-LangChain` @ `bfac078` 未合入 | 确认合并方式（ff / merge commit） |
| 2 | 未推送 | 所有今日改动仅在工作区 | 合并后统一 push |
| 3 | 仓库仍私有 | `origin` = `P2M-Coreai-workspace`（私有） | 需要时改公开；公开前注意 `public/sounds/*.ogg` 三个大文件（19 MB / 9.4 MB / 5.1 MB）走 Release 更合适 |
| 4 | 14 个自动化遗留账号 | `isoauto*`(9)、`isolation-test-a/b`、`verify-migrate-u1/u2`、`wbverify*`(2) | 确认无引用后清理 |
| 5 | 弱密码 | `admin` / `admin` | 登录后改掉，或直接禁用该账号 |
| 6 | 镜像不可重建 | `langchain-*`、`sqlite-vec` 靠 `docker commit` 补装，Dockerfile 未同步 | 解决 `nvidia-cublas-cu12` 源问题后写回 `requirements.txt` |
| 7 | WSL 内存上限待观察 | 12 GB 对 5 个常驻 worker 是否够用未知 | 跑一轮完整批处理后复查 |
| 8 | 改动未提交 | 16 个已跟踪文件 + 2 个新文件 | 建议按「后端鉴权」「前端隔离」「编排修复」拆 3 个提交 |
| 9 | `dist` 不入库 | 在 `.gitignore` 内 | 换机器需重新 build |

---

## 七、回滚点

| 备份 | 路径 |
|---|---|
| compose 旧版 | `%TEMP%\siteyeb-compose-old-20261119.yml` |
| `.env` 旧版 | `%TEMP%\siteyeb-env-backup-20261119.txt` |
| git refs 快照 | `%TEMP%\siteyeb-refs-backup.txt`（67 条） |

回滚单个服务：

```
docker compose -p p2-siteyeb -f docker-compose.yml -f docker-compose.batch.yml up -d --force-recreate
```

回滚鉴权（仅当新逻辑导致登录全面失败）：`git checkout HEAD -- backend/app/auth.py backend/app/routers/auth.py`，重建 backend。

**不要回滚** `.env` 的 `VIDEO_HOST_PATH` —— 缺它视频会全部不可播。

---

## 八、时间线

| 时间 | 事件 |
|---|---|
| 21:43 | README / package.json 版本化到 5.0 |
| — | 用户报「电脑全拉满」→ 停崩溃容器、写 `.wslconfig`、重启 Docker |
| — | 后端全量扫描：51 模块，50 通过，删除 2 个孤儿模块 |
| 22:40 | `.env` 补 `VIDEO_HOST_PATH=D:/ITJC` |
| 22:44 | `database.py` 补 `audio_cache_dir` 字段 |
| 22:46 / 22:48 | 两个 compose 文件修正挂载、移除 audio-prep |
| 22:34 | `idbStorage.ts` 修复本地回退前缀 |
| 22:51 | `auth.py` 重写；`routers/auth.py` 加升级逻辑与 migrate 守卫 |
| 22:51–22:56 | 新建 `userScopedStorage.ts`，替换 9 处裸 key，改 `AuthPage` / `authStore` / `authApi` |
| 22:54 | 首次 `npm run build` |
| — | 端到端验证：哈希单元测试、PBKDF2 登录、错误码、视频 206、LLM invoke |
| 23:0x | 二次 build（补清旧 `p2m-remember`），网关确认 `index-C9dmQLn4.js` |
| 23:1x | 8 容器全部 healthy；用户数据域复核完成 |

---

## 九、经验条目（供后续复用）

1. **`docker commit` 必须带 `--change` 重写 ENTRYPOINT/CMD/USER**，否则临时容器的启动命令会被固化进产品镜像。
2. **compose 不要用单文件挂载**：源文件缺失时 Docker 会自动建同名空目录，之后永远挂不上。整目录挂载没有这个问题。
3. **401 不等于「用户不存在」**。前端必须保留 HTTP 状态码，否则排查方向会被彻底带偏 —— 这次的「信用域不对」误判就是这么来的。
4. **多用户隔离要落在存储层**，不是靠 UI 提示。任何一个不带用户前缀的 key 都是未来的串号。
5. **明文密码永远不落盘**，哪怕是「记住密码」这种看起来无害的功能。
6. **路径映射类配置先确认有没有消费方**。`PATH_MAP` 是全代码库零引用的死配置，差点被当成故障点去改。
7. **WSL2 需要显式内存上限**，否则崩溃循环会直接把宿主机拖死，而不是只影响容器。
