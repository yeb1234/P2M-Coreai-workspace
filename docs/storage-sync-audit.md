# 跨设备 / 多用户存储审计

时间：2026-11-16 03:10 – 07:00
范围：所有前端本地存储与后端持久化的读写链路

---

## 一、结论先行

**跨设备基本是通的**，但过程中查出**一个真 bug** 和**一个设计分裂**。

| | 状态 |
|---|---|
| 服务端表数据（待办/日历/路径/记忆） | ✓ 天然跨设备，有 user_id |
| IndexedDB + user_data 双写（番茄钟/笔记/UI/转写） | ✓ 通，但有个读取缺陷（已修） |
| **`getItem` 后端返回 null 时不回读本地** | **✗ 真 bug，已修** |
| **`todoStore` 与 `scheduleStore` 双轨** | **⚠️ 设计分裂，数据不互通** |

---

## 二、存储矩阵（实测）

### 服务端表（走后端，刷新/换设备自动同步）

| 数据 | 表 | 谁在用 | 隔离 |
|---|---|---|---|
| 待办 | `schedule_items` | **待办页**（TodoList） | ✓ user_id |
| 日历 | `calendar_events` | 日历页 | ✓ user_id |
| 学习路径/目标 | `learning_paths` / `learning_goals` | 学习路径页 | ✓ user_id |
| 记忆 | `memory_items` | 设置页 + Agent | ✓ user_id |
| 观看记录 | `watch_events` / `watch_history` | 画像、轨迹 | ✓ user_id |

**这类数据跨设备从来不是问题** —— 页面加载时调 `loadItems()` 直接从后端拉。

### IndexedDB + user_data 双写（先写后端，失败兜底本地）

| 数据 | persist key | 后端同步 | 本地 key 前缀 |
|---|---|---|---|
| UI 偏好（主题/导航顺序） | `p2m-ui-storage` | ✓ | `u{uid}:` |
| 番茄钟 | `p2m-pomodoro-storage` | ✓ | `u{uid}:` |
| 笔记便签 | `p2m-notes-storage` | ✓（本次新增） | `u{uid}:` |
| 转写设置 | `p2m-transcription-storage` | ✓ | `u{uid}:` |
| 插件配置 | `p2m-plugin-storage` | ✓ | `u{uid}:` |
| 通知 | `p2m-notification-storage` | ✓ | `u{uid}:` |
| 时间中心 | `p2m-time-center-storage` | ✓ | `u{uid}:` |
| AI 配置 | `p2m-ai-storage` | ✓ | `u{uid}:` |

**这套设计其实做得不错**：`idbStorage` 的 `doWrite` 会优先 `setUserData`，失败才落本地；`idbKey()` 加了 `u{uid}:` 前缀做多用户隔离。

---

## 三、修的那个真 bug

### 现象

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

**番茄钟「换设备折腾好久」就是这条路径。**

### 修复

```typescript
if (hasAuthToken()) {
  const result = await getUserData(name);
  if (result !== null && result !== undefined) return result;   // 云端优先
  // 云端没有 → 继续往下走本地兜底
}
const row = await db.kv.get(idbKey(name));   // 本地兜底
```

优先级变成：**云端 > 本地 > null（用默认值）**。

配套加了 `bootstrapLocalToRemote()`：登录后把本地有、云端没有的 store 推上去。这样老用户升级上来的本地数据不会白丢。

### 顺带确认的

`App.tsx` 本来就有 `useRehydrateStores(currentUser)`，登录后（登录会整页 reload）会重载 8 个 persist store。这条链路是好的，我一开始以为缺了，白查了一阵。

---

## 四、设计分裂：两套待办

这是这次审计**最有价值的发现**。

```
待办页（TodoList）        → useScheduleStore  → /api/schedule-items  → 后端表
日历2 / 统计页 / 隐私设置  → useTodoStore      → IndexedDB p2m-todo-storage
```

**两套数据结构不同、存储位置不同、互不互通。**

后果：

1. **日历2 页看到的待办，和待办页看到的不是一回事**
2. **统计页的待办计数** 用 `todoStore`，而用户实际操作的是 `scheduleStore`，数字对不上
3. **隐私设置里"清空待办数据"** 清的是 `todoStore`，用户的真实待办（`schedule_items`）没被清

我一开始也被这个骗了：往 `p2m-todo-storage` 写数据测跨设备，发现页面不显示，以为是同步 bug，查了很久才发现**页面根本不读这个 key**。

**建议**：统一到 `scheduleStore`（后端表那套）。`todoStore` 作为历史遗留逐步下线：
- `Calendar2Page` 的 `todos` 改成从 `scheduleStore` 派生
- `StatsPage` 同理
- `PrivacyDataSettings` 的"清空待办"改成调后端接口
- 最后删掉 `todoStore` 和 `p2m-todo-storage`

这件事**我没有直接做**，因为涉及三个页面的数据来源改造，改错了用户会看到待办消失。需要你确认后再动。

---

## 五、其他发现

### 1. 无主会话越权（已在上一轮修复）

93 个会话里 87 个 `user_id` 为空，代码短路放行。已把数据归给 admin，代码收紧为「无主会话只有 admin 可读」。

### 2. 登录后整页 reload

`authStore.login` 里 `window.location.reload()`，注释写着「9 个 store 的内存状态都是上一个账号的，只换 authStore 字段会留下一大堆脏数据」。

**这个选择是对的** —— 在多 store 场景下，整页重载比逐个 reset 更可靠。代价是登录慢 1-2 秒。

### 3. 401 会清 session

`authFetch` 收到 401 就 `clearSession()`。如果 8 个 store 并发 rehydrate 时有任何一个 401，会连锁清掉 session。

**目前没触发**（因为 rehydrate 时 cookie 已就绪），但这是个隐患。建议：401 清 session 前判断是不是 `/api/auth/me` 这种探测性请求。

### 4. 临时诊断代码已清理

排查过程中加过 `window.__p2mDebug` 和几个 `console.log`，已全部删除。

---

## 六、验证脚本

| 脚本 | 用途 |
|---|---|
| `scripts/test_cross_device.py`-ish（js） | 模拟新设备登录，验证 indexDB / user_data 的读写 |
| `scripts/test_multi_user.py` | 两个账号交叉验证隔离，25 项 |

跨设备脚本目前在 `scripts/test-cross-device2.cjs`、`scripts/diag-*.cjs`，属于一次性排查用，建议整理成一个正式的 `test-storage-sync.cjs` 后删掉临时的。

---

## 七、待你决策

**要不要统一两套待办？**

- 统一：三个页面要改数据来源，改完用户看到的数据才一致
- 不统一：`Calendar2`/`Stats`/`隐私清空` 三个地方会一直对不上

我倾向前者，但需要你点头 —— 这个改动会动到用户能直接感知的页面。
