# 主题 CSS / JSON 导入导出说明

> 状态：现行（最后校对 2026-11-16）。涉及文件、解析函数、五个深色主题 ID 与 `src/lib/themes.ts` 当前实现一致。

SiteYeb 的主题只允许通过一组 CSS 变量控制。运行时通用类（例如 `theme-card`、`theme-surface`）和深色兜底层放在 `src/index.css`，不会再混入导出的主题文件。

## 两种导出格式

### CSS 样式

设置页点击“导出 CSS 样式”会生成一个 `.css` 文件，适合手工编辑。

文件结构：

```css
/*
  P2M 主题样式：warm-wood
  分组：主题风格
  名称：暖木经典
  说明：温暖木质纹理，经典风格。
  预览：页面 #f7f5f2 / 卡片 #ffffff / 强调 #c87d2f / 主文字 #1a1a1a / 边框 #e5e2dd
*/

:root {
  --bg-body: #e8e4df;
  --bg-base: #f7f5f2;
  --bg-card: #ffffff;
  --text-primary: #1a1a1a;
  --accent: #c87d2f;
}
```

导入 CSS 时，解析器会读取所有 `--变量名: 值;` 形式的主题变量。至少需要包含这些核心变量，才会被当成主题：

- `--bg-body`
- `--bg-base`
- `--bg-card`
- `--text-primary`
- `--accent`

其他变量可以缺省，系统会用默认主题补齐。导入后的主题会作为 `custom` 主题应用，不会带入导出文件中的注释、分组、名称和排查提示。

### JSON 包

设置页点击“导出 JSON 包”会生成一个 `.json` 文件，适合备份、迁移和后续版本兼容。

结构：

```json
{
  "kind": "p2m-theme",
  "version": 1,
  "group": "主题风格",
  "themeId": "warm-wood",
  "name": "暖木经典",
  "description": "温暖木质纹理，经典风格。",
  "vars": {
    "--bg-body": "#e8e4df",
    "--bg-base": "#f7f5f2",
    "--bg-card": "#ffffff",
    "--text-primary": "#1a1a1a",
    "--accent": "#c87d2f"
  }
}
```

JSON 导入要求 `vars` 是完整主题变量集合。普通 CSS 片段不会被误识别成 JSON 主题。`kind/version/themeId/name/description/group` 是元信息，当前导入只使用 `vars`。

## 深色主题规则

深色主题目前包括：

- `night`：曜石暖橙
- `claude-ink`：墨陶深棕
- `primer-dark`：Primer 暗幕
- `antigravity-dark`：反重力紫夜
- `blue-night`：深夜蓝

深色主题必须满足这些可用性规则：

- `--bg-body`、`--bg-base`、`--bg-card`、`--bg-elevated` 必须是 4 个不同层级，避免整页糊成一块黑。
- `--text-primary` 不使用纯白 `#ffffff`，降低暗色页面刺眼感。
- `--accent-bg` 必须和 `--bg-card` 区分，选中态不能看不出来。
- 旧页面里写死的浅色 Tailwind 类由 `src/index.css` 末尾的深色兜底层处理；新代码仍应优先用变量或 `theme-card/theme-surface`，不要依赖兜底。

## 测试规则

- `src/__tests__/themeImportExport.test.ts` 验证 CSS 导出可回导、JSON 包可解析、缺省 CSS 变量可补齐、普通 CSS 不会误导入。
- `tests/contracts/regressionContracts.test.ts` 验证深色主题有明确表面层级。
- Playwright 暗色截图测试必须同时设置 `data-theme` 和写入对应主题变量。只设置 `data-theme="primer-dark"` 不够，因为 CSS 变量不会自动变化。

## 维护原则

- 新增主题变量时，同步更新 `ThemeVars`、`THEME_VAR_COMMENTS`、默认主题和测试。
- 运行时类只写在 `src/index.css`，不要放进 `generateThemeCss()`。
- 导入解析只维护在 `parseThemeVarsText()`，页面组件不要再复制正则。
- 导出的 CSS 用于“编辑变量”，不是用于复制整套应用样式。
- 深色主题继续逐步清理硬编码浅色类，最终目标是减少 `[class*="..."]` 兜底。
- 修改深色主题后，必须跑单元契约测试，并用 Playwright 重新看暗色设置页截图。

## 相关文件

- `src/lib/themes.ts`：主题变量、导入解析、CSS 导出。
- `src/components/settings/AppearanceSettings.tsx`：设置页导入/导出入口。
- `src/index.css`：运行时主题工具类和深色兜底。
- `src/__tests__/themeImportExport.test.ts`：CSS/JSON 导入导出测试。
- `tests/contracts/regressionContracts.test.ts`：深色主题层级契约。
- `tests/e2e/layout.spec.ts`：Playwright 暗色截图回归。
