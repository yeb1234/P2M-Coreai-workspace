# 灵境项目测试流程指南

> 状态：部分现行（最后校对 2026-11-20）。命令与流程仍成立；第 3 节补入当前测试盘点（文件数、口径、覆盖缺口），旧文中与现状不符的例子已更正。

本文档记录项目推荐的测试方法与执行流程，覆盖从代码修改到上线前的完整验证链路。

## 0. 测试盘点（2026-11-20 如实登记，不凑数）

| 层 | 位置 | 数量与口径 | 形态 |
|---|---|---|---|
| 前端单元/组件 | `src/__tests__/` | **51** 个 `.test.ts` / `.test.tsx`（口径：该目录下文件计数） | Vitest + jsdom；覆盖 store、工具函数、关键组件与页面交互 |
| 前端契约回归 | `tests/contracts/` | **1** 个 `.test.ts` | Vitest，`vitest.config.ts` 的 `include` 同时覆盖 `src/**/*.test.ts(x)` 与 `tests/contracts/**/*.test.ts` |
| 前端合计 | `src/__tests__` + `tests/contracts` | **52** 个文件 / **406** 个用例 | 2026-11-20 `npm test -- --run` 全通过 |
| 前端 E2E | `tests/e2e/` | **1** 个 Playwright 规格 | 3 个 Chromium 项目（桌面 1440×900、窄屏 1024×768、Pixel 7 移动）；**没有** Firefox/WebKit 项目 |
| 后端单元 | `backend/tests/` | **19** 个 `.py`（口径：该目录下 `.py` 计数） | service 直连的单元级断言，共 99 项；含 Lite profile、HITL 恢复、笔记 AI、动作联动、MCP 治理等 |
| 后端在线校验脚本 | `backend/scripts/verify_fixes.py` | 1 个 | 起容器后用 `urllib` 打 `http://127.0.0.1:8000` 的针对性校验脚本，**不是** pytest 套件 |
| 手动多账号脚本 | `backend/scripts/test_multi_user.py` | 1 个 | 手动脚本，不在自动测试链路里 |

**覆盖缺口（如实写）**：

- **后端没有 API 级集成测试**：没有起 `TestClient`/HTTP 层、按端点断言鉴权与隔离的用例；`backend/tests/` 全部是 service 直连单元测试。
- `tests/` 顶层只有 `contracts` 与 `e2e` 两个目录，没有第三个测试目录。
- 前端 E2E 只有 1 条规格，不覆盖全部关键路径。

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

- dev 端口 `12322`（代理打到 `127.0.0.1:12302`，同源不触发 CORS）；浏览器打开 `http://127.0.0.1:12322` 对应页面，手动验证交互效果
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
- **盘点**：`src/__tests__/` 51 个文件 + `tests/contracts/` 1 个，合计 52 个文件、406 个用例；口径与清单见第 0 节

### 3.2 E2E 测试（Playwright）

```bash
npm run test:e2e
```

- **框架**：Playwright，`testDir: ./tests/e2e`，`baseURL: http://127.0.0.1:12322`（webServer 起 dev 服务，复用已有实例）
- **覆盖范围**：完整用户流程（登录 → 操作 → 断言）
- **运行环境**：仅 Chromium 三个项目——桌面 1440×900、窄屏 1024×768、Pixel 7 移动；**未配** Firefox/WebKit
- **盘点**：`tests/e2e/` 目前只有 1 条规格，不覆盖全部关键路径
- **2026-11-16 实测**：桌面项目 **26 passed / 1 skipped**（14.8s）；三个项目合计 **50 passed / 31 skipped / 0 failed**（25.8s）；明细见 `docs/demo/evaluation.md`
- **注意**：E2E 走 mock API，不证明真实后端链路；注册关闭后，`prepareApp` 用 `p2m-auth-user-id` 注入登录态，不再依赖“去注册”；3 条桌面专用日历场景在窄屏/移动显式跳过

### 3.3 后端测试

```bash
# 一条命令跑全部：99 项
docker compose exec backend python scripts/run_unit_tests.py
```

- **现状**：19 个 `.py`，全部是 service 直连的单元级断言
- **2026-11-20 实测**：99 项通过
- **缺口**：**没有 API 级集成测试**（不起 `TestClient`、不按端点鉴权/隔离断言）；在线校验仍靠 `backend/scripts/verify_fixes.py` 这类脚本手动跑
- `backend/scripts/run_unit_tests.py` 是本轮新增的统一 runner，不依赖 pytest；裸函数不再需要手工 import

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
6. 更新项目文档或变更记录（`docs/`）
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
export { useScheduleStore } from './scheduleStore';
export { useNotesStore } from './notesStore';
// 新增 store 需在此注册
```

---

## 7. 检查清单模板

提交 PR 前自查：

- [ ] `npx tsc --noEmit` 无错误
- [ ] `npm run lint` 无 error/warning
- [ ] 浏览器手动验证通过（如涉及 UI）
- [ ] `npm run build` 构建成功
- [ ] 相关文档已更新（README / CHANGELOG / `docs/`）
- [ ] 如需，补充了单元测试或 E2E 测试

---

*最后校对：2026-11-16*
