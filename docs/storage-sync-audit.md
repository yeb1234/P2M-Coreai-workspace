# 跨设备 / 多用户存储审计

> 状态：部分现行（最后校对 2026-11-16）。审计发现的 `getItem` 云端空值不回读本地的真 bug 已修；
> 待办双轨在**读侧**已收口到 `scheduleStore`，残留项见 §四。下文审计时的会话数、测试项数为当时实测，
> 本次未连库 / 未重跑脚本复核。

---

## 一、结论先行

**跨设备基本是通的**，审计过程中查出过**一个真 bug**（已修）和**一个设计分裂**（读侧已收口，残留见 §四）。

| | 2026-11-16 现状 |
|---|---|
| 服务端表数据（待办/日历/路径/记忆/观看记录） | ✓ 天然跨设备，有 `user_id` |
| IndexedDB + user_data 双写（UI/笔记/通知/插件/时间中心/转写/AI 配置） | ✓ 通；读取优先级云端 > 本地兜底 > 默认值 |
| 番茄钟 | persist 层纯本地，另有独立 `pomodoroSync` 三键同步后端（§二） |
| ~~`getItem` 后端返回 null 时不回读本地~~ | **✗ 真 bug，已修**（§三） |
| ~~`todoStore` 与 `scheduleStore` 双轨~~ | **⚠️ 读侧已收口到 `scheduleStore`；残留遗留键与清空口径见 §四** |

---

## 二、存储矩阵（2026-11-16 核对）

### 服务端表（走后端，刷新/换设备自动同步）

| 数据 | 表 | 谁在用 | 隔离 |
|---|---|---|---|
| 待办 | `schedule_items` | 待办页、日历2、统计页、时间中心、隐私设置概览 | ✓ user_id |
| 日历 | `calendar_events` | 日历页 | ✓ user_id |
| 学习路径/目标 | `learning_paths` / `learning_goals` | 学习路径页 | ✓ user_id |
| 记忆 | `memory_items` | 设置页 + Agent | ✓ user_id |
| 观看记录 | `watch_events` / `watch_history` | 画像、轨迹 | ✓ user_id |

**这类数据跨设备从来不是问题** —— 页面加载时直接从后端拉。`scheduleStore` 本身不做 persist，纯后端来源。

### IndexedDB + user_data 双写（`idbStorage`：先写后端，失败兜底本地）

| 数据 | persist key | 持久化方式 | 本地 key 前缀 |
|---|---|---|---|
| UI 偏好（主题/导航顺序） | `p2m-ui-storage` | `idbStorage` 双写 | `u{uid}:` |
| 笔记便签 | `p2m-notes-storage` | `idbStorage` 双写 | `u{uid}:` |
| 通知 | `p2m-notification-storage` | `idbStorage` 双写 | `u{uid}:` |
| 插件配置 | `p2m-plugin-storage` | `idbStorage` 双写 | `u{uid}:` |
| 时间中心 | `p2m-time-center-storage` | `idbStorage` 双写 | `u{uid}:` |
| 转写设置 | `p2m-transcription-storage` | `idbStorage` 双写 | `u{uid}:` |
| AI 配置 | `p2m-ai-storage` | `idbStorage` 双写（不在 `useRehydrateStores` 列表内） | `u{uid}:` |

`idbStorage.doWrite` 优先 `setUserData`，失败才落本地 IDB；`idbKey()` 加 `u{uid}:` 前缀做多用户隔离
（`idbStorage.ts:61-72,102-105`）。

### 番茄钟：persist 纯本地 + 独立同步通道

| 数据 | persist key | 后端同步 |
|---|---|---|
| 番茄钟（config/timer/sessions） | `p2m-pomodoro-storage` | persist 用 `localOnlyStorage`，不碰后端 API（`pomodoroStore.ts:833-834`）；
另由 `lib/pomodoroSync.ts` 把 runtime / config / history 三个快照键
（`p2m-pomodoro-runtime-v2` / `-config-v2` / `-history-v2`）写后端 `user_data`，按 `updatedAt` 比较新旧合并。 |

> 注意：`idbStorage.ts:49` 的 `IMMEDIATE_LOCAL_STORAGE_NAMES` 里仍列着
> `p2m-pomodoro-storage` / `notification` / `plugin` / `ui`，那是「立即写 vs 防抖写」的区分，
> 不是「纯本地 vs 双写」的区分；纯本地只有 `localOnlyStorage` 一条路径。

---

## 三、修的那个真 bug（已修，现行代码）

### 现象（修复前）

```typescript
getItem: async (name) => {
  if (hasAuthToken()) {
    const result = await getUserData(name);
    return result ?? null;      // ← 后端没数据就返回 null
  }
  // 下面这段本地兜底被跳过了
  const row = await db.kv.get(idbKey(name));
  return row?.value ?? null;
}
```

**登录态下只读云端，云端没有就返回 null，不回读本地。**

### 后果链

```
新设备 / 首次登录
  → 云端还没有这个 store 的数据
  → getItem 返回 null
  → store 用默认值初始化
  → 用户看到「番茄钟配置回到默认」「待办样式变了」
  → 用户随便改一下
  → setItem 把默认值推上云端
  → 真正在旧设备上的数据被覆盖
```

### 修复（现行 `idbStorage.ts:170-180`）

```typescript
if (hasAuthToken()) {
  const result = await getUserData(name);
  if (result !== null && result !== undefined) return result;   // 云端优先
  // 云端没有 → 继续往下走本地兜底
}
const row = await db.kv.get(idbKey(name));   // 本地兜底
```

优先级变成：**云端 > 本地 > null（用默认值）**。

配套 `bootstrapLocalToRemote()`：登录后把本地有、云端没有的 store 推上去，云端已有的不动
（`idbStorage.ts:258-279`；调用顺序在 `App.tsx:49-53`，等 rehydrate 结束再推，避免推默认值）。

### 顺带确认的

`App.tsx` 有 `useRehydrateStores(currentUser)`，登录后（登录整页 reload）重载持久化 store；
当前列表 7 个：ui / pomodoro / plugin / notes / notification / timeCenter / transcription
（`useRehydrateStores.ts:5-11`），`aiStore` 不在其中。

---

## 四、设计分裂：两套待办（读侧已收口，残留两项）

### 审计当时的发现（历史）

```
待办页（TodoList）        → useScheduleStore  → /api/schedule-items  → 后端表
日历2 / 统计页 / 隐私设置  → useTodoStore      → IndexedDB p2m-todo-storage
```

两套数据结构不同、存储位置不同、互不互通：日历2 与待办页看到的不是一回事；统计计数口径对不上；
隐私「清空待办」清的是本地 `todoStore`，真实待办（`schedule_items`）没被清。

### 2026-11-16 现状（代码核对）

- **读侧已全部切到 `scheduleStore`（后端 `schedule_items`）**：
  `TodoList.tsx:3`、`Calendar2Page.tsx:212,218`、`StatsPage.tsx:42`、
  `TimeCenterPage2.tsx:343`、`PrivacyDataSettings.tsx:139`。
- **`todoStore` 代码文件已删除**（`src/stores/` 下无 `todoStore.ts`）。
- **残留 1：遗留 persist 键**。`types.ts:90-91` 的 `STORAGE_KEYS` 里仍列着
  `p2m-todo-storage`、`p2m-calendar-storage`，没有 store 再读它们，只在导出/导入/清空时被遍历到。
- **残留 2：隐私「清空全部」不删后端业务表**。`handleWipeAll` 仍只对 `STORAGE_KEYS` 逐个
  `idbStorage.removeItem`（`PrivacyDataSettings.tsx:23-30`）；后端 `schedule_items`、
  `calendar_events`、`memory_items`、观看记录等业务表不走这个按钮。待办本身的清空在
  `TodoList` 内调 `scheduleStore.clearAllItems()`（后端接口），与隐私设置的全局清空是两条路径。

**建议（未做）**：从 `STORAGE_KEYS` 删掉两个遗留键；全局清空补一轮后端业务表删除接口，
或在界面上把「清本地 KV」和「清后端业务数据」分成两个动作。

---

## 五、其他发现

### 1. 无主会话越权（已在上一轮修复）

审计当时：93 个会话里 87 个 `user_id` 为空，代码短路放行。已把数据归给 admin，代码收紧为
「无主会话只有 admin 可读」（`memory.py:42-50` 归属校验）。当前无主会话数量未核实。

### 2. 登录后整页 reload

`authStore.login` 里 `window.location.reload()`，注释写着「各 store 的内存状态都是上一个账号的，
只换 authStore 字段会留下一大堆脏数据」。

这个选择是对的 —— 在多 store 场景下，整页重载比逐个 reset 更可靠。代价是登录慢 1-2 秒。

### 3. 401 会清 session（隐患，未触发）

`authFetch` 收到 401 就 `clearSession()`。如果多个 store 并发 rehydrate 时有任何一个 401，
会连锁清掉 session。目前 rehydrate 时 cookie 已就绪，未触发；建议 401 清 session 前先判断是不是
`/api/auth/me` 这种探测性请求。该隐患 2026-11-16 仍未改造，代码位置未在本轮复核。

### 4. 临时诊断代码已清理

排查过程中加过的 `window.__p2mDebug` 和临时 `console.log` 已删除；`useRehydrateStores.ts:30`
附近仍有一行注释提到临时诊断，是否还有残留日志未核实。

---

## 六、验证脚本

| 脚本 | 用途 | 2026-11-16 现状 |
|---|---|---|
| `backend/scripts/test_multi_user.py` | 两个账号交叉验证隔离，当时 25 项 | 仍在仓库；当前通过项数未重跑 |
| `scripts/test-cross-device2.cjs`、`scripts/diag-*.cjs` | 一次性排查跨设备读写 | 已不在仓库（当时建议整理成正式 `test-storage-sync.cjs` 后删除，现已按此处理；正式脚本未补） |

---

## 七、待你决策

1. **遗留 persist 键清理**：是否从 `STORAGE_KEYS` 删掉 `p2m-todo-storage` / `p2m-calendar-storage`。
2. **全局清空口径**：隐私设置的「清空全部」是否要补后端业务表删除（待办 / 日历 / 记忆 / 观看记录），
   还是保持「只清本地与 KV」并在界面上写清边界。
