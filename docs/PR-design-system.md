# 颜色系统重构 + 主题收敛

> 状态：历史 PR 记录（分支 `refactor/design-system` 时期）。2026-11-16 复核：颜色变量化方案仍为现行；遗留项状态见文末更新。

## 背景

上一版加了「学术纸感」主题，但切过去只有底色变了，彩色块（待办统计的橙/蓝/绿、番茄钟色块）纹丝不动 —— 项目里有 **416 处硬编码颜色**，CSS 变量主题管不到。

观感是「换了一半」。

## 做了什么

### 1. 颜色变量化：416 → 60

按「前缀 + 色值」建映射表，因为同一色值在不同语境下语义不同（`#1a1a1a` 当文字是主色，当背景是深色块）。

**第一批 1260 处（61 个文件）—— 基础色**

| 硬编码 | 替换为 |
|---|---|
| `bg-[#faf9f7]` | `bg-[var(--bg-elevated)]` |
| `bg-[#f3f2ef]` | `bg-[var(--bg-base)]` |
| `bg-[#fef7ed]` | `bg-[var(--bg-accent)]` |
| `text-[#1a1a1a]` | `text-[var(--text-primary)]` |
| `text-[#6b7280]` | `text-[var(--text-secondary)]` |
| `text-[#9ca3af]` | `text-[var(--text-muted)]` |
| `border-[#e5e2dd]` | `border-[var(--border-light)]` |

**第二批 180 处 —— 状态色**，同时补了 8 个新变量：

```css
--warn / --warn-bg / --warn-border
--info / --info-bg / --info-border
--success-bg / --danger-bg
```

### 2. 保留的部分

分类色（紫 `#8b5cf6` / 青 `#06b6d4` / 粉 `#ec4899`）**没动**。

它们是功能区分（不同模块的标识色），不是主题色。跟着主题变反而乱。笔记便签的黄/蓝/粉同理 —— 用户选「黄色便签」就是那个黄。

剩余约 60 处，全部是这类功能色。

### 3. 删掉自定义主题导入

按要求「不要自定义加载，固定那几个颜色」：

- 移除 `handleImportTheme`
- 移除「导入主题」按钮和隐藏 input
- 移除 `importRef` / `importStatus` / `parseThemeVarsText` 引用

**保留** 预设主题和导出功能（导出给用户备份用，不影响加载）。PR 时期为 16 个；现行 `THEME_PRESETS`（`src/lib/themes.ts`）为 14 个。

## 验证

**默认主题**：截图对比前后完全一致 —— 映射到的变量值正好等于原色值，视觉零变化。

**学术纸感主题**：
- 待办统计卡的橙/蓝/绿背景 → 变成米白
- 番茄钟色块 → 跟着变
- 从「换了一半」变成「换了一大半」

**四个页面（工作台/轨迹/待办/笔记/设置）无 JS 错误。**

## 怎么验证

```bash
git checkout refactor/design-system
docker compose up -d --build
# 浏览器打开 http://localhost，登录 demo / Demo2026
# 设置 → 外观 → 切到「学术纸感」
```

对比切换前后的截图：
- `test-results/vars-home.png`（默认主题）
- `test-results/vars-scholar-home.png`（学术纸感）
- `test-results/vars-journey.png` / `vars-scholar-journey.png`

## 遗留

**分类色没变量化**。如果以后要「一键换掉所有彩色」，需要给每个分类色也建语义变量（`--tag-purple` 之类）。现在不做，因为分类色的语义是「区分模块」，不是「跟随主题」。

**`todoStore` 遗留（2026-11-16 复核：已清理）**：周历/统计改用 `scheduleStore` 后，`useTodoStore` 与 `src/stores/todoStore.ts` 已删除；`p2m-todo-storage` 旧键仍列在 `src/components/settings/types.ts` 的 `STORAGE_KEYS` 清理清单里，等待老浏览器本地数据清掉。
