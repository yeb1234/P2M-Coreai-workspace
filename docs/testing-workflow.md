# 灵境项目测试流程指南

本文档记录项目推荐的测试方法与执行流程，覆盖从代码修改到上线前的完整验证链路。

---

## 1. 快速验证（每次代码修改后必做）

### 1.1 TypeScript 编译检查

```bash
npx tsc --noEmit
```

- **用途**：在不生成产物的情况下，全量检查类型错误
- **耗时**：约 5-15 秒
- **适用场景**：修改 TS/TSX 文件后立刻执行，确保无类型错误
- **零配置**：直接读取 `tsconfig.json`，无需额外参数

**常见修复场景**：
- 新增 store 方法后未导出类型
- 组件 props 变更后调用方未同步
- 第三方库升级后 API 变更

### 1.2 ESLint 代码规范检查

```bash
npm run lint
```

- **用途**：检查代码风格、潜在 bug（如未使用的变量、hooks 依赖缺失）
- **配置**：基于 `@eslint/js` + `typescript-eslint` + `eslint-plugin-react-hooks`
- **目标**：保持 `0 errors, 0 warnings`

---

## 2. 视觉与功能验证（UI 改动后必做）

### 2.1 本地开发服务器验证

```bash
npm run dev
```

- 在浏览器中打开对应页面，手动验证交互效果
- 重点检查项：
  - 布局是否错位、溢出
  - 主题色（深色/浅色模式）是否正确
  - 响应式断点是否正常
  - 表单提交、弹窗开关等交互是否流畅

### 2.2 关键路径检查清单

| 模块 | 检查点 |
|------|--------|
| 日历 | 切换周/月视图、新建/编辑事件、拖拽调整时间 |
| 待办 | 新增 todo、切换完成状态、筛选、优先级颜色 |
| 笔记 | Enter/Alt+Enter 行为、保存、标签筛选 |
| AI 设置 | 模型切换、提示词模板编辑/切换/重置 |
| 主题 | 深色模式切换、自定义主题导入导出 |

---

## 3. 自动化测试（预提交/CI 阶段）

### 3.1 单元测试（Vitest）

```bash
# 单次运行
npm run test

# 监听模式（开发时）
npm run test:watch
```

- **框架**：Vitest + jsdom + `@testing-library/react`
- **覆盖范围**：工具函数、store 逻辑、组件渲染
- **策略**：核心工具函数必须覆盖，UI 组件以关键交互为主

### 3.2 E2E 测试（Playwright）

```bash
npm run test:e2e
```

- **框架**：Playwright
- **覆盖范围**：完整用户流程（登录 → 操作 → 断言）
- **运行环境**：真实浏览器（Chromium/Firefox/WebKit）

---

## 4. 构建验证（发布前必做）

```bash
npm run build
```

- **作用**：`tsc -b` + `vite build`，验证生产构建是否通过
- **检查项**：
  - 无 TypeScript 报错
  - 无 Rollup/Vite 构建错误
  - 产物目录 `dist/` 正常生成

---

## 5. 常见测试模式总结

### 5.1 修改组件后的标准流程

```
1. npx tsc --noEmit          → 确认类型正确
2. npm run lint               → 确认代码规范
3. npm run dev + 浏览器验证   → 确认视觉与交互
4. （如涉及核心逻辑）npm run test  → 确认单元测试通过
```

### 5.2 修改 store/类型后的标准流程

```
1. npx tsc --noEmit          → 全量类型检查
2. grep 搜索调用方            → 确认所有使用点已同步
3. 浏览器验证相关页面         → 确认运行时行为
```

### 5.3 添加新功能后的标准流程

```
1. npx tsc --noEmit
2. npm run lint
3. npm run build              → 确保生产构建通过
4. 浏览器手动验证所有新增交互
5. 补充对应测试用例（单元/E2E）
6. 更新 kiminote 记录
```

---

## 6. 调试技巧

### 6.1 定位类型错误

```bash
# 只看特定文件的错误
npx tsc --noEmit 2>&1 | grep "Calendar2Page"

# Windows PowerShell
npx tsc --noEmit 2>&1 | Select-String "Calendar2Page"
```

### 6.2 快速搜索代码影响范围

```bash
# 查找某个变量/方法的所有使用位置
grep -r "toggleStatus" src/ --include="*.ts" --include="*.tsx"
```

### 6.3 检查 store 导出

修改 store 后，确认 `src/stores/index.ts` 已正确导出新增内容：

```ts
export { useTodoStore } from './todoStore';
export { useScheduleStore } from './scheduleStore';
// 新增 store 需在此注册
```

---

## 7. 检查清单模板

提交 PR 前自查：

- [ ] `npx tsc --noEmit` 无错误
- [ ] `npm run lint` 无 error/warning
- [ ] 浏览器手动验证通过（如涉及 UI）
- [ ] `npm run build` 构建成功
- [ ] 相关文档已更新（README/changelog/kiminote）
- [ ] 如需，补充了单元测试或 E2E 测试

---

*最后更新：2026-05-12*
