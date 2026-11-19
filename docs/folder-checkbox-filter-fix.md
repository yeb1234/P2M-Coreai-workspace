# 文件夹勾选筛选 + 播放列表修复报告

> 状态：历史参考（修复已落地，最后校对 2026-11-16）。涉及的 `category_ids` / `category_id` 参数、`selectedFolderIds` 全局状态与六个文件在当前代码中仍存在；文中的视频个数（15、43、100、9、14 等）为当时演示快照，不代表当前库规模。

## 问题 1：勾选文件夹筛选不完整

### 现象
勾选 3 个子文件夹（4+6+5 个视频），应显示 15 个，实际显示不全。

### 原因
前端分页 + 前端过滤 = 数据丢失。后端返回第一页 20 条，前端在这 20 条里筛选，
其他文件夹的视频在后面的页，filter 自然找不到。

### 修复
把筛选逻辑移到后端。`GET /api/videos` 新增 `category_ids` 参数（逗号分隔），
在 SQL 分页之前用 `WHERE category_id IN (...)` 过滤。

```
勾选 day01 (id=4) + day08 (id=9)
→ GET /api/videos?category_ids=4,9
→ 后端展开: 4→[4,5], 9→[9,10]
→ WHERE category_id IN (4,5,9,10)
→ 返回 43 个视频的正确分页
```

---

## 问题 2：播放列表两个模式显示相同数量

### 现象
进入"02、第二章"看到 100 个视频，点播其中一个。右侧播放列表：
- "全部视频"模式：显示 4 个 ❌（应显示 100 个）
- "当前文件夹"模式：显示 4 个 ✅

### 原因
`scope=descendants` 用的是**视频自身的 category_id**（叶子文件夹，无子级），
而不是**用户点击进入的父文件夹**。叶子文件夹没有后代，所以两种模式结果相同。

### 修复
让"全部视频"模式使用**用户浏览上下文**（`currentCategoryId`，即用户点击进入的文件夹）。

#### 后端 (`backend/app/routers/videos.py`)
`GET /api/videos/{video_id}/playlist` 新增 `category_id` 参数：

```python
if scope == "descendants" and category_id:
    # 使用用户浏览的父文件夹
    all_ids = _collect_descendant_ids(db, category_id)
    query = query.filter(Video.category_id.in_(all_ids))
elif video.category_id:
    # 只显示视频自身文件夹
    query = query.filter(Video.category_id == video.category_id)
```

---

## 问题 3：勾选文件夹后播放列表未跟随

### 现象
用户勾选了 2-1 和 2-2（共 9 个视频），播放列表"全部视频"仍显示 65 个（父文件夹全部），
而不是勾选的 9 个。

### 修复
将 `selectedFolderIds` 从 VideoList 的本地 state 提升到 `videoStore`（全局状态）。
`useVideoPlaylist` 读取 store 中的 `selectedFolderIds`：

- **有勾选**：对每个勾选的文件夹分别请求 playlist，合并去重 → "全部视频"= 勾选的视频
- **无勾选**：使用 `currentCategoryId`（用户进入的父文件夹）→ "全部视频"= 父文件夹所有后代

### 涉及文件

| 文件 | 改动 |
|------|------|
| `backend/app/routers/videos.py` | playlist 新增 `category_id` 参数 |
| `src/lib/videoApi.ts` | `fetchPlaylist` 新增 `categoryId` 参数 |
| `src/stores/videoStore.ts` | 新增 `selectedFolderIds` 状态和 setter |
| `src/components/video/VideoList.tsx` | 改用 store 的 `selectedFolderIds` |
| `src/components/video/useVideoPlaylist.ts` | 根据勾选状态决定 playlist 数据源 |
| `src/components/video/VideoPage.tsx` | 传 `currentCategoryId` 给 hook |

### 最终行为

| 场景 | 全部视频 | 当前文件夹 |
|------|----------|------------|
| 未勾选，进入"第二章" | 第二章所有后代（100个） | 视频自身文件夹（15个） |
| 勾选 2-1 + 2-2 | 勾选的视频（9个） | 视频自身文件夹（4或5个） |
| 勾选 2-1 + 2-2 + 2-3 | 勾选的视频（14个） | 视频自身文件夹 |
