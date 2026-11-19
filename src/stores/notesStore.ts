import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { idbStorage } from '../lib/idbStorage';
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

export interface TrashedNote {
  note: Note;
  deletedAt: string;
}

export type NoteInsertPosition = 'before' | 'after';

interface NotesState {
  notes: Note[];
  trash: Record<string, TrashedNote>;
  addNote: (data: Partial<Note> & { title: string }) => string;
  upsertTodayAiNote: (payload?: { title?: string; content?: string }) => string;
  updateNote: (id: string, updates: Partial<Note>) => void;
  reorderNotes: (fromId: string, toId: string, position?: NoteInsertPosition) => void;
  deleteNote: (id: string) => void;
  restoreNote: (id: string) => void;
  permanentDeleteNote: (id: string) => void;
  clearTrash: () => void;
  togglePin: (id: string) => void;
  renameTag: (fromTag: string, toTag: string) => void;
  deleteTag: (tag: string) => void;
  setTagColor: (tag: string, color: NoteColor) => void;
  recolorNotes: (fromColor: NoteColor, toColor: NoteColor) => void;
  getTrashedNotes: () => TrashedNote[];
}

export const NOTE_COLOR_OPTIONS: { value: NoteColor; label: string; dot: string }[] = [
  { value: 'sticky-yellow', label: '黄色', dot: '#f59e0b' },
  { value: 'sticky-pink', label: '粉色', dot: '#ec4899' },
  { value: 'sticky-blue', label: '蓝色', dot: '#3b82f6' },
  { value: 'sticky-green', label: '绿色', dot: '#22c55e' },
  { value: 'sticky-orange', label: '橙色', dot: '#f97316' },
  { value: 'sticky-purple', label: '紫色', dot: '#a855f7' },
];

const now = () => new Date().toISOString();
export const cleanNoteTag = (tag?: string) => (tag || '').trim().replace(/^#+/, '').trim();

const HASHTAG_RE = /(^|[\s,，。；;:：()[\]{}"'“”‘’])#([\p{L}\p{N}_-]{1,32})/gu;

export function extractNoteHashtags(text?: string): string[] {
  const source = text || '';
  const tags: string[] = [];
  let match: RegExpExecArray | null;
  HASHTAG_RE.lastIndex = 0;
  while ((match = HASHTAG_RE.exec(source))) {
    const tag = cleanNoteTag(match[2]);
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

export function getNoteTags(note: Pick<Note, 'title' | 'content' | 'tag'>): string[] {
  const tags = [
    cleanNoteTag(note.tag),
    ...extractNoteHashtags(note.title),
    ...extractNoteHashtags(note.content),
  ].filter(Boolean);
  return Array.from(new Set(tags));
}

const SEED_NOTES: Note[] = [
  {
    id: 'note-1',
    title: 'React 性能优化便签',
    content: 'useMemo 缓存计算结果，useCallback 缓存函数引用。真正需要优化时，再结合 React.memo 和虚拟列表。',
    color: 'sticky-yellow',
    pinned: true,
    tag: 'React',
    createdAt: '2026-05-06T10:00:00Z',
    updatedAt: '2026-05-06T10:00:00Z',
  },
  {
    id: 'note-2',
    title: '项目架构记录',
    content: '个人工具优先保持状态流清晰：本地 store 管交互，后端服务管视频、字幕和 AI 任务。',
    color: 'sticky-blue',
    pinned: true,
    tag: '架构',
    createdAt: '2026-05-05T14:00:00Z',
    updatedAt: '2026-05-05T14:00:00Z',
  },
  {
    id: 'note-3',
    title: 'Git 常用命令',
    content: 'reflog 用来找回丢失提交；stash push 可以只暂存指定文件；rebase 前先确认工作区干净。',
    color: 'sticky-pink',
    pinned: false,
    tag: 'Git',
    createdAt: '2026-05-03T16:00:00Z',
    updatedAt: '2026-05-03T16:00:00Z',
  },
];

/**
 * 旧种子和旧日报里写的是「笔记」。现在这个页面叫「便签」，已经持久化到
 * IndexedDB 的旧文案不会因为 seed 改名而自动更新；这里只精确迁移种子和
 * 系统生成的 AI 日报，不碰用户自己写的标题/正文。
 */
function migrateLegacyStickyLabels(notes: Note[]): Note[] {
  return notes.map((note) => {
    let title = note.title;
    let content = note.content;
    if (note.id === 'note-1' && title === 'React 性能优化笔记') {
      title = 'React 性能优化便签';
    }
    if (note.tag === 'AI日报') {
      title = title.replace(/^今日 AI 笔记 - /, '今日 AI 便签 - ');
      content = content.replace(/^# 今日 AI 笔记(?=\n|$)/m, '# 今日 AI 便签');
    }
    return title === note.title && content === note.content
      ? note
      : { ...note, title, content };
  });
}

export const useNotesStore = create<NotesState>()(
  persist(
    (set, get) => ({
      notes: SEED_NOTES,
      trash: {},

      addNote: (data) => {
        const id = generateId();
        const ts = now();
        const note: Note = {
          id,
          title: data.title,
          content: data.content || '',
          color: data.color || 'sticky-yellow',
          pinned: data.pinned ?? false,
          tag: cleanNoteTag(data.tag),
          createdAt: ts,
          updatedAt: ts,
        };
        set((state) => ({ notes: [note, ...state.notes] }));
        return id;
      },

      upsertTodayAiNote: (payload) => {
        const ts = now();
        const today = new Date().toLocaleDateString('zh-CN');
        const title = payload?.title || `今日 AI 便签 - ${today}`;
        const content = payload?.content || [
          '# 今日 AI 便签',
          '',
          '> 还没有生成内容。点「AI 今日便签」会汇总今天的视频学习、待办、学习路径和提问。',
          '',
          '## 今日摘要',
          '- 暂未生成。',
        ].join('\n');
        let noteId = '';
        set((state) => {
          const existing = state.notes.find((note) => note.tag === 'AI日报' && note.title === title);
          noteId = existing?.id || generateId();
          // 历史日报取消置顶：置顶区只保留最新一篇，否则一周下来顶上全是日报
          const rest = state.notes
            .filter((note) => note.id !== noteId)
            .map((note) => (note.tag === 'AI日报' && note.pinned ? { ...note, pinned: false } : note));
          const note: Note = {
            id: noteId,
            title,
            content,
            color: 'sticky-purple',
            pinned: true,
            tag: 'AI日报',
            createdAt: existing?.createdAt || ts,
            updatedAt: ts,
          };
          return { notes: [note, ...rest] };
        });
        return noteId;
      },

      updateNote: (id, updates) => {
        set((state) => ({
          notes: state.notes.map((note) =>
            note.id === id
              ? { ...note, ...updates, tag: updates.tag === undefined ? note.tag : cleanNoteTag(updates.tag), updatedAt: now() }
              : note
          ),
        }));
      },

      reorderNotes: (fromId, toId, position = 'before') => {
        if (fromId === toId) return;
        set((state) => {
          const notes = [...state.notes];
          const fromIndex = notes.findIndex((note) => note.id === fromId);
          const toIndex = notes.findIndex((note) => note.id === toId);
          if (fromIndex < 0 || toIndex < 0) return state;
          const [moved] = notes.splice(fromIndex, 1);
          const currentTargetIndex = notes.findIndex((note) => note.id === toId);
          const insertIndex = position === 'after' ? currentTargetIndex + 1 : currentTargetIndex;
          notes.splice(insertIndex, 0, moved);
          return { notes };
        });
      },

      deleteNote: (id) => {
        set((state) => {
          const note = state.notes.find((item) => item.id === id);
          if (!note) return state;
          return {
            notes: state.notes.filter((item) => item.id !== id),
            trash: { ...state.trash, [id]: { note, deletedAt: now() } },
          };
        });
      },

      restoreNote: (id) => {
        set((state) => {
          const trashed = state.trash[id];
          if (!trashed) return state;
          const trash = { ...state.trash };
          delete trash[id];
          return {
            notes: [trashed.note, ...state.notes],
            trash,
          };
        });
      },

      permanentDeleteNote: (id) => {
        set((state) => {
          const trash = { ...state.trash };
          delete trash[id];
          return { trash };
        });
      },

      clearTrash: () => set({ trash: {} }),

      togglePin: (id) => {
        set((state) => ({
          notes: state.notes.map((note) =>
            note.id === id ? { ...note, pinned: !note.pinned, updatedAt: now() } : note
          ),
        }));
      },

      renameTag: (fromTag, toTag) => {
        const from = cleanNoteTag(fromTag);
        const to = cleanNoteTag(toTag);
        if (!from || !to || from === to) return;
        set((state) => ({
          notes: state.notes.map((note) =>
            note.tag === from ? { ...note, tag: to, updatedAt: now() } : note
          ),
        }));
      },

      deleteTag: (tag) => {
        const target = cleanNoteTag(tag);
        if (!target) return;
        set((state) => ({
          notes: state.notes.map((note) =>
            note.tag === target ? { ...note, tag: '', updatedAt: now() } : note
          ),
        }));
      },

      setTagColor: (tag, color) => {
        const target = cleanNoteTag(tag);
        if (!target) return;
        set((state) => ({
          notes: state.notes.map((note) =>
            note.tag === target ? { ...note, color, updatedAt: now() } : note
          ),
        }));
      },

      recolorNotes: (fromColor, toColor) => {
        if (fromColor === toColor) return;
        set((state) => ({
          notes: state.notes.map((note) =>
            note.color === fromColor ? { ...note, color: toColor, updatedAt: now() } : note
          ),
        }));
      },

      getTrashedNotes: () => Object.values(get().trash).sort(
        (a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime()
      ),
    }),
    {
      name: 'p2m-notes-storage',
      storage: createJSONStorage(() => idbStorage),
      partialize: (state) => ({ notes: state.notes, trash: state.trash }),
      merge: (persisted, current) => {
        const persistedState = persisted as Partial<
          Pick<NotesState, 'notes' | 'trash'>
        > | undefined;
        return {
          ...current,
          notes: migrateLegacyStickyLabels(persistedState?.notes ?? current.notes),
          trash: persistedState?.trash ?? current.trash,
        };
      },
    }
  )
);

/**
 * 便签云端同步的接线。
 *
 * 由 App 在「已登录」之后调用一次：
 *   - 先把云端快照拉下来（如果本地还是初始种子数据，用云端覆盖）
 *   - 再订阅本地变化，防抖推送到云端
 *
 * 为什么要判断「本地是种子数据」：
 * 新设备打开时本地只有 SEED_NOTES 那几条示例，如果直接推上去，
 * 会把云端的真实便签冲掉。
 */
let syncInitialized = false;

export function initNotesSync(): void {
  if (syncInitialized) return;
  syncInitialized = true;

  void (async () => {
    const { pullNotes, scheduleNotesPush, NOTES_REMOTE_KEY } = await import('../lib/notesSync');
    void NOTES_REMOTE_KEY;

    const state = useNotesStore.getState();
    const looksLikeSeed =
      state.notes.length === SEED_NOTES.length &&
      state.notes.every((n) => SEED_NOTES.some((s) => s.id === n.id));

    const remote = await pullNotes();
    if (remote && looksLikeSeed) {
      // 本地还是示例数据，用云端覆盖
      useNotesStore.setState({ notes: remote.notes, trash: remote.trash ?? {} });
    } else if (remote) {
      // 两边都有真实数据：按 updatedAt 粗判，谁新用谁（不做逐条合并）
      const localTs = state.notes.reduce((m, n) => (n.updatedAt > m ? n.updatedAt : m), '');
      if ((remote.updatedAt ?? '') > localTs) {
        useNotesStore.setState({ notes: remote.notes, trash: remote.trash ?? {} });
      }
    }

    // 订阅变化：只关心 notes / trash 的引用变化
    let prevNotes = useNotesStore.getState().notes;
    let prevTrash = useNotesStore.getState().trash;
    useNotesStore.subscribe((s) => {
      if (s.notes === prevNotes && s.trash === prevTrash) return;
      prevNotes = s.notes;
      prevTrash = s.trash;
      scheduleNotesPush(() => ({
        kind: 'notes-v1',
        notes: useNotesStore.getState().notes,
        trash: useNotesStore.getState().trash,
        updatedAt: new Date().toISOString(),
      }));
    });
  })();
}
