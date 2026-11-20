import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { idbStorage } from '../lib/idbStorage';
import { generateId } from '../lib/id';

export type MdNoteFont = 'sans' | 'serif' | 'mono';
export type MdNoteSize = 13 | 14 | 15 | 16 | 17 | 18;

export interface MdFolder {
  id: string;
  name: string;
}

export interface MdNote {
  id: string;
  title: string;
  markdown: string;
  folderId: string | null;
  tags: string[];
  starred: boolean;
  font: MdNoteFont;
  fontSize: MdNoteSize;
  createdAt: string;
  updatedAt: string;
  trashedAt?: string;
}

/** 服务端 notes 表返回的私人笔记；用于 AI 保存后回填 Markdown 笔记。 */
export interface ServerMdNoteLike {
  id: number;
  title: string;
  content: string;
  source?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface MdNotesState {
  notes: MdNote[];
  folders: MdFolder[];
  activeNoteId: string | null;
  createNote: (data?: Partial<MdNote> & { title?: string }) => string;
  importServerNote: (note: ServerMdNoteLike) => string;
  removeServerNote: (serverId: number) => void;
  createFolder: (name: string) => string | null;
  updateNote: (id: string, updates: Partial<MdNote>) => void;
  deleteNote: (id: string) => void;
  restoreNote: (id: string) => void;
  permanentDeleteNote: (id: string) => void;
  duplicateNote: (id: string) => string | null;
  toggleStar: (id: string) => void;
  setActiveNote: (id: string | null) => void;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void;
  moveNoteToFolder: (id: string, folderId: string | null) => void;
}

const now = () => new Date().toISOString();
const FOLDER_WORK = 'folder-work';
const FOLDER_STUDY = 'folder-study';
const FOLDER_PROJECT = 'folder-project';

const seedFolders: MdFolder[] = [
  { id: FOLDER_WORK, name: '工作' },
  { id: FOLDER_STUDY, name: '学习' },
  { id: FOLDER_PROJECT, name: '项目' },
];

const seedNotes: MdNote[] = [
  {
    id: 'mdn-welcome',
    title: '欢迎使用笔记',
    folderId: FOLDER_STUDY,
    tags: ['Markdown', '上手'],
    starred: true,
    font: 'sans',
    fontSize: 15,
    createdAt: '2026-11-18T09:00:00.000Z',
    updatedAt: '2026-11-18T09:00:00.000Z',
    markdown: `# 欢迎使用笔记

这是一个**以 Markdown 为唯一源文件**的笔记工作台：左边管理目录，中间编辑，右边实时渲染。

> 你可以在「分栏 / 源码 / 富文本」三种模式之间切换，富文本里改完的内容会自动转回 Markdown。

## 今天先试这几件事

- [ ] 新建一条笔记，写一个标题
- [ ] 用工具栏插入一张表格
- [ ] 切到富文本模式，选中一段文字加粗
- [ ] 导出为 \`.md\` 文件

## 代码块

\`\`\`ts
type Note = {
  title: string;
  markdown: string;
};
\`\`\`

## 一个小表格

| 能力 | 状态 |
| --- | --- |
| Markdown 渲染 HTML | 已支持 |
| HTML 反向转 Markdown | 已支持 |
| 本地自动保存 | 已支持 |

---

在右侧预览里，标题、列表、引用、代码块和表格会按阅读版式排版。`,
  },
  {
    id: 'mdn-shortcuts',
    title: 'Markdown 速查',
    folderId: FOLDER_STUDY,
    tags: ['速查'],
    starred: false,
    font: 'sans',
    fontSize: 15,
    createdAt: '2026-11-18T08:30:00.000Z',
    updatedAt: '2026-11-18T08:30:00.000Z',
    markdown: `# Markdown 速查

## 文本

- **加粗**：\`**文字**\`
- *斜体*：\`*文字*\`
- ~~删除线~~：\`~~文字~~\`
- <u>下划线</u>：\`<u>文字</u>\`

## 结构

1. 标题：\`# / ## / ###\`
2. 引用：\`> 引用内容\`
3. 无序列表：\`- 条目\`
4. 有序列表：\`1. 条目\`
5. 任务：\`- [ ] 待办\`

## 插入

- 链接：\`[标题](https://example.com)\`
- 图片：\`![说明](https://example.com/a.png)\`
- 分割线：\`---\``,
  },
  {
    id: 'mdn-project',
    title: '项目架构记录',
    folderId: FOLDER_PROJECT,
    tags: ['架构', 'P2'],
    starred: false,
    font: 'sans',
    fontSize: 15,
    createdAt: '2026-11-17T15:00:00.000Z',
    updatedAt: '2026-11-17T15:00:00.000Z',
    markdown: `# 项目架构记录

## 分层

- 桌面壳只负责加载远程 UI，不参与业务数据。
- 笔记正文保存在本地 IndexedDB，并随账号同步。
- Markdown 是唯一源文件，预览 HTML 只用于阅读。

## 待确认

- [ ] 是否要把笔记接入云端搜索
- [ ] 是否需要多人共享文件夹`,
  },
];

/**
 * 旧种子标题里带「MD 笔记」。现在这个工作台就叫「笔记」，已存在用户
 * IndexedDB 里的那条种子不会因为 seed 改名而自动更新，所以在恢复时做一次
 * 精确迁移，只动 id=mdn-welcome 的种子，不碰用户自己写的笔记。
 *
 * 同时把两篇示例笔记的 16px 默认字号收一档到 15px。只在种子仍保持
 * 原始 updatedAt 时生效，用户一旦改过字号或正文就不会被反复覆盖。
 */
function migrateLegacySeedNotes(notes: MdNote[]): MdNote[] {
  return notes.map((note) => {
    const seedTypography: Record<string, { updatedAt: string; size: MdNoteSize }> = {
      'mdn-welcome': { updatedAt: '2026-11-18T09:00:00.000Z', size: 15 },
      'mdn-project': { updatedAt: '2026-11-17T15:00:00.000Z', size: 15 },
    };
    const typography = seedTypography[note.id];
    const nextSize = typography
      && note.updatedAt === typography.updatedAt
      && note.fontSize === 16
      ? typography.size
      : note.fontSize;

    if (note.id !== 'mdn-welcome') {
      return nextSize === note.fontSize ? note : { ...note, fontSize: nextSize };
    }
    const title = note.title === '欢迎使用 MD 笔记' ? '欢迎使用笔记' : note.title;
    const markdown = note.markdown.replace(/^# 欢迎使用 MD 笔记(?=\n|$)/m, '# 欢迎使用笔记');
    return title === note.title && markdown === note.markdown && nextSize === note.fontSize
      ? note
      : { ...note, title, markdown, fontSize: nextSize };
  });
}

export const useMdNotesStore = create<MdNotesState>()(
  persist(    (set, get) => ({
      notes: seedNotes,
      folders: seedFolders,
      activeNoteId: seedNotes[0].id,

      createNote: (data) => {
        const id = generateId();
        const ts = now();
        const note: MdNote = {
          id,
          title: data?.title || '无标题笔记',
          markdown: data?.markdown || '',
          folderId: data?.folderId ?? null,
          tags: data?.tags || [],
          starred: data?.starred ?? false,
          font: data?.font || 'sans',
          fontSize: data?.fontSize || 15,
          createdAt: ts,
          updatedAt: ts,
        };
        set((state) => ({ notes: [note, ...state.notes], activeNoteId: id }));
        return id;
      },

      importServerNote: (data) => {
        const id = `srv-${data.id}`;
        const existing = get().notes.find((note) => note.id === id);
        if (existing) {
          set({ activeNoteId: id });
          return id;
        }
        // 保存当前 Markdown 笔记时，本地正文和刚写入服务端的副本一致，
        // 不要再插一条重复笔记。
        const sameContent = get().notes.find(
          (note) => note.title === (data.title || '').slice(0, 240) && note.markdown === (data.content || '')
        );
        if (sameContent) {
          set({ activeNoteId: sameContent.id });
          return sameContent.id;
        }
        const created = data.createdAt || now();
        const updated = data.updatedAt || created;
        const note: MdNote = {
          id,
          title: (data.title || '未命名笔记').slice(0, 240),
          markdown: data.content || '',
          folderId: null,
          tags: [data.source === 'assistant' ? 'AI' : '云端'],
          starred: false,
          font: 'sans',
          fontSize: 15,
          createdAt: created,
          updatedAt: updated,
        };
        set((state) => ({ notes: [note, ...state.notes], activeNoteId: id }));
        return id;
      },

      removeServerNote: (serverId) => {
        const id = `srv-${serverId}`;
        set((state) => ({
          notes: state.notes.filter((note) => note.id !== id),
          activeNoteId: state.activeNoteId === id ? null : state.activeNoteId,
        }));
      },

      createFolder: (name) => {
        const trimmed = name.trim();
        if (!trimmed) return null;
        const existing = get().folders.find((folder) => folder.name === trimmed);
        if (existing) return existing.id;
        const id = `folder-${generateId()}`;
        set((state) => ({ folders: [...state.folders, { id, name: trimmed }] }));
        return id;
      },

      updateNote: (id, updates) => {
        set((state) => ({
          notes: state.notes.map((note) =>
            note.id === id ? { ...note, ...updates, updatedAt: now() } : note
          ),
        }));
      },

      deleteNote: (id) => {
        set((state) => ({
          notes: state.notes.map((note) =>
            note.id === id ? { ...note, trashedAt: now(), updatedAt: now() } : note
          ),
          activeNoteId: state.activeNoteId === id
            ? state.notes.find((note) => !note.trashedAt && note.id !== id)?.id || null
            : state.activeNoteId,
        }));
      },

      restoreNote: (id) => {
        set((state) => ({
          notes: state.notes.map((note) =>
            note.id === id ? { ...note, trashedAt: undefined, updatedAt: now() } : note
          ),
          activeNoteId: id,
        }));
      },

      permanentDeleteNote: (id) => {
        set((state) => ({
          notes: state.notes.filter((note) => note.id !== id),
          activeNoteId: state.activeNoteId === id ? null : state.activeNoteId,
        }));
      },

      duplicateNote: (id) => {
        const source = get().notes.find((note) => note.id === id);
        if (!source) return null;
        const newId = generateId();
        const ts = now();
        set((state) => ({
          notes: [
            { ...source, id: newId, title: `${source.title} 副本`, starred: false, createdAt: ts, updatedAt: ts },
            ...state.notes,
          ],
          activeNoteId: newId,
        }));
        return newId;
      },

      toggleStar: (id) => {
        set((state) => ({
          notes: state.notes.map((note) =>
            note.id === id ? { ...note, starred: !note.starred, updatedAt: now() } : note
          ),
        }));
      },

      setActiveNote: (id) => set({ activeNoteId: id }),

      renameFolder: (id, name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        set((state) => ({
          folders: state.folders.map((folder) => folder.id === id ? { ...folder, name: trimmed } : folder),
        }));
      },

      deleteFolder: (id) => {
        set((state) => ({
          folders: state.folders.filter((folder) => folder.id !== id),
          notes: state.notes.map((note) => note.folderId === id ? { ...note, folderId: null } : note),
        }));
      },

      moveNoteToFolder: (id, folderId) => {
        set((state) => ({
          notes: state.notes.map((note) =>
            note.id === id ? { ...note, folderId, updatedAt: now() } : note
          ),
        }));
      },
    }),
    {
      name: 'p2m-md-notes-storage',
      storage: createJSONStorage(() => idbStorage),
      partialize: (state) => ({
        notes: state.notes,
        folders: state.folders,
        activeNoteId: state.activeNoteId,
      }),
      merge: (persisted, current) => {
        const persistedState = persisted as Partial<
          Pick<MdNotesState, 'notes' | 'folders' | 'activeNoteId'>
        > | undefined;
        return {
          ...current,
          notes: migrateLegacySeedNotes(persistedState?.notes ?? current.notes),
          folders: persistedState?.folders ?? current.folders,
          activeNoteId: persistedState && 'activeNoteId' in persistedState
            ? persistedState.activeNoteId ?? null
            : current.activeNoteId,
        };
      },
    }
  )
);
