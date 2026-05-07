import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateId } from '../lib/id';

export type NoteColor = 'sticky-yellow' | 'sticky-pink' | 'sticky-blue' | 'sticky-green' | 'sticky-orange' | 'sticky-purple';

export interface Note {
  id: string;
  title: string;
  content: string;
  color: NoteColor;
  pinned: boolean;
  tag: string;
  createdAt: string;
  updatedAt: string;
}

interface NotesState {
  notes: Note[];
  addNote: (data: Partial<Note> & { title: string }) => string;
  updateNote: (id: string, updates: Partial<Note>) => void;
  deleteNote: (id: string) => void;
  togglePin: (id: string) => void;
}

const now = () => new Date().toISOString();

const SEED_NOTES: Note[] = [
  {
    id: 'note-1',
    title: 'React 性能优化笔记',
    content: `## useMemo vs useCallback

useMemo 缓存**计算结果**，useCallback 缓存**函数引用**。

\`\`\`tsx
// useMemo - 缓存昂贵计算
const sorted = useMemo(() => items.sort(compareFn), [items]);

// useCallback - 缓存函数引用，避免子组件重渲染
const handleClick = useCallback(() => setCount(c => c + 1), []);
\`\`\`

## React.memo 使用场景
- 组件渲染开销大
- props 变化频率低
- 父组件频繁重渲染

## 虚拟列表
大数据量用 \`react-window\` 或 \`@tanstack/virtual\``,
    color: 'sticky-yellow',
    pinned: true,
    tag: 'React',
    createdAt: '2026-05-06T10:00:00Z',
    updatedAt: '2026-05-06T10:00:00Z',
  },
  {
    id: 'note-2',
    title: '项目架构设计',
    content: `## P2M 双层架构

**zustand** → 响应式状态管理
**Dexie (IndexedDB)** → 持久化存储

### 数据流
1. 启动时从 Dexie 加载 → zustand store
2. 用户操作 → zustand set
3. set 后异步写入 Dexie (debounce 500ms)

### 为什么不用 Redux？
- P2M 是个人工具，不需要复杂中间件
- zustand API 更简洁，TypeScript 友好
- 无 provider 包裹，任意组件直接调用

### 为什么选 IndexedDB？
- 浏览器原生，无需 WASM
- 支持大容量存储（>localStorage 5MB）
- 支持索引查询`,
    color: 'sticky-blue',
    pinned: true,
    tag: '架构',
    createdAt: '2026-05-05T14:00:00Z',
    updatedAt: '2026-05-05T14:00:00Z',
  },
  {
    id: 'note-3',
    title: 'CSS Grid 速查表',
    content: `## 基础网格
\`\`\`css
grid-template-columns: repeat(12, 1fr);
gap: 14px;
\`\`\`

## 响应式断点
| 断点 | 列数 | 用途 |
|------|------|------|
| >1024 | 12列 | 桌面 3卡片/行 |
| 768-1024 | 6列 | 平板 |
| ≤768 | 2列 | 手机横屏 |
| ≤480 | 1列 | 手机竖屏 |

## 自动填充
\`\`\`css
grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
\`\`\`

## 子项跨列
\`\`\`css
grid-column: span 4; /* 占4列 */
\`\`\``,
    color: 'sticky-green',
    pinned: false,
    tag: 'CSS',
    createdAt: '2026-05-04T09:00:00Z',
    updatedAt: '2026-05-04T09:00:00Z',
  },
  {
    id: 'note-4',
    title: 'Git 高级用法',
    content: `## 交互式变基
\`\`\`bash
git rebase -i HEAD~3  # 合并最近3个提交
# pick → 保留, squash → 合并, reword → 改消息
\`\`\`

## Cherry-pick
\`\`\`bash
git cherry-pick abc123  # 把某个提交搬到当前分支
\`\`\`

## Stash 进阶
\`\`\`bash
git stash push -m "描述" -- src/only.ts  # 只暂存特定文件
git stash list
git stash pop stash@{0}
\`\`\`

## 找回丢失的提交
\`\`\`bash
git reflog  # 找到 commit hash
git cherry-pick <hash>
\`\`\`

## .gitignore 不生效？
\`\`\`bash
git rm -r --cached .  # 清除缓存
git add .
\`\`\``,
    color: 'sticky-pink',
    pinned: false,
    tag: 'Git',
    createdAt: '2026-05-03T16:00:00Z',
    updatedAt: '2026-05-03T16:00:00Z',
  },
  {
    id: 'note-5',
    title: '面试高频题速记',
    content: `## 闭包
函数 + 它能访问的外部变量。用途：数据私有化、函数工厂、柯里化。

## Event Loop
宏任务 → 微任务(Promise.then) → 渲染 → 宏任务...

## this 指向
- 普通函数：调用时决定
- 箭头函数：定义时决定（继承外层）
- class 方法：实例对象

## TypeScript 类型体操
\`\`\`ts
type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K];
};
\`\`\`

## React Fiber
把渲染拆成小单元，可中断可恢复。requestIdleCallback 思想。`,
    color: 'sticky-orange',
    pinned: false,
    tag: '面试',
    createdAt: '2026-05-02T11:00:00Z',
    updatedAt: '2026-05-02T11:00:00Z',
  },
  {
    id: 'note-6',
    title: '读书笔记：重构',
    content: `## 代码坏味道
- **重复代码** → 提取函数
- **过长函数** → 拆分成小函数
- **过大类** → 拆分成多个类
- **过长参数列表** → 引入参数对象
- **发散式变化** → 一个类只因一种原因变化
- **散弹式修改** → 把相关修改集中到一处

## 重构原则
> 重构不是重写。重构是在不改变外部行为的前提下改善内部结构。

## 小步前进
每次只做一个小改动，跑测试，确认通过，再继续。

## Martin Fowler 说
"任何傻瓜都能写出计算机能理解的代码，唯有写出人类能理解的代码才是优秀的程序员。"`,
    color: 'sticky-purple',
    pinned: false,
    tag: '读书',
    createdAt: '2026-05-01T20:00:00Z',
    updatedAt: '2026-05-01T20:00:00Z',
  },
];

export const useNotesStore = create<NotesState>()(
  persist(
    (set) => ({
      notes: SEED_NOTES,

      addNote: (data) => {
        const id = generateId();
        const ts = now();
        const note: Note = {
          id,
          title: data.title,
          content: data.content || '',
          color: data.color || 'sticky-yellow',
          pinned: data.pinned ?? false,
          tag: data.tag || '',
          createdAt: ts,
          updatedAt: ts,
        };
        set((state) => ({ notes: [note, ...state.notes] }));
        return id;
      },

      updateNote: (id, updates) => {
        set((state) => ({
          notes: state.notes.map((n) =>
            n.id === id ? { ...n, ...updates, updatedAt: now() } : n
          ),
        }));
      },

      deleteNote: (id) => {
        set((state) => ({ notes: state.notes.filter((n) => n.id !== id) }));
      },

      togglePin: (id) => {
        set((state) => ({
          notes: state.notes.map((n) =>
            n.id === id ? { ...n, pinned: !n.pinned, updatedAt: now() } : n
          ),
        }));
      },
    }),
    {
      name: 'p2m-notes-storage',
      partialize: (state) => ({ notes: state.notes }),
    }
  )
);
