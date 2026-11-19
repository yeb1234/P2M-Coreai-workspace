# 项目重构踩坑报告

> 状态：历史参考（最后校对 2026-11-16）

## 背景

AI 任务中心模块负责视频的批量转录（Whisper）、字幕校对（LLM）和智能总结（LLM）。重构前逻辑全部堆在 `VideoPage.tsx`（834 行），存在多个隐蔽 bug 和架构问题。后续全项目扫描又发现并修复了 7 个额外问题。

### 与现状差异（2026-11-16 校对）

本篇是重构期（早期 SQLite 版本）的过程记录，正文描述当时的代码位置、表结构和踩坑过程，保持原样；下列条目已与 2026-11-16 现状不同，引用时不要当成现行实现。

- **主库**：报告成稿时为 SQLite；2026-11-15 起已迁到 PostgreSQL 17 + pgvector，Redis 仅作 RQ 队列存储。踩坑 3（SQLite 并发写入）随迁移成为历史。
- **队列代码位置**：现队列工厂在 `app/services/rq_client.py`（`ai_jobs_queue` / `background_queue`），后台任务在 `app/services/background_tasks.py`；报告文件清单引用的 `services/ai_jobs.py`、`routers/ai_jobs.py`、`routers/videos.py` 仍存在。
- **任务状态机**：报告五态 `queued / running / completed / failed / cancelled`；现多一个 `cancelling` 取消中态。
- **AiJob 字段**：报告未列表结构；现模型无 `job_type`，转写由 `whisper_engine / whisper_model / language / do_summary` 等字段驱动（见 `app/models.py`）。
- **文件清单核对**：报告两处文件清单用的就是仓库根 `src/...`、`backend/app/...` 路径；除 `todoStore.ts` 外，清单引用的文件抽样核实仍存在。
- **`todoStore`**：踩坑 14 与第二轮清单引用的 `src/stores/todoStore.ts` 已于 2026-11 并入 `scheduleStore` 后移除。
- **仍成立**：RQ 两队列 `ai_jobs` / `background` 的分工；worker 为 RQ `SimpleWorker` 消费这两个队列；单任务进度在 DB 行上推进、列表接口触发自愈的大方向未变。

---

## 踩坑 1：双轮询循环互相打架

**现象**：任务状态偶尔闪烁、进度回退、完成后数据不刷新。

**原因**：存在两个独立的轮询机制：
- `videoStore.pollJob()` — 用 `setTimeout` 递归轮询当前视频的单个 job
- `VideoPage` 的 `useEffect` — 用 `setInterval` 每 2 秒刷新整个 job 列表

两个循环同时调 `fetchVideo()` 更新 `currentVideo`，后返回的覆盖先返回的，导致状态回退。

**修复**：删除 `videoStore.pollJob()`，统一由 `useAiJobCenter` hook 中的单个 `setInterval` 管理，同时刷新 job 列表和当前视频。

---

## 踩坑 2：subtitle_correction_enabled 硬编码关闭

**现象**：即使用户在设置中开启了字幕校对，手动触发 AI 时校对永远不生效。

**原因**：`VideoPage.tsx` 第 139 行：
```ts
const aiJobOptions = useMemo(() => ({
  // ...
  subtitle_correction_enabled: false,   // ← 硬编码
  subtitle_correction_scope: 'off',     // ← 硬编码
}), [...]);
```
`transcriptionStore` 的 `subtitleCorrectionEnabled` 设置被完全忽略。

**修复**：`useAiJobCenter` 的 `baseOptions` 不再包含 correction 字段，各场景（手动、批量、校对）分别按需覆盖。

---

## 踩坑 3：create_ai_job 自开 session 导致 SQLite 并发写入

**现象**：批量入队时偶发 `database is locked` 错误。

**原因**：`create_ai_job()` 内部调 `SessionLocal()` 创建新 session，而 router 已经通过 `Depends(get_db)` 持有一个 session。两个 session 同时写入 SQLite，WAL 模式下仍可能冲突。

**修复**：`create_ai_job` 改为接收 `db` 参数，复用 router 的 session。

---

## 踩坑 4：11 个 callback 各自重复 try/finally

**现象**：代码膨胀、维护困难，修改一个 loading 逻辑要改 11 处。

**原因**：每个操作（取消、恢复、清除、同步等）都独立写了：
```ts
const xxx = useCallback(async () => {
  setAiJobsLoading(true);
  try {
    await someApi();
    await loadAiJobs();
    if (currentVideoId) await loadCurrentVideo(currentVideoId);
  } finally {
    setAiJobsLoading(false);
  }
}, [deps...]);
```

**修复**：提取 `withLoading()` 包装函数，所有操作统一用 `withLoading(async () => { ... })` 调用。

---

## 踩坑 5：refreshAiJobs 每次调 recoverStuckAiJobs

**现象**：点刷新按钮时响应慢，且会把正在正常运行的任务误判为卡住。

**原因**：`refreshAiJobs()` 内部先调 `recoverStuckAiJobs(60, 15, false)`，这个操作应该只在管理员明确需要时执行，不应该每次刷新都触发。

**修复**：`refreshAiJobs` 不再调用 `recoverStuckAiJobs`，只做纯粹的数据刷新。

---

## 踩坑 6：4 个 useMemo 创建相似 options 对象

**现象**：新增一个参数要改 4 处，容易遗漏。

**原因**：`VideoPage` 中有 `aiJobOptions`、`batchAiJobOptions`、`manualAiJobOptions`、`correctionAiJobOptions` 四个 `useMemo`，依赖列表各不相同但内容高度重叠。

**修复**：`useAiJobCenter` 中只保留一个 `baseOptions`（不含 correction），各场景按需扩展：
```ts
const manualOptions = { ...baseOptions, subtitle_correction_enabled: false, subtitle_correction_scope: 'off' };
const batchOptions = { ...baseOptions, subtitle_correction_enabled: batchCorrectionEnabled, ... };
const correctionOptions = { ...baseOptions, whisper_model: 'large-v3', subtitle_correction_enabled: true, ... };
```

---

## 踩坑 7：VideoPage 从 834 行缩减到 ~400 行的关键

**方法**：将所有 AI job 相关的状态（10 个 useState）、回调（11 个 useCallback）、effect（3 个 useEffect）、计算（2 个 useMemo）全部提取到 `useAiJobCenter` hook。

**收益**：
- VideoPage 只关心视频播放
- useAiJobCenter 只关心任务管理
- VideoAiJobCenter 是纯展示组件，通过 props 接收一切

---

## 重构前后对比

| 指标 | 重构前 | 重构后 |
|------|--------|--------|
| VideoPage.tsx 行数 | 834 | ~400 |
| 轮询循环 | 2 个独立循环 | 1 个统一循环 |
| AI job 相关 useState | 10 个 | 0（全部在 hook） |
| AI job 相关 useCallback | 11 个 | 0（全部在 hook） |
| loading 状态管理 | 11 处 try/finally | 1 个 withLoading |
| subtitle_correction 生效 | 不生效 | 正确读取设置 |
| SQLite 并发冲突 | 偶发 | 消除 |

---

## 涉及文件清单

| 文件 | 操作 |
|------|------|
| `src/hooks/useAiJobCenter.ts` | 新建 |
| `src/components/video/VideoPage.tsx` | 重写 |
| `src/stores/videoStore.ts` | 删除 pollJob，简化 triggerAi |
| `backend/app/services/ai_jobs.py` | create_ai_job 接受 db 参数 |
| `backend/app/routers/ai_jobs.py` | 传 db |
| `backend/app/routers/videos.py` | 传 db |
| `src/components/video/VideoPlaylistPanel.tsx` | "重生成" → "重新生成" |

## 验证结果

- TypeScript 编译：通过
- 37/37 单元测试：通过
- 后端 API：正常响应

---

# 第二轮全项目扫描修复

## 踩坑 8：SSE 流式读取无 unmount 守卫

**现象**：用户在 AI 回复过程中切换页面，控制台报 `setState on unmounted component` 警告，极端情况下内存泄漏。

**原因**：`AIChatPanel.tsx` 和 `SettingsPage.tsx` 的 `handleTestAI` 中，`while (true)` 循环读取 SSE 流时没有检查组件是否已卸载。即使组件卸载，`reader.read()` 仍在等待，回调继续执行 `setState`。

**修复**：添加 `unmountedRef` / `mountedRef`，在 `useEffect` cleanup 中设为 `true`，流读取循环每次迭代检查该标志，卸载时调 `reader.cancel()` 立即中断。

---

## 踩坑 9：CalendarGrid eventsByDate 每次渲染重建

**现象**：日历月视图在快速切换月份时有明显卡顿。

**原因**：`CalendarGrid.tsx` 中 `eventsByDate` 对象在每次渲染时都重新创建和填充，即使 `rawEvents` 和 `completedTodoSet` 没有变化。由于 `rawEvents` 来自 `getEventsForMonth()` 调用（每次返回新数组引用），下游的 `DayCell` 组件全部触发不必要的重渲染。

**修复**：将 `eventsByDate` 的构建逻辑包裹在 `useMemo` 中，依赖 `[rawEvents, completedTodoSet]`。

---

## 踩坑 10：拖拽调整宽度逻辑重复 3 处

**现象**：3 个文件各自实现了几乎相同的面板宽度拖拽调整逻辑，共计 ~120 行重复代码。

**原因**：
- `usePlaylistResize.ts` — 独立 hook
- `AIChatPanel.tsx` — 内联 useEffect + 3 个 ref
- `Sidebar.tsx` — 内联 handleResizeStart 回调

三者的核心逻辑完全相同：mousedown 记录起始位置 → mousemove 计算新宽度（requestAnimationFrame 节流）→ mouseup 固化宽度并清理事件。唯一区别是 resize 方向（左边缘 vs 右边缘）和 min/max 宽度。

**修复**：提取通用 `useDragResize` hook（`src/hooks/useDragResize.ts`），接受 `{ initialWidth, minWidth, maxWidth, side, onWidthChange }` 配置。三个调用方改为薄包装。

---

## 踩坑 11：SettingsPage.tsx 1400+ 行巨型文件

**现象**：修改转写设置相关代码时需要在 1400 行文件中定位目标，IDE 跳转和 code review 效率低。

**原因**：9 个设置子组件（PomodoroSettings、ProfileSettings、AISettings、TranscriptionSettings 等）全部堆在一个文件中。其中 TranscriptionSettings 本身就有 ~500 行，AISettings ~250 行。

**修复**：
- 提取 `settings/types.ts` — 共享类型和工具函数
- 提取 `settings/AISettingsSection.tsx` — AI 设置组件
- 提取 `settings/TranscriptionSettingsSection.tsx` — 转写设置组件
- SettingsPage.tsx 从 1400 行缩减到 ~750 行

---

## 踩坑 12：NotesPage 5 个 useState 管理同一张表单

**现象**：编辑笔记时 5 个独立状态需要同步更新，`startEdit` 函数需要调 5 个 setter。

**原因**：`editingId`、`editTitle`、`editContent`、`editColor`、`editTag` 各自独立为 `useState`，但它们共同构成一个编辑表单的状态。

**修复**：合并为单个 `edit` 对象 `{ id, title, content, color, tag }`，用一个 `setEdit` + 函数式更新管理。

---

## 踩坑 13：TodoList.tsx 中 InlineAddInput 内联定义

**现象**：TodoList.tsx 有 ~425 行，其中 InlineAddInput 组件占了 75 行，增加了文件复杂度。

**原因**：InlineAddInput 是一个独立功能组件（快捷键解析、自动聚焦、提交逻辑），但被定义在 TodoList.tsx 内部，无法被其他组件复用。

**修复**：提取到 `src/components/todo/InlineAddInput.tsx`，TodoList 改为 import。

---

## 踩坑 14：todoStore undo/redo 重复栈操作模式

**现象**：`undo()` 和 `redo()` 函数各 ~40 行，结构高度对称但各自独立声明 `undoStack`/`redoStack` 的 push 和 slice 操作。

**原因**：undo 需要从 undoStack 弹出 → 压入 redoStack，redo 反之。每种 action type（create/delete/restore）都需要重复这个模式。

**修复**：提取 `pushRedo` / `pushUndo` 展开对象，每个 action type 的 `set()` 调用直接 `...pushRedo` 或 `...pushUndo`，消除重复的栈操作声明。

---

## 第二轮修复涉及文件清单

| 文件 | 操作 |
|------|------|
| `src/components/layout/AIChatPanel.tsx` | unmount 守卫 + useDragResize 替换 |
| `src/components/settings/SettingsPage.tsx` | 拆分为 4 个文件 |
| `src/components/settings/types.ts` | 新建 |
| `src/components/settings/AISettingsSection.tsx` | 新建 |
| `src/components/settings/TranscriptionSettingsSection.tsx` | 新建 |
| `src/components/calendar/CalendarGrid.tsx` | eventsByDate useMemo |
| `src/components/layout/Sidebar.tsx` | useDragResize 替换 |
| `src/components/video/usePlaylistResize.ts` | useDragResize 替换 |
| `src/hooks/useDragResize.ts` | 新建通用 hook |
| `src/components/notes/NotesPage.tsx` | edit state 合并 |
| `src/components/todo/TodoList.tsx` | InlineAddInput 提取 |
| `src/components/todo/InlineAddInput.tsx` | 新建 |
| `src/stores/todoStore.ts` | undo/redo 精简 |
