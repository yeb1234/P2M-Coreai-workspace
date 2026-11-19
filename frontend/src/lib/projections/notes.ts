import type { Note } from '../../stores/notesStore';

/**
 * 笔记的唯一口径。
 *
 * 笔记页的展示顺序是「置顶分组在前，组内按 store 数组顺序（拖拽可改）」，
 * 工作台卡片原来按 updatedAt 倒序取 3 条 —— 和笔记页第一屏不是同一批，
 * 用户看到的就是"摘要和插件内容不同步"。这里把顺序定死，两边共用。
 */

export function splitNotesByPinned(notes: Note[]): { pinned: Note[]; unpinned: Note[] } {
  return {
    pinned: notes.filter((note) => note.pinned),
    unpinned: notes.filter((note) => !note.pinned),
  };
}

export function orderNotesForDisplay(notes: Note[]): Note[] {
  const { pinned, unpinned } = splitNotesByPinned(notes);
  return [...pinned, ...unpinned];
}

export interface NotesProjection {
  total: number;
  pinned: Note[];
  unpinned: Note[];
  /** 与笔记页渲染顺序一致的全序列（先置顶、再其余） */
  ordered: Note[];
  /** 卡片展示的前 N 条，即笔记页第一屏的那 N 条 */
  recent: Note[];
}

export function selectNotesProjection(notes: Note[], limit = 3): NotesProjection {
  const { pinned, unpinned } = splitNotesByPinned(notes);
  const ordered = [...pinned, ...unpinned];
  return {
    total: notes.length,
    pinned,
    unpinned,
    ordered,
    recent: ordered.slice(0, limit),
  };
}
