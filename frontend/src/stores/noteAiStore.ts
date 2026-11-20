import { create } from 'zustand';
import { runNoteAi } from '../lib/noteAiApi';
import type { NoteAiAction, NoteAiEvent, NoteAiTodo } from '../lib/noteAiApi';

/**
 * 笔记 AI 的会话状态。按 noteId 分开保存，组件卸载或切换页面时不销毁：
 * - 切走再回来，面板、加载态和已有结果都还在；
 * - 切到别的笔记再回来，原笔记的结果不会被清空；
 * - 请求完成时按 noteId 回填，不会把结果写到当前正在看的别的笔记。
 *
 * 这里只放内存，不落 localStorage / IndexedDB：AI 结果可能包含整篇笔记正文，
 * 不应因为一次页面切换就额外持久化一份到磁盘。
 */
export interface NoteAiSession {
  noteId: string;
  open: boolean;
  view: NoteAiAction;
  loading: NoteAiAction | null;
  error: string;
  summary: string;
  polished: string;
  todos: NoteAiTodo[];
  events: NoteAiEvent[];
  createdActions: Record<string, boolean>;
  creatingAction: string | null;
}

interface NoteAiStore {
  sessions: Record<string, NoteAiSession>;
  openSession: (noteId: string, view?: NoteAiAction) => void;
  closeSession: (noteId: string) => void;
  setSessionError: (noteId: string, error: string) => void;
  markCreatedAction: (noteId: string, key: string) => void;
  setCreatingAction: (noteId: string, key: string | null) => void;
  runSession: (
    noteId: string,
    view: NoteAiAction,
    input: { title: string; markdown: string },
  ) => Promise<void>;
  clearSession: (noteId: string) => void;
}

const EMPTY_SESSION = {
  open: false,
  view: 'summary' as NoteAiAction,
  loading: null,
  error: '',
  summary: '',
  polished: '',
  todos: [] as NoteAiTodo[],
  events: [] as NoteAiEvent[],
  createdActions: {} as Record<string, boolean>,
  creatingAction: null,
};

const requestSeq: Record<string, number> = {};

function makeSession(noteId: string, patch: Partial<NoteAiSession> = {}): NoteAiSession {
  return { noteId, ...EMPTY_SESSION, ...patch };
}

function patchSession(
  sessions: Record<string, NoteAiSession>,
  noteId: string,
  patch: Partial<NoteAiSession>,
): Record<string, NoteAiSession> {
  return {
    ...sessions,
    [noteId]: { ...(sessions[noteId] || makeSession(noteId)), ...patch },
  };
}

export const useNoteAiStore = create<NoteAiStore>((set, get) => ({
  sessions: {},

  openSession: (noteId, view) => {
    set((state) => ({
      sessions: patchSession(state.sessions, noteId, {
        open: true,
        ...(view ? { view } : {}),
      }),
    }));
  },

  closeSession: (noteId) => {
    set((state) => ({
      sessions: patchSession(state.sessions, noteId, { open: false }),
    }));
  },

  setSessionError: (noteId, error) => {
    set((state) => ({
      sessions: patchSession(state.sessions, noteId, { error, loading: null }),
    }));
  },

  markCreatedAction: (noteId, key) => {
    set((state) => {
      const current = state.sessions[noteId] || makeSession(noteId);
      return {
        sessions: patchSession(state.sessions, noteId, {
          createdActions: { ...current.createdActions, [key]: true },
        }),
      };
    });
  },

  setCreatingAction: (noteId, key) => {
    set((state) => ({
      sessions: patchSession(state.sessions, noteId, { creatingAction: key }),
    }));
  },

  runSession: async (noteId, view, input) => {
    if (get().sessions[noteId]?.loading) return;

    const seq = (requestSeq[noteId] || 0) + 1;
    requestSeq[noteId] = seq;
    set((state) => ({
      sessions: patchSession(state.sessions, noteId, {
        open: true,
        view,
        loading: view,
        error: '',
      }),
    }));

    try {
      const response = await runNoteAi({ action: view, title: input.title, markdown: input.markdown });
      if (requestSeq[noteId] !== seq) return;

      set((state) => {
        const patch: Partial<NoteAiSession> = { loading: null, error: '' };
        if (view === 'summary') patch.summary = response.result.summary || '';
        if (view === 'polish') patch.polished = response.result.markdown || '';
        if (view === 'actions') {
          patch.todos = response.result.todos || [];
          patch.events = response.result.events || [];
          patch.createdActions = {};
        }
        return { sessions: patchSession(state.sessions, noteId, patch) };
      });
    } catch (err) {
      if (requestSeq[noteId] !== seq) return;
      set((state) => ({
        sessions: patchSession(state.sessions, noteId, {
          loading: null,
          error: err instanceof Error ? err.message : 'AI 请求失败，请稍后重试',
        }),
      }));
    }
  },

  clearSession: (noteId) => {
    requestSeq[noteId] = (requestSeq[noteId] || 0) + 1;
    set((state) => {
      if (!state.sessions[noteId]) return state;
      const next = { ...state.sessions };
      delete next[noteId];
      return { sessions: next };
    });
  },
}));
