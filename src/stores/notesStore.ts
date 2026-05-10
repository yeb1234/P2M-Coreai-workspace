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

interface NotesState {
  notes: Note[];
  trash: Record<string, TrashedNote>;
  addNote: (data: Partial<Note> & { title: string }) => string;
  upsertTodayAiNote: () => string;
  updateNote: (id: string, updates: Partial<Note>) => void;
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
    title: 'React 性能优化笔记',
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

      upsertTodayAiNote: () => {
        const ts = now();
        const today = new Date().toLocaleDateString('zh-CN');
        const title = `今日 AI 笔记 - ${today}`;
        const content = [
          '# 今日 AI 笔记',
          '',
          '> 施工中：这里以后会一键汇总今日待办、视频学习、日历和 AI 对话内容。',
          '',
          '## 今日摘要',
          '- 暂未接入自动生成。',
          '',
          '## 待整理',
          '- 可以先手动补充今天的重点。',
        ].join('\n');
        let noteId = '';
        set((state) => {
          const existing = state.notes.find((note) => note.tag === 'AI日报' && note.title === title);
          if (existing) {
            noteId = existing.id;
            return {
              notes: [
                { ...existing, content, color: 'sticky-purple' as NoteColor, pinned: true, updatedAt: ts },
                ...state.notes.filter((note) => note.id !== existing.id),
              ],
            };
          }
          noteId = generateId();
          const note: Note = {
            id: noteId,
            title,
            content,
            color: 'sticky-purple',
            pinned: true,
            tag: 'AI日报',
            createdAt: ts,
            updatedAt: ts,
          };
          return { notes: [note, ...state.notes] };
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
    }
  )
);
