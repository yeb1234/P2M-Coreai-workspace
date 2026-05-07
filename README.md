# P2M - 个人效率工作台

> 集待办管理、番茄钟、日历、笔记、数据统计于一体的个人生产力工具。

## 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | React 19 + TypeScript 6 |
| 构建 | Vite 8 |
| 状态管理 | Zustand 5 |
| 样式 | Tailwind CSS 3 |
| 日期处理 | date-fns 4 |
| 图标 | lucide-react |
| 持久化 | localStorage (zustand persist) |
| 测试 | Vitest + @testing-library/react |

## 项目结构

```
src/
├── components/          # UI 组件
│   ├── layout/          # 布局: Header, Sidebar, AppLayout, NotificationPanel
│   ├── dashboard/       # 工作台: PluginCard, 各模块 Summary 卡片
│   ├── todo/            # 待办: TodoList, TodoItem, TodoForm, TodoFilters
│   ├── calendar/        # 日历: CalendarGrid, DayCell, WeekView
│   ├── pomodoro/        # 番茄钟: PomodoroTimer, PomodoroStats, PomodoroSessionList
│   ├── notes/           # 笔记: NotesPage
│   ├── stats/           # 数据中心: StatsPage
│   ├── settings/        # 设置: SettingsPage
│   └── shared/          # 通用: Modal, Badge, PageTitle, EmptyState, ConfirmDialog
├── stores/              # Zustand 状态管理
│   ├── todoStore.ts     # 待办 CRUD + 撤销/重做 + 筛选
│   ├── pomodoroStore.ts # 番茄钟计时器 + 会话管理
│   ├── calendarStore.ts # 日历事件 + 热力图
│   ├── notesStore.ts    # 笔记 CRUD
│   ├── uiStore.ts       # UI 状态: 视图切换、侧边栏、导航排序
│   ├── pluginStore.ts   # 插件布局管理
│   └── notificationStore.ts # 通知系统
├── hooks/               # 自定义 Hooks
│   └── useCrossModuleSync.ts # 跨模块数据同步
├── lib/                 # 工具函数
│   ├── date.ts          # 日期格式化
│   ├── id.ts            # ID 生成 (nanoid)
│   └── sounds.ts        # Web Audio 音效
├── types/               # TypeScript 类型定义
├── plugins/             # 插件注册系统
└── __tests__/           # 单元测试
```

## 核心功能

### 待办事项
- 创建、编辑、删除、拖拽排序
- 优先级标记（高/中/低/绿色）
- 截止日期、标签筛选
- 撤销/重做 (Ctrl+Z / Ctrl+Y)
- 垃圾箱恢复
- 与日历和番茄钟联动

### 番茄钟
- 25 分钟专注 + 5 分钟短休息 + 15 分钟长休息
- 可自定义时长和目标
- 关联待办事项
- 背景白噪音（雨声、咖啡厅、壁炉、森林）
- 专注统计和时间线

### 日历
- 月视图 / 周视图
- 日历热力图（番茄钟密度）
- 双击日期快速创建待办
- 事件管理

### 笔记
- 6 种便利贴颜色
- 置顶、标签、搜索
- Markdown 内容

### 数据中心
- 今日/本周番茄统计
- 待办完成率
- 连续专注天数
- 成就徽章系统
- 本周专注趋势图

### 通知系统
- 番茄钟完成通知
- 待办到期提醒
- 系统消息
- 未读计数

### 设置
- 番茄钟参数调整（真的能用）
- 个人信息、通知、外观、隐私、数据管理（占位）

## 架构设计

### 状态管理
采用 **Zustand + localStorage** 双层架构：
- Zustand 负责响应式状态
- `persist` 中间件自动持久化到 localStorage
- 每个 store 使用 `partialize` 只持久化必要数据
- `merge` 函数处理版本升级时的字段合并

### 性能优化
- **Zustand selectors**: 所有组件使用精确 selector 订阅，避免不必要的重渲染
- **React.memo**: 纯展示组件使用 memo 包裹
- **useMemo/useCallback**: 计算密集型操作和回调函数使用缓存
- **Portal**: 通知面板使用 React Portal 确保层级正确
- **常量提取**: 模块级常量避免每次渲染重新创建

### 跨模块同步
`useCrossModuleSync` hook 负责：
- 番茄钟全局计时（每秒 tick）
- 番茄钟完成 → 自动创建日历事件
- 待办有截止日期 → 自动创建日历事件
- 番茄钟完成 → 推送通知

## 开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 运行测试
npm test

# 构建
npm run build

# 代码检查
npm run lint
```

## 测试

```bash
npm test              # 运行一次
npm run test:watch    # 监听模式
```

测试覆盖：
- `todoStore`: CRUD、撤销重做、筛选、日期查询
- `notesStore`: CRUD、置顶、默认值
- `notificationStore`: 添加、已读、清空、上限
- `date.ts`: 日期格式化、时间格式化、时长格式化
- `id.ts`: 唯一性、非空

## 许可证

MIT
