import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bold, CalendarDays, CalendarPlus, Check, ChevronDown, Code2, Columns2, Copy, Download,
  Eye, EyeOff, FilePlus2, FileText, Folder, FolderPlus, Hash, Heading1, Heading2, Heading3,
  Image as ImageIcon, Italic, Link2, List, ListChecks, ListOrdered, ListTodo, Loader2, Maximize2,
  MoreHorizontal, PanelLeft, PanelRight,
  Palette, Highlighter, Pilcrow, Plus, Quote, RefreshCw, Redo2, RotateCcw, Search, Sparkles, Star, Strikethrough, Table2,
  Trash2, Type, Underline, Undo2, Upload, Wand2, X,
} from 'lucide-react';
import { useMdNotesStore } from '../../stores/mdNotesStore';
import { useNoteAiStore } from '../../stores/noteAiStore';
import type { MdNote, MdNoteFont, MdNoteSize } from '../../stores/mdNotesStore';
import { htmlToMarkdown, markdownStats, plainText, renderMarkdown } from '../../lib/markdown';
import {
  MDN_LIBRARY_DEFAULT_WIDTH,
  clampMdnLibraryWidth,
  clampMdnSplitRatio,
  persistMdnNumber,
  readMdnNumber,
} from './mdnLayout';
import {
  createCalendarEventFromAi,
  createTodoFromAi,
} from '../../lib/noteAiApi';
import type { NoteAiAction, NoteAiEvent, NoteAiTodo } from '../../lib/noteAiApi';
import { syncAllServerNotesIntoLocal } from '../../lib/serverNotesSync';
import { useServerNotesAutoSync } from '../../hooks/useServerNotesAutoSync';
import { flushAllPending } from '../../lib/idbStorage';
import './MarkdownNotesPage.css';

type EditorMode = 'split' | 'source' | 'rich';
type Filter =
  | { kind: 'all' }
  | { kind: 'starred' }
  | { kind: 'trash' }
  | { kind: 'folder'; id: string }
  | { kind: 'tag'; tag: string };

type MenuName = 'insert' | 'block' | 'font' | 'size' | 'color' | 'background' | 'more' | null;
type BlockKind = 'paragraph' | 'h1' | 'h2' | 'h3' | 'quote' | 'code' | 'ul' | 'ol' | 'task';
type InlineKind = 'bold' | 'italic' | 'underline' | 'strike';
type ColorTarget = 'text' | 'background';

const FONT_MAP: Record<MdNoteFont, string> = {
  sans: "'Inter', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
  serif: "'Songti SC', 'Noto Serif SC', Georgia, serif",
  mono: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
};
const FONT_OPTIONS: { value: MdNoteFont; label: string }[] = [
  { value: 'sans', label: '默认字体' },
  { value: 'serif', label: '衬线字体' },
  { value: 'mono', label: '等宽字体' },
];
const SIZE_OPTIONS: MdNoteSize[] = [13, 14, 15, 16, 17, 18];
const BLOCK_OPTIONS: { value: BlockKind; label: string; icon: React.ReactNode }[] = [
  { value: 'paragraph', label: '正文', icon: <Pilcrow size={14} /> },
  { value: 'h1', label: '标题 1', icon: <Heading1 size={14} /> },
  { value: 'h2', label: '标题 2', icon: <Heading2 size={14} /> },
  { value: 'h3', label: '标题 3', icon: <Heading3 size={14} /> },
  { value: 'quote', label: '引用', icon: <Quote size={14} /> },
  { value: 'code', label: '代码块', icon: <Code2 size={14} /> },
  { value: 'ul', label: '无序列表', icon: <List size={14} /> },
  { value: 'ol', label: '有序列表', icon: <ListOrdered size={14} /> },
  { value: 'task', label: '任务清单', icon: <ListTodo size={14} /> },
];

const TEXT_COLORS: { value: string; label: string }[] = [
  { value: '#0f172a', label: '墨黑' },
  { value: '#dc2626', label: '红' },
  { value: '#ea580c', label: '橙' },
  { value: '#ca8a04', label: '金' },
  { value: '#16a34a', label: '绿' },
  { value: '#2563eb', label: '蓝' },
  { value: '#7c3aed', label: '紫' },
  { value: '#db2777', label: '玫红' },
];

const HIGHLIGHT_COLORS: { value: string; label: string }[] = [
  { value: '#fef08a', label: '黄' },
  { value: '#fed7aa', label: '橙' },
  { value: '#fecaca', label: '红' },
  { value: '#bbf7d0', label: '绿' },
  { value: '#bfdbfe', label: '蓝' },
  { value: '#e9d5ff', label: '紫' },
  { value: '#fbcfe8', label: '粉' },
  { value: '#e2e8f0', label: '灰' },
];

const PRIORITY_LABEL: Record<string, string> = {
  high: '高优先级',
  medium: '中优先级',
  low: '低优先级',
  green: '普通',
};

const AI_TABS: { value: NoteAiAction; label: string; icon: React.ReactNode }[] = [
  { value: 'summary', label: '总结', icon: <ListChecks size={14} /> },
  { value: 'polish', label: '润色', icon: <Wand2 size={14} /> },
  { value: 'actions', label: '找行动', icon: <CalendarPlus size={14} /> },
];

function formatDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

function noteExcerpt(note: MdNote): string {
  return plainText(note.markdown).slice(0, 72) || '空白笔记';
}

function escapeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '_').trim() || '未命名笔记';
}

function safeCopy(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
  return Promise.resolve();
}

const IconButton: React.FC<{
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}> = ({ label, onClick, disabled, active, children }) => (
  <button
    type="button"
    className={`mdn-icon-btn${active ? ' is-active' : ''}`}
    onClick={onClick}
    disabled={disabled}
    title={label}
    aria-label={label}
  >
    {children}
  </button>
);

const MenuButton: React.FC<{
  label: React.ReactNode;
  open: boolean;
  onClick: () => void;
}> = ({ label, open, onClick }) => (
  <button
    type="button"
    className={`mdn-menu-btn${open ? ' is-open' : ''}`}
    onClick={onClick}
    aria-expanded={open}
  >
    {label}
    <ChevronDown size={13} />
  </button>
);

const ColorMenu: React.FC<{
  title: string;
  colors: { value: string; label: string }[];
  onPick: (value: string) => void;
  onRememberSelection: () => void;
}> = ({ title, colors, onPick, onRememberSelection }) => (
  <div className="mdn-menu mdn-color-menu">
    <div className="mdn-color-label">{title}</div>
    <div className="mdn-color-grid">
      {colors.map((color) => (
        <button
          key={color.value}
          type="button"
          className="mdn-color-swatch"
          style={{ backgroundColor: color.value }}
          title={color.label}
          aria-label={`${title}：${color.label}`}
          onClick={() => onPick(color.value)}
        />
      ))}
    </div>
    <div
      className="mdn-color-custom"
      onMouseDown={(event) => {
        onRememberSelection();
        event.stopPropagation();
      }}
    >
      <span>自定义</span>
      <input
        type="color"
        defaultValue={colors[0].value}
        aria-label={`${title}：自定义颜色`}
        onChange={(event) => onPick(event.target.value)}
      />
    </div>
  </div>
);

export const MarkdownNotesPage: React.FC<{ standalone?: boolean }> = ({ standalone = false }) => {
  const notes = useMdNotesStore((s) => s.notes);
  const folders = useMdNotesStore((s) => s.folders);
  const activeNoteId = useMdNotesStore((s) => s.activeNoteId);
  const createNote = useMdNotesStore((s) => s.createNote);
  const createFolder = useMdNotesStore((s) => s.createFolder);
  const updateNote = useMdNotesStore((s) => s.updateNote);
  const deleteNote = useMdNotesStore((s) => s.deleteNote);
  const restoreNote = useMdNotesStore((s) => s.restoreNote);
  const permanentDeleteNote = useMdNotesStore((s) => s.permanentDeleteNote);
  const duplicateNote = useMdNotesStore((s) => s.duplicateNote);
  const toggleStar = useMdNotesStore((s) => s.toggleStar);
  const setActiveNote = useMdNotesStore((s) => s.setActiveNote);
  const renameFolder = useMdNotesStore((s) => s.renameFolder);
  const deleteFolder = useMdNotesStore((s) => s.deleteFolder);
  const moveNoteToFolder = useMdNotesStore((s) => s.moveNoteToFolder);

  // 打开笔记页或从其他窗口切回来时，自动把服务端新笔记补齐；
  // 不再要求用户先点右上角的“从服务端同步”。
  useServerNotesAutoSync('md');

  const [mode, setMode] = useState<EditorMode>('split');
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<MenuName>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved');
  const [libraryWidth, setLibraryWidth] = useState(() => (
    readMdnNumber('siteyeb:mdn-library-width', MDN_LIBRARY_DEFAULT_WIDTH, clampMdnLibraryWidth)
  ));
  const [splitRatio, setSplitRatio] = useState(() => (
    readMdnNumber('siteyeb:mdn-split-ratio', 50, clampMdnSplitRatio)
  ));
  const [libraryVisible, setLibraryVisible] = useState(true);
  const [editorVisible, setEditorVisible] = useState(true);
  const [previewVisible, setPreviewVisible] = useState(true);
  const [tagInput, setTagInput] = useState('');
  const [toast, setToast] = useState('');
  const [richLoadedId, setRichLoadedId] = useState<string | null>(null);
  const [syncingServerNotes, setSyncingServerNotes] = useState(false);

  const aiSession = useNoteAiStore((s) => (activeNoteId ? s.sessions[activeNoteId] : undefined));
  const openAiSession = useNoteAiStore((s) => s.openSession);
  const closeAiSession = useNoteAiStore((s) => s.closeSession);
  const setAiSessionError = useNoteAiStore((s) => s.setSessionError);
  const markAiActionCreated = useNoteAiStore((s) => s.markCreatedAction);
  const setAiCreatingAction = useNoteAiStore((s) => s.setCreatingAction);
  const runAiSession = useNoteAiStore((s) => s.runSession);

  const aiOpen = aiSession?.open ?? false;
  const aiView = aiSession?.view ?? 'summary';
  const aiLoading = aiSession?.loading ?? null;
  const aiError = aiSession?.error ?? '';
  const aiSummary = aiSession?.summary ?? '';
  const aiPolished = aiSession?.polished ?? '';
  const aiTodos = aiSession?.todos ?? [];
  const aiEvents = aiSession?.events ?? [];
  const createdActions = aiSession?.createdActions ?? {};
  const creatingAction = aiSession?.creatingAction ?? null;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const richRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const richSelectionRef = useRef<Range | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const historyRef = useRef<Record<string, { stack: string[]; index: number }>>({});
  const richTimerRef = useRef<number | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const activeNotes = useMemo(() => notes.filter((note) => !note.trashedAt), [notes]);
  const trashedNotes = useMemo(
    () => notes.filter((note) => note.trashedAt).sort((a, b) => (b.trashedAt || '').localeCompare(a.trashedAt || '')),
    [notes],
  );
  const activeNote = notes.find((note) => note.id === activeNoteId) || null;
  const locked = Boolean(activeNote?.trashedAt);

  useEffect(() => {
    if (!activeNoteId && activeNotes[0]) setActiveNote(activeNotes[0].id);
  }, [activeNoteId, activeNotes, setActiveNote]);

  useEffect(() => {
    setTagInput(activeNote?.tags.join(', ') || '');
    setRichLoadedId(null);
    if (activeNote && !historyRef.current[activeNote.id]) {
      historyRef.current[activeNote.id] = { stack: [activeNote.markdown], index: 0 };
    }
  }, [activeNote?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mode !== 'rich' || !richRef.current || !activeNote) return;
    if (richLoadedId === activeNote.id) return;
    richRef.current.innerHTML = renderMarkdown(activeNote.markdown);
    setRichLoadedId(activeNote.id);
  }, [mode, activeNote, richLoadedId]);

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {
      if (toolbarRef.current?.contains(event.target as Node)) return;
      setMenu(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  useEffect(() => () => {
    if (richTimerRef.current) window.clearTimeout(richTimerRef.current);
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(''), 2200);
  }, []);

  useEffect(() => {
    persistMdnNumber('siteyeb:mdn-library-width', libraryWidth);
  }, [libraryWidth]);

  useEffect(() => {
    persistMdnNumber('siteyeb:mdn-split-ratio', splitRatio);
  }, [splitRatio]);

  const startLibraryResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = libraryWidth;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (moveEvent: PointerEvent) => {
      setLibraryWidth(clampMdnLibraryWidth(startWidth + moveEvent.clientX - startX));
    };
    const onUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [libraryWidth]);

  const startSplitResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0) return;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (moveEvent: PointerEvent) => {
      const ratio = ((moveEvent.clientX - rect.left) / rect.width) * 100;
      setSplitRatio(clampMdnSplitRatio(ratio));
    };
    const onUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);

  const openInWindow = useCallback(() => {
    if (typeof window === 'undefined') return;
    const width = Math.min(1680, Math.max(1024, window.screen.availWidth - 96));
    const height = Math.min(1080, Math.max(640, window.screen.availHeight - 72));
    const left = Math.max(0, Math.round((window.screen.availWidth - width) / 2));
    const top = Math.max(0, Math.round((window.screen.availHeight - height) / 2));
    const popup = window.open(
      `${window.location.origin}${window.location.pathname}#/mdnotes-window`,
      'p2-mdnotes-window',
      `popup=yes,width=${width},height=${height},left=${left},top=${top}`,
    );
    if (!popup) {
      showToast('浏览器拦截了新窗口，请允许本站弹窗');
      return;
    }
    popup.focus();
  }, [showToast]);

  const markSaving = useCallback(() => {
    setSaveState('saving');
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => setSaveState('saved'), 3200);
  }, []);

  const saveNow = useCallback(async () => {
    await flushAllPending();
    setSaveState('saved');
    showToast('已保存到本地');
  }, [showToast]);

  const pushHistory = useCallback((noteId: string, from: string, to: string) => {
    if (from === to) return;
    const current = historyRef.current[noteId] || { stack: [from], index: 0 };
    if (current.stack[current.index] !== from) {
      current.stack = [...current.stack.slice(0, current.index + 1), from];
      current.index = current.stack.length - 1;
    }
    current.stack = [...current.stack.slice(0, current.index + 1), to];
    current.index += 1;
    if (current.stack.length > 100) {
      current.stack = current.stack.slice(current.stack.length - 100);
      current.index = current.stack.length - 1;
    }
    historyRef.current[noteId] = current;
  }, []);

  const setMarkdown = useCallback((next: string, record = true) => {
    if (!activeNote || locked) return;
    if (record) pushHistory(activeNote.id, activeNote.markdown, next);
    updateNote(activeNote.id, { markdown: next });
    markSaving();
  }, [activeNote, locked, markSaving, pushHistory, updateNote]);

  const runAi = useCallback(async (view: NoteAiAction) => {
    if (!activeNote || locked || aiLoading) return;
    const source = mode === 'rich' && richRef.current
      ? htmlToMarkdown(richRef.current.innerHTML)
      : activeNote.markdown;
    if (!source.trim()) {
      openAiSession(activeNote.id, view);
      setAiSessionError(activeNote.id, '这篇笔记还是空的，先写点内容再让 AI 处理');
      return;
    }

    await runAiSession(activeNote.id, view, {
      title: activeNote.title,
      markdown: source,
    });
  }, [activeNote, aiLoading, locked, mode, openAiSession, runAiSession, setAiSessionError]);

  const insertAiSummary = useCallback(() => {
    if (!activeNote || !aiSummary.trim()) return;
    const body = activeNote.markdown.replace(/\s*$/, '');
    setMarkdown(`${body}\n\n## AI 摘要\n\n${aiSummary.trim()}\n`);
    if (mode === 'rich') setRichLoadedId(null);
    closeAiSession(activeNote.id);
    showToast('摘要已插入正文');
  }, [activeNote, aiSummary, closeAiSession, mode, setMarkdown, showToast]);

  const replaceWithAiPolish = useCallback(() => {
    if (!activeNote || !aiPolished.trim()) return;
    if (!window.confirm('用 AI 润色版替换当前正文？原来的内容可以用撤销恢复。')) return;
    setMarkdown(aiPolished);
    if (mode === 'rich') setRichLoadedId(null);
    closeAiSession(activeNote.id);
    showToast('已替换为润色版');
  }, [activeNote, aiPolished, closeAiSession, mode, setMarkdown, showToast]);

  const createTodoAction = useCallback(async (item: NoteAiTodo, index: number) => {
    const noteId = activeNote?.id;
    if (!noteId) return;
    const key = `todo:${index}:${item.title}`;
    if (createdActions[key] || creatingAction) return;
    setAiCreatingAction(noteId, key);
    try {
      await createTodoFromAi(item);
      markAiActionCreated(noteId, key);
      showToast('已加入待办');
    } catch (err) {
      setAiSessionError(noteId, err instanceof Error ? err.message : '创建待办失败');
    } finally {
      setAiCreatingAction(noteId, null);
    }
  }, [activeNote?.id, createdActions, creatingAction, markAiActionCreated, setAiCreatingAction, setAiSessionError, showToast]);

  const createEventAction = useCallback(async (item: NoteAiEvent, index: number) => {
    const noteId = activeNote?.id;
    if (!noteId) return;
    const key = `event:${index}:${item.title}`;
    if (createdActions[key] || creatingAction) return;
    if (!item.date) {
      setAiSessionError(noteId, '这条日程没有明确日期，先把它写清楚再试');
      return;
    }
    setAiCreatingAction(noteId, key);
    try {
      await createCalendarEventFromAi(item);
      markAiActionCreated(noteId, key);
      showToast('已加入日历');
    } catch (err) {
      setAiSessionError(noteId, err instanceof Error ? err.message : '创建日程失败');
    } finally {
      setAiCreatingAction(noteId, null);
    }
  }, [activeNote?.id, createdActions, creatingAction, markAiActionCreated, setAiCreatingAction, setAiSessionError, showToast]);

  const syncRichNow = useCallback(() => {
    if (!activeNote || locked || mode !== 'rich' || !richRef.current) return;
    const next = htmlToMarkdown(richRef.current.innerHTML);
    if (next !== activeNote.markdown) {
      setMarkdown(next);
    }
  }, [activeNote, locked, mode, setMarkdown]);

  const scheduleRichSync = useCallback(() => {
    if (richTimerRef.current) window.clearTimeout(richTimerRef.current);
    richTimerRef.current = window.setTimeout(() => {
      richTimerRef.current = null;
      syncRichNow();
    }, 380);
  }, [syncRichNow]);

  const switchMode = useCallback((next: EditorMode) => {
    if (next === mode) {
      if (next === 'split') {
        setEditorVisible(true);
        setPreviewVisible(true);
      }
      return;
    }
    if (mode === 'rich') syncRichNow();
    if (next === 'rich') setRichLoadedId(null);
    setMode(next);
    setEditorVisible(true);
    setPreviewVisible(next === 'split');
    setMenu(null);
  }, [mode, syncRichNow]);

  const selectNote = useCallback((note: MdNote) => {
    if (mode === 'rich') syncRichNow();
    setActiveNote(note.id);
    setTagInput(note.tags.join(', '));
    setMenu(null);
    if (note.trashedAt) setFilter({ kind: 'trash' });
  }, [mode, setActiveNote, syncRichNow]);

  const undo = useCallback(() => {
    if (!activeNote || locked) return;
    if (mode === 'rich') {
      document.execCommand('undo');
      scheduleRichSync();
      return;
    }
    const history = historyRef.current[activeNote.id];
    if (!history || history.index <= 0) return;
    history.index -= 1;
    updateNote(activeNote.id, { markdown: history.stack[history.index] });
    markSaving();
  }, [activeNote, locked, markSaving, mode, scheduleRichSync, updateNote]);

  const redo = useCallback(() => {
    if (!activeNote || locked) return;
    if (mode === 'rich') {
      document.execCommand('redo');
      scheduleRichSync();
      return;
    }
    const history = historyRef.current[activeNote.id];
    if (!history || history.index >= history.stack.length - 1) return;
    history.index += 1;
    updateNote(activeNote.id, { markdown: history.stack[history.index] });
    markSaving();
  }, [activeNote, locked, markSaving, mode, scheduleRichSync, updateNote]);

  const replaceSourceSelection = useCallback((prefix: string, suffix: string, placeholder: string) => {
    const el = textareaRef.current;
    if (!el || locked) return;
    const value = el.value;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const selected = value.slice(start, end);
    const body = selected || placeholder;
    const replacement = `${prefix}${body}${suffix}`;
    const next = `${value.slice(0, start)}${replacement}${value.slice(end)}`;
    setMarkdown(next);
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      textareaRef.current.focus();
      if (selected) {
        textareaRef.current.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
      } else {
        textareaRef.current.setSelectionRange(start + prefix.length, start + prefix.length + placeholder.length);
      }
    });
  }, [locked, setMarkdown]);

  const insertSourceText = useCallback((text: string) => {
    const el = textareaRef.current;
    if (!el || locked) return;
    const value = el.value;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = `${value.slice(0, start)}${text}${value.slice(end)}`;
    setMarkdown(next);
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(start + text.length, start + text.length);
    });
  }, [locked, setMarkdown]);

  const applyInline = useCallback((kind: InlineKind) => {
    if (!activeNote || locked) return;
    if (mode === 'rich') {
      const command = kind === 'strike' ? 'strikeThrough' : kind;
      document.execCommand(command, false);
      scheduleRichSync();
      return;
    }
    const markers: Record<InlineKind, [string, string]> = {
      bold: ['**', '**'],
      italic: ['*', '*'],
      underline: ['<u>', '</u>'],
      strike: ['~~', '~~'],
    };
    const placeholders: Record<InlineKind, string> = {
      bold: '加粗文字', italic: '斜体文字', underline: '下划线文字', strike: '删除线文字',
    };
    replaceSourceSelection(...markers[kind], placeholders[kind]);
  }, [activeNote, locked, mode, replaceSourceSelection, scheduleRichSync]);

  const rememberRichSelection = useCallback(() => {
    if (mode !== 'rich') return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (richRef.current?.contains(range.commonAncestorContainer)) {
      richSelectionRef.current = range.cloneRange();
    }
  }, [mode]);

  const restoreRichSelection = useCallback(() => {
    const range = richSelectionRef.current;
    if (!range) return;
    const selection = window.getSelection();
    if (!selection) return;
    richRef.current?.focus();
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  const applyColor = useCallback((target: ColorTarget, value: string) => {
    if (!activeNote || locked) return;
    if (mode === 'rich') {
      restoreRichSelection();
      document.execCommand('styleWithCSS', false, 'true');
      document.execCommand(target === 'text' ? 'foreColor' : 'hiliteColor', false, value);
      scheduleRichSync();
      setMenu(null);
      return;
    }
    const property = target === 'text' ? 'color' : 'background-color';
    replaceSourceSelection(
      `<span style="${property}: ${value}">`,
      '</span>',
      target === 'text' ? '彩色文字' : '底色文字',
    );
    setMenu(null);
  }, [activeNote, locked, mode, replaceSourceSelection, restoreRichSelection, scheduleRichSync]);

  const applyBlock = useCallback((kind: BlockKind) => {
    if (!activeNote || locked) return;
    if (mode === 'rich') {
      if (kind === 'h1' || kind === 'h2' || kind === 'h3') {
        document.execCommand('formatBlock', false, `<${kind}>`);
      } else if (kind === 'quote') {
        document.execCommand('formatBlock', false, '<blockquote>');
      } else if (kind === 'code') {
        document.execCommand('formatBlock', false, '<pre>');
      } else if (kind === 'ul') {
        document.execCommand('insertUnorderedList');
      } else if (kind === 'ol') {
        document.execCommand('insertOrderedList');
      } else if (kind === 'task') {
        document.execCommand('insertHTML', false, '<ul><li><input type="checkbox" disabled> 待办事项</li></ul>');
      } else {
        document.execCommand('formatBlock', false, '<p>');
      }
      scheduleRichSync();
      setMenu(null);
      return;
    }

    const el = textareaRef.current;
    if (!el) return;
    const value = el.value;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    const nextBreak = value.indexOf('\n', end);
    const lineEnd = nextBreak === -1 ? value.length : nextBreak;
    const block = value.slice(lineStart, lineEnd);
    const lines = block.split('\n');
    const strip = (line: string) => line.replace(/^(\s*)(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+\.\s+)/, '$1');
    const clean = lines.map(strip);
    let replacement = clean.join('\n');
    if (kind === 'h1') replacement = clean.map((line) => (line.trim() ? `# ${line.trim()}` : line)).join('\n');
    if (kind === 'h2') replacement = clean.map((line) => (line.trim() ? `## ${line.trim()}` : line)).join('\n');
    if (kind === 'h3') replacement = clean.map((line) => (line.trim() ? `### ${line.trim()}` : line)).join('\n');
    if (kind === 'quote') replacement = clean.map((line) => `> ${line}`).join('\n');
    if (kind === 'ul') replacement = clean.map((line) => (line.trim() ? `- ${line.trim()}` : line)).join('\n');
    if (kind === 'ol') replacement = clean.map((line, index) => (line.trim() ? `${index + 1}. ${line.trim()}` : line)).join('\n');
    if (kind === 'task') replacement = clean.map((line) => (line.trim() ? `- [ ] ${line.trim()}` : line)).join('\n');
    if (kind === 'code') replacement = `\`\`\`\n${clean.join('\n')}\n\`\`\``;
    const next = `${value.slice(0, lineStart)}${replacement}${value.slice(lineEnd)}`;
    setMarkdown(next);
    setMenu(null);
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(lineStart, lineStart + replacement.length);
    });
  }, [activeNote, locked, mode, scheduleRichSync, setMarkdown]);

  const insert = useCallback((kind: string) => {
    if (!activeNote || locked) return;
    setMenu(null);
    const today = new Date().toLocaleDateString('zh-CN');
    if (mode === 'rich') {
      const html: Record<string, string> = {
        link: '<a href="https://example.com">链接文字</a>',
        image: '<img src="https://placehold.co/800x450?text=Image" alt="图片说明">',
        table: '<table><thead><tr><th>列 1</th><th>列 2</th></tr></thead><tbody><tr><td>内容</td><td>内容</td></tr></tbody></table><p><br></p>',
        code: '<pre><code>代码</code></pre><p><br></p>',
        task: '<ul><li><input type="checkbox" disabled> 待办事项</li></ul>',
        quote: '<blockquote>引用内容</blockquote><p><br></p>',
        hr: '<hr><p><br></p>',
        date: `<p>${today}</p>`,
      };
      document.execCommand('insertHTML', false, html[kind] || '');
      scheduleRichSync();
      return;
    }
    const snippets: Record<string, string> = {
      link: '[链接文字](https://example.com)',
      image: '![图片说明](https://placehold.co/800x450?text=Image)',
      table: '\n| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |\n',
      code: '\n```\n代码\n```\n',
      task: '\n- [ ] 待办事项\n',
      quote: '\n> 引用内容\n',
      hr: '\n---\n',
      date: `\n${today}\n`,
    };
    insertSourceText(snippets[kind] || '');
  }, [activeNote, insertSourceText, locked, mode, scheduleRichSync]);

  const insertLink = useCallback(() => {
    if (!activeNote || locked) return;
    setMenu(null);
    if (mode === 'rich') {
      document.execCommand('createLink', false, 'https://example.com');
      scheduleRichSync();
      return;
    }
    replaceSourceSelection('[', '](https://example.com)', '链接文字');
  }, [activeNote, locked, mode, replaceSourceSelection, scheduleRichSync]);

  const saveTags = useCallback(() => {
    if (!activeNote || locked) return;
    const tags = tagInput.split(/[,，]/).map((tag) => tag.trim().replace(/^#+/, '').trim()).filter(Boolean);
    updateNote(activeNote.id, { tags: Array.from(new Set(tags)) });
    setTagInput(tags.join(', '));
    markSaving();
  }, [activeNote, locked, markSaving, tagInput, updateNote]);

  const handleExport = useCallback(() => {
    if (!activeNote) return;
    const blob = new Blob([activeNote.markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${escapeFileName(activeNote.title)}.md`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('已导出 Markdown');
  }, [activeNote, showToast]);

  const handleCopy = useCallback(async (kind: 'markdown' | 'html') => {
    if (!activeNote) return;
    const text = kind === 'markdown' ? activeNote.markdown : renderMarkdown(activeNote.markdown);
    await safeCopy(text);
    setMenu(null);
    showToast(kind === 'markdown' ? '已复制 Markdown' : '已复制渲染 HTML');
  }, [activeNote, showToast]);

  const handleClearFormat = useCallback(() => {
    if (!activeNote || locked) return;
    setMarkdown(plainText(activeNote.markdown));
    setMenu(null);
    showToast('已清空 Markdown 格式');
  }, [activeNote, locked, setMarkdown, showToast]);

  const handleImport = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const id = createNote({
      title: file.name.replace(/\.md$/i, ''),
      markdown: text,
      folderId: filter.kind === 'folder' ? filter.id : null,
    });
    setActiveNote(id);
    setFilter({ kind: 'all' });
    setMode('split');
    setEditorVisible(true);
    setPreviewVisible(true);
    event.target.value = '';
    showToast('已导入 Markdown');
  }, [createNote, filter, setActiveNote, showToast]);

  const handleNewNote = useCallback(() => {
    const folderId = filter.kind === 'folder' ? filter.id : null;
    const id = createNote({ title: '无标题笔记', folderId });
    setActiveNote(id);
    setFilter({ kind: 'all' });
    setMode('split');
    setEditorVisible(true);
    setPreviewVisible(true);
    showToast('已新建笔记');
  }, [createNote, filter, setActiveNote, showToast]);

  const handleSyncServerNotes = useCallback(async () => {
    if (syncingServerNotes) return;
    const keepId = useMdNotesStore.getState().activeNoteId;
    setSyncingServerNotes(true);
    try {
      const count = await syncAllServerNotesIntoLocal('md');
      if (keepId && useMdNotesStore.getState().notes.some((note) => note.id === keepId && !note.trashedAt)) {
        setActiveNote(keepId);
      }
      showToast(count > 0 ? `已从服务端同步 ${count} 篇笔记` : '服务端没有可同步的笔记');
    } catch {
      showToast('同步失败，请确认已登录');
    } finally {
      setSyncingServerNotes(false);
    }
  }, [setActiveNote, showToast, syncingServerNotes]);

  const handleDelete = useCallback(() => {
    if (!activeNote) return;
    if (!window.confirm(`把「${activeNote.title}」移入垃圾箱？`)) return;
    deleteNote(activeNote.id);
    showToast('已移入垃圾箱');
  }, [activeNote, deleteNote, showToast]);

  const handleNewFolder = useCallback(() => {
    const name = window.prompt('文件夹名称');
    if (!name?.trim()) return;
    const id = createFolder(name);
    if (id) setFilter({ kind: 'folder', id });
  }, [createFolder]);

  const handleRenameFolder = useCallback((id: string, current: string) => {
    const name = window.prompt('重命名文件夹', current);
    if (!name?.trim()) return;
    renameFolder(id, name);
  }, [renameFolder]);

  const handleDeleteFolder = useCallback((id: string) => {
    if (!window.confirm('删除这个文件夹？里面的笔记会回到“全部笔记”。')) return;
    deleteFolder(id);
    if (filter.kind === 'folder' && filter.id === id) setFilter({ kind: 'all' });
  }, [deleteFolder, filter]);

  const folderCounts = useMemo(() => {
    const map = new Map<string, number>();
    activeNotes.forEach((note) => {
      if (note.folderId) map.set(note.folderId, (map.get(note.folderId) || 0) + 1);
    });
    return map;
  }, [activeNotes]);

  const tagCounts = useMemo(() => {
    const map = new Map<string, number>();
    activeNotes.forEach((note) => note.tags.forEach((tag) => map.set(tag, (map.get(tag) || 0) + 1)));
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'));
  }, [activeNotes]);

  const filteredNotes = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = filter.kind === 'trash' ? trashedNotes : activeNotes;
    if (filter.kind === 'starred') list = list.filter((note) => note.starred);
    if (filter.kind === 'folder') list = list.filter((note) => note.folderId === filter.id);
    if (filter.kind === 'tag') list = list.filter((note) => note.tags.includes(filter.tag));
    if (q) {
      list = list.filter((note) =>
        note.title.toLowerCase().includes(q) ||
        note.markdown.toLowerCase().includes(q) ||
        note.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    }
    return [...list].sort((a, b) => Number(b.starred) - Number(a.starred) || b.updatedAt.localeCompare(a.updatedAt));
  }, [activeNotes, filter, query, trashedNotes]);

  const currentFolder = activeNote?.folderId ? folders.find((folder) => folder.id === activeNote.folderId) : null;
  const filterLabel = filter.kind === 'all' ? '全部笔记'
    : filter.kind === 'starred' ? '星标笔记'
    : filter.kind === 'trash' ? '垃圾箱'
    : filter.kind === 'folder' ? folders.find((folder) => folder.id === filter.id)?.name || '文件夹'
    : `#${filter.tag}`;
  const stats = activeNote ? markdownStats(activeNote.markdown) : { chars: 0, words: 0, lines: 0 };
  const previewHtml = activeNote ? renderMarkdown(activeNote.markdown) : '';
  const noteStyle = {
    '--mdn-font': FONT_MAP[activeNote?.font || 'sans'],
    '--mdn-size': `${activeNote?.fontSize || 15}px`,
  } as React.CSSProperties;
  const splitPanes = mode === 'split' && editorVisible && previewVisible;

  return (
    <div className={`mdn-shell${standalone ? ' mdn-standalone' : ''}`} style={noteStyle}>
      <aside className={`mdn-library${libraryVisible ? '' : ' is-hidden'}`} style={{ width: libraryVisible ? libraryWidth : undefined }}>
        <div className="mdn-library-head">
          <div className="mdn-brand">
            <span className="mdn-brand-mark"><FileText size={17} /></span>
            <div>
              <strong>笔记</strong>
              <small>{activeNotes.length} 篇笔记</small>
            </div>
          </div>
          <button type="button" className="mdn-new-btn" onClick={handleNewNote} title="新建笔记">
            <Plus size={16} />
          </button>
          <button
            type="button"
            className="mdn-sync-btn"
            onClick={handleSyncServerNotes}
            disabled={syncingServerNotes}
            title="从服务端同步笔记"
            aria-label="从服务端同步笔记"
          >
            {syncingServerNotes ? <Loader2 size={15} className="mdn-spin" /> : <RefreshCw size={15} />}
          </button>
          <button
            type="button"
            className="mdn-library-collapse"
            onClick={() => setLibraryVisible(false)}
            title="收起笔记目录"
            aria-label="收起笔记目录"
          >
            <PanelLeft size={15} />
          </button>
        </div>

        <div className="mdn-search">
          <Search size={14} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、正文、标签" />
          {query && <button type="button" onClick={() => setQuery('')} aria-label="清空搜索"><X size={13} /></button>}
        </div>

        <nav className="mdn-nav">
          <button type="button" className={filter.kind === 'all' ? 'is-active' : ''} onClick={() => setFilter({ kind: 'all' })}>
            <PanelLeft size={15} /> 全部笔记 <span>{activeNotes.length}</span>
          </button>
          <button type="button" className={filter.kind === 'starred' ? 'is-active' : ''} onClick={() => setFilter({ kind: 'starred' })}>
            <Star size={15} /> 星标 <span>{activeNotes.filter((note) => note.starred).length}</span>
          </button>
          <button type="button" className={filter.kind === 'trash' ? 'is-active' : ''} onClick={() => setFilter({ kind: 'trash' })}>
            <Trash2 size={15} /> 垃圾箱 <span>{trashedNotes.length}</span>
          </button>
        </nav>

        <div className="mdn-side-section">
          <div className="mdn-side-title">
            <span>文件夹</span>
            <button type="button" onClick={handleNewFolder} title="新建文件夹"><FolderPlus size={14} /></button>
          </div>
          <div className="mdn-folder-list">
            {folders.map((folder) => (
              <div key={folder.id} className={`mdn-folder-row${filter.kind === 'folder' && filter.id === folder.id ? ' is-active' : ''}`}>
                <button type="button" className="mdn-folder-main" onClick={() => setFilter({ kind: 'folder', id: folder.id })}>
                  <Folder size={14} />
                  <span>{folder.name}</span>
                  <em>{folderCounts.get(folder.id) || 0}</em>
                </button>
                <div className="mdn-folder-actions">
                  <button type="button" onClick={() => handleRenameFolder(folder.id, folder.name)} title="重命名"><Type size={11} /></button>
                  <button type="button" onClick={() => handleDeleteFolder(folder.id)} title="删除文件夹"><X size={11} /></button>
                </div>
              </div>
            ))}
            {folders.length === 0 && <p className="mdn-side-empty">还没有文件夹</p>}
          </div>
        </div>

        {tagCounts.length > 0 && (
          <div className="mdn-side-section mdn-tag-section">
            <div className="mdn-side-title"><span>标签</span></div>
            <div className="mdn-tag-cloud">
              {tagCounts.slice(0, 12).map(([tag, count]) => (
                <button
                  key={tag}
                  type="button"
                  className={filter.kind === 'tag' && filter.tag === tag ? 'is-active' : ''}
                  onClick={() => setFilter({ kind: 'tag', tag })}
                >
                  <Hash size={11} />{tag}<em>{count}</em>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mdn-note-list-wrap">
          <div className="mdn-side-title">
            <span>{filterLabel}</span>
            <em>{filteredNotes.length}</em>
          </div>
          <div className="mdn-note-list">
            {filteredNotes.map((note) => (
              <button
                type="button"
                key={note.id}
                className={`mdn-note-item${note.id === activeNoteId ? ' is-active' : ''}`}
                onClick={() => selectNote(note)}
              >
                <div className="mdn-note-item-top">
                  <strong>{note.title || '无标题笔记'}</strong>
                  {note.starred && <Star size={11} className="mdn-starred" />}
                </div>
                <p>{noteExcerpt(note)}</p>
                <div className="mdn-note-meta">
                  <span>{formatDate(note.updatedAt)}</span>
                  {note.folderId && <span>{folders.find((folder) => folder.id === note.folderId)?.name}</span>}
                  {note.tags[0] && <span>#{note.tags[0]}</span>}
                </div>
              </button>
            ))}
            {filteredNotes.length === 0 && (
              <div className="mdn-list-empty">
                <FilePlus2 size={22} />
                <p>{filter.kind === 'trash' ? '垃圾箱是空的' : '没有匹配的笔记'}</p>
              </div>
            )}
          </div>
        </div>
      </aside>

      {libraryVisible && (
        <div
          className="mdn-splitter mdn-library-splitter"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整笔记目录宽度"
          onPointerDown={startLibraryResize}
          onDoubleClick={() => setLibraryWidth(MDN_LIBRARY_DEFAULT_WIDTH)}
        />
      )}

      <main className="mdn-main">
        {!activeNote ? (
          <div className="mdn-empty-doc">
            <FileText size={34} />
            <h2>选择一篇笔记开始</h2>
            <p>或者新建一篇 Markdown 笔记。</p>
            <button type="button" className="mdn-primary" onClick={handleNewNote}><Plus size={15} /> 新建笔记</button>
          </div>
        ) : (
          <>
            <header className="mdn-doc-head">
              <div className="mdn-doc-topline">
                <div className="mdn-breadcrumb">
                  <span>笔记</span><i>/</i><span>{currentFolder?.name || filterLabel}</span>
                </div>
                <div className="mdn-doc-actions">
                  <span className={`mdn-save-state${saveState === 'saving' ? ' is-saving' : ''}`}>
                    {saveState === 'saving' ? <RotateCcw size={12} /> : <Check size={12} />}
                    {saveState === 'saving' ? '保存中' : '已保存'}
                  </span>
                  <IconButton label={libraryVisible ? '收起笔记目录' : '展开笔记目录'} onClick={() => setLibraryVisible((value) => !value)} active={libraryVisible}>
                    <PanelLeft size={16} />
                  </IconButton>
                  {!standalone && (
                    <IconButton label="在新窗口打开笔记工作台" onClick={openInWindow}>
                      <Maximize2 size={16} />
                    </IconButton>
                  )}
                  <IconButton label={activeNote.starred ? '取消星标' : '星标'} onClick={() => toggleStar(activeNote.id)} active={activeNote.starred}>
                    <Star size={16} fill={activeNote.starred ? 'currentColor' : 'none'} />
                  </IconButton>
                  <IconButton label="创建副本" onClick={() => duplicateNote(activeNote.id)}>
                    <Copy size={16} />
                  </IconButton>
                  <IconButton label="导入 Markdown" onClick={() => importRef.current?.click()}>
                    <Upload size={16} />
                  </IconButton>
                  <IconButton label="导出 Markdown" onClick={handleExport}>
                    <Download size={16} />
                  </IconButton>
                  <IconButton label="移入垃圾箱" onClick={handleDelete} disabled={locked}>
                    <Trash2 size={16} />
                  </IconButton>
                  <input ref={importRef} type="file" accept=".md,text/markdown,text/plain" hidden onChange={handleImport} />
                </div>
              </div>
              <input
                className="mdn-title-input"
                value={activeNote.title}
                onChange={(event) => { updateNote(activeNote.id, { title: event.target.value }); markSaving(); }}
                readOnly={locked}
                placeholder="无标题笔记"
                aria-label="笔记标题"
              />
              <div className="mdn-doc-meta">
                <label>
                  <Folder size={13} />
                  <select value={activeNote.folderId || ''} onChange={(event) => moveNoteToFolder(activeNote.id, event.target.value || null)} disabled={locked}>
                    <option value="">未分类</option>
                    {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                  </select>
                </label>
                <label className="mdn-tags-field">
                  <Hash size={13} />
                  <input
                    value={tagInput}
                    onChange={(event) => setTagInput(event.target.value)}
                    onBlur={saveTags}
                    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); saveTags(); } }}
                    placeholder="标签，用逗号分隔"
                    readOnly={locked}
                  />
                </label>
                <span className="mdn-meta-stat">{stats.words} 字 · {stats.lines} 行</span>
                <div className="mdn-mode-switch" role="group" aria-label="编辑模式">
                  <button type="button" className={mode === 'split' ? 'is-active' : ''} onClick={() => switchMode('split')}><Columns2 size={13} /> 分栏</button>
                  <button type="button" className={mode === 'source' ? 'is-active' : ''} onClick={() => switchMode('source')}><PanelLeft size={13} /> 源码</button>
                  <button type="button" className={mode === 'rich' ? 'is-active' : ''} onClick={() => switchMode('rich')}><PanelRight size={13} /> 富文本</button>
                </div>
              </div>
            </header>

            {locked && (
              <div className="mdn-trash-banner">
                <Trash2 size={15} />
                <span>这篇笔记在垃圾箱里，恢复后才能继续编辑。</span>
                <button type="button" onClick={() => restoreNote(activeNote.id)}><RotateCcw size={13} /> 恢复</button>
                <button type="button" className="mdn-danger-link" onClick={() => { if (window.confirm('永久删除这篇笔记？')) permanentDeleteNote(activeNote.id); }}>永久删除</button>
              </div>
            )}

            <div className="mdn-toolbar" ref={toolbarRef} onMouseDown={(event) => { rememberRichSelection(); event.preventDefault(); }} role="toolbar" aria-label="笔记编辑工具栏">
              <div className="mdn-tool-group">
                <IconButton label="撤销" onClick={undo} disabled={locked}><Undo2 size={18} /></IconButton>
                <IconButton label="重做" onClick={redo} disabled={locked}><Redo2 size={18} /></IconButton>
              </div>
              <span className="mdn-toolbar-divider" />
              <div className="mdn-menu-wrap">
                <button type="button" className="mdn-insert-btn" onClick={() => setMenu(menu === 'insert' ? null : 'insert')} aria-expanded={menu === 'insert'}>
                  <span>+</span>插入<ChevronDown size={13} />
                </button>
                {menu === 'insert' && (
                  <div className="mdn-menu mdn-insert-menu">
                    <MenuLabel>插入内容</MenuLabel>
                    <button type="button" onClick={insertLink}><Link2 size={15} /><span>链接</span><kbd>⌘K</kbd></button>
                    <button type="button" onClick={() => insert('image')}><ImageIcon size={15} /><span>图片</span></button>
                    <button type="button" onClick={() => insert('table')}><Table2 size={15} /><span>表格</span></button>
                    <button type="button" onClick={() => insert('code')}><Code2 size={15} /><span>代码块</span></button>
                    <button type="button" onClick={() => insert('task')}><ListTodo size={15} /><span>任务清单</span></button>
                    <button type="button" onClick={() => insert('quote')}><Quote size={15} /><span>引用</span></button>
                    <button type="button" onClick={() => insert('hr')}><MoreHorizontal size={15} /><span>分割线</span></button>
                    <button type="button" onClick={() => insert('date')}><CalendarDays size={15} /><span>今天日期</span></button>
                  </div>
                )}
              </div>
              <span className="mdn-toolbar-divider" />
              <div className="mdn-menu-wrap">
                <MenuButton
                  open={menu === 'block'}
                  onClick={() => setMenu(menu === 'block' ? null : 'block')}
                  label={<><Type size={15} /> 正文</>}
                />
                {menu === 'block' && (
                  <div className="mdn-menu mdn-block-menu">
                    {BLOCK_OPTIONS.map((option) => (
                      <button key={option.value} type="button" onClick={() => applyBlock(option.value)}>
                        {option.icon}<span>{option.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="mdn-menu-wrap">
                <MenuButton
                  open={menu === 'font'}
                  onClick={() => setMenu(menu === 'font' ? null : 'font')}
                  label={<><span className="mdn-font-icon">Aa</span>{FONT_OPTIONS.find((item) => item.value === activeNote.font)?.label}</>}
                />
                {menu === 'font' && (
                  <div className="mdn-menu mdn-small-menu">
                    {FONT_OPTIONS.map((option) => (
                      <button key={option.value} type="button" className={activeNote.font === option.value ? 'is-selected' : ''} onClick={() => { updateNote(activeNote.id, { font: option.value }); setMenu(null); }}>
                        <span style={{ fontFamily: FONT_MAP[option.value] }}>{option.label}</span>
                        {activeNote.font === option.value && <Check size={13} />}
                      </button>
                    ))}
                    <div className="mdn-menu-note">只影响当前笔记的阅读显示，不写入 Markdown</div>
                  </div>
                )}
              </div>
              <div className="mdn-menu-wrap mdn-size-menu-wrap">
                <MenuButton
                  open={menu === 'size'}
                  onClick={() => setMenu(menu === 'size' ? null : 'size')}
                  label={<span className="mdn-size-label">{activeNote.fontSize}</span>}
                />
                {menu === 'size' && (
                  <div className="mdn-menu mdn-small-menu mdn-size-menu">
                    {SIZE_OPTIONS.map((size) => (
                      <button key={size} type="button" className={activeNote.fontSize === size ? 'is-selected' : ''} onClick={() => { updateNote(activeNote.id, { fontSize: size }); setMenu(null); }}>
                        <span>{size}</span>
                        {activeNote.fontSize === size && <Check size={13} />}
                      </button>
                    ))}
                    <div className="mdn-menu-note">只影响当前笔记的阅读显示</div>
                  </div>
                )}
              </div>
              <span className="mdn-toolbar-divider" />
              <div className="mdn-tool-group">
                <IconButton label="加粗 (Ctrl+B)" onClick={() => applyInline('bold')} disabled={locked}><Bold size={18} /></IconButton>
                <IconButton label="斜体 (Ctrl+I)" onClick={() => applyInline('italic')} disabled={locked}><Italic size={18} /></IconButton>
                <IconButton label="下划线 (Ctrl+U)" onClick={() => applyInline('underline')} disabled={locked}><Underline size={18} /></IconButton>
                <IconButton label="删除线" onClick={() => applyInline('strike')} disabled={locked}><Strikethrough size={18} /></IconButton>
              </div>
              <span className="mdn-toolbar-divider" />
              <div className="mdn-menu-wrap">
                <MenuButton
                  open={menu === 'color'}
                  onClick={() => setMenu(menu === 'color' ? null : 'color')}
                  label={<><Palette size={15} /> 文字色</>}
                />
                {menu === 'color' && (
                  <ColorMenu
                    title="文字颜色"
                    colors={TEXT_COLORS}
                    onPick={(value) => applyColor('text', value)}
                    onRememberSelection={rememberRichSelection}
                  />
                )}
              </div>
              <div className="mdn-menu-wrap">
                <MenuButton
                  open={menu === 'background'}
                  onClick={() => setMenu(menu === 'background' ? null : 'background')}
                  label={<><Highlighter size={15} /> 底色</>}
                />
                {menu === 'background' && (
                  <ColorMenu
                    title="文字背景色"
                    colors={HIGHLIGHT_COLORS}
                    onPick={(value) => applyColor('background', value)}
                    onRememberSelection={rememberRichSelection}
                  />
                )}
              </div>
              <div className="mdn-toolbar-spacer" />
              <button
                type="button"
                className={`mdn-ai-trigger${aiOpen ? ' is-active' : ''}`}
                onClick={() => {
                  if (!activeNoteId) return;
                  if (aiOpen) {
                    closeAiSession(activeNoteId);
                    return;
                  }
                  openAiSession(activeNoteId);
                }}
                disabled={locked}
                title="打开笔记 AI 助手"
              >
                <Sparkles size={15} />
                AI
              </button>
              <div className="mdn-menu-wrap">
                <MenuButton open={menu === 'more'} onClick={() => setMenu(menu === 'more' ? null : 'more')} label="更多" />
                {menu === 'more' && (
                  <div className="mdn-menu mdn-more-menu">
                    <button type="button" onClick={() => handleCopy('markdown')}><Copy size={15} /><span>复制 Markdown</span></button>
                    <button type="button" onClick={() => handleCopy('html')}><Code2 size={15} /><span>复制渲染 HTML</span></button>
                    <button type="button" onClick={handleExport}><Download size={15} /><span>导出 .md</span></button>
                    <button type="button" onClick={() => importRef.current?.click()}><Upload size={15} /><span>导入 .md</span></button>
                    <button type="button" onClick={handleClearFormat}><RotateCcw size={15} /><span>清空格式</span></button>
                  </div>
                )}
              </div>
            </div>

            <div ref={canvasRef} className={`mdn-canvas mdn-mode-${mode}${splitPanes ? ' is-split' : ''}`}>
              {mode === 'rich' ? (
                <section className="mdn-rich-pane">
                  <div className="mdn-pane-label">
                    <PanelRight size={13} /> 富文本编辑 <span>改动会自动转回 Markdown</span>
                  </div>
                  <div
                    ref={richRef}
                    className="mdn-rich-editor"
                    contentEditable={!locked}
                    suppressContentEditableWarning
                    spellCheck={false}
                    onInput={scheduleRichSync}
                    onBlur={syncRichNow}
                    onKeyDown={(event) => {
                      const meta = event.metaKey || event.ctrlKey;
                      if (!meta) return;
                      const key = event.key.toLowerCase();
                      if (key === 's') {
                        event.preventDefault();
                        void saveNow();
                      } else if (key === 'b' || key === 'i' || key === 'u') {
                        event.preventDefault();
                        applyInline(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline');
                      } else if (key === 'k') {
                        event.preventDefault();
                        insertLink();
                      }
                    }}
                  />
                </section>
              ) : editorVisible ? (
                <section className="mdn-source-pane" style={splitPanes ? { flexBasis: `${splitRatio}%` } : undefined}>
                  <div className="mdn-pane-label">
                    <Code2 size={13} /> Markdown 源码
                    {mode === 'split' && (
                      <div className="mdn-pane-tools">
                        <button type="button" title="编辑区占满" onClick={() => { setEditorVisible(true); setPreviewVisible(false); }}>
                          <Maximize2 size={12} />
                        </button>
                        <button type="button" title="隐藏编辑区" disabled={!previewVisible} onClick={() => setEditorVisible(false)}>
                          <EyeOff size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                  <textarea
                    ref={textareaRef}
                    className="mdn-source-editor"
                    value={activeNote.markdown}
                    readOnly={locked}
                    spellCheck={false}
                    onChange={(event) => setMarkdown(event.target.value)}
                    onKeyDown={(event) => {
                      const meta = event.metaKey || event.ctrlKey;
                      if (meta && event.key.toLowerCase() === 's') {
                        event.preventDefault();
                        void saveNow();
                      } else if (meta && event.key.toLowerCase() === 'b') {
                        event.preventDefault();
                        applyInline('bold');
                      } else if (meta && event.key.toLowerCase() === 'i') {
                        event.preventDefault();
                        applyInline('italic');
                      } else if (meta && event.key.toLowerCase() === 'u') {
                        event.preventDefault();
                        applyInline('underline');
                      } else if (meta && event.key.toLowerCase() === 'k') {
                        event.preventDefault();
                        insertLink();
                      }
                    }}
                    placeholder="在这里写 Markdown…"
                    aria-label="Markdown 源码编辑器"
                  />
                </section>
              ) : null}

              {splitPanes && (
                <div
                  className="mdn-splitter mdn-canvas-splitter"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="调整源码与预览宽度"
                  onPointerDown={startSplitResize}
                  onDoubleClick={() => setSplitRatio(50)}
                />
              )}

              {mode === 'split' && previewVisible && (
                <aside className="mdn-preview-pane" style={splitPanes ? { flexBasis: `${100 - splitRatio}%` } : undefined}>
                  <div className="mdn-pane-label">
                    <Eye size={13} /> 实时预览
                    <div className="mdn-pane-tools">
                      <button type="button" title="预览占满" onClick={() => { setEditorVisible(false); setPreviewVisible(true); }}>
                        <Maximize2 size={12} />
                      </button>
                      <button type="button" title="隐藏预览" onClick={() => { setPreviewVisible(false); setEditorVisible(true); }}>
                        <EyeOff size={12} />
                      </button>
                    </div>
                  </div>
                  <article className="mdn-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
                </aside>
              )}
            </div>

            {aiOpen && (
              <aside className="mdn-ai-panel" aria-label="笔记 AI 助手">
                <div className="mdn-ai-head">
                  <div className="mdn-ai-heading">
                    <span className="mdn-ai-mark"><Sparkles size={15} /></span>
                    <div>
                      <strong>笔记 AI</strong>
                      <small>读当前正文，结果不自动写库</small>
                    </div>
                  </div>
                  <button type="button" className="mdn-ai-close" onClick={() => activeNoteId && closeAiSession(activeNoteId)} aria-label="关闭 AI 助手">
                    <X size={15} />
                  </button>
                </div>

                <div className="mdn-ai-tabs" role="tablist" aria-label="AI 操作">
                  {AI_TABS.map((tab) => (
                    <button
                      type="button"
                      key={tab.value}
                      className={aiView === tab.value ? 'is-active' : ''}
                      onClick={() => void runAi(tab.value)}
                      disabled={Boolean(aiLoading) || locked}
                    >
                      {aiLoading === tab.value ? <Loader2 size={14} className="mdn-spin" /> : tab.icon}
                      {tab.label}
                    </button>
                  ))}
                </div>

                {aiError && (
                  <div className="mdn-ai-error" role="alert">
                    <span>{aiError}</span>
                    <button type="button" onClick={() => void runAi(aiView)} disabled={Boolean(aiLoading) || locked}>重试</button>
                  </div>
                )}

                {aiLoading ? (
                  <div className="mdn-ai-loading">
                    <Loader2 size={16} className="mdn-spin" />
                    <span>{aiLoading === 'summary' ? '正在压缩这篇笔记…' : aiLoading === 'polish' ? '正在重写正文…' : '正在找待办和日程…'}</span>
                  </div>
                ) : (
                  <>
                    {aiView === 'summary' && aiSummary && (
                      <div className="mdn-ai-result">
                        <div className="mdn-ai-result-label"><ListChecks size={13} /> 摘要预览</div>
                        <div className="mdn-ai-summary" dangerouslySetInnerHTML={{ __html: renderMarkdown(aiSummary) }} />
                        <div className="mdn-ai-result-actions">
                          <button type="button" className="mdn-primary" onClick={insertAiSummary} disabled={locked}>
                            <Plus size={14} /> 插入到笔记
                          </button>
                          <button type="button" className="mdn-ai-ghost" onClick={() => void runAi('summary')} disabled={locked}>重新生成</button>
                        </div>
                      </div>
                    )}

                    {aiView === 'polish' && aiPolished && (
                      <div className="mdn-ai-result">
                        <div className="mdn-ai-result-label"><Wand2 size={13} /> 润色预览</div>
                        <pre className="mdn-ai-polish">{aiPolished}</pre>
                        <div className="mdn-ai-result-actions">
                          <button type="button" className="mdn-primary" onClick={replaceWithAiPolish} disabled={locked}>替换正文</button>
                          <button type="button" className="mdn-ai-ghost" onClick={() => void runAi('polish')} disabled={locked}>重新生成</button>
                        </div>
                      </div>
                    )}

                    {aiView === 'actions' && (
                      <div className="mdn-ai-result">
                        {aiTodos.length === 0 && aiEvents.length === 0 ? (
                          <div className="mdn-ai-empty">
                            <CalendarPlus size={22} />
                            <p>没有发现明确的待办或日程。</p>
                            <span>把时间、动作写清楚一点，再试一次。</span>
                          </div>
                        ) : (
                          <>
                            {aiTodos.length > 0 && (
                              <div className="mdn-ai-action-group">
                                <div className="mdn-ai-result-label"><ListTodo size={13} /> 待办建议 <span>{aiTodos.length}</span></div>
                                {aiTodos.map((item, index) => {
                                  const key = `todo:${index}:${item.title}`;
                                  return (
                                    <div className="mdn-ai-action-item" key={key}>
                                      <div className="mdn-ai-action-main">
                                        <strong>{item.title}</strong>
                                        <span>{item.due_date || '未指定日期'} · {PRIORITY_LABEL[item.priority || 'green']}</span>
                                        {item.description && <p>{item.description}</p>}
                                      </div>
                                      <button
                                        type="button"
                                        className={`mdn-ai-add${createdActions[key] ? ' is-done' : ''}`}
                                        onClick={() => void createTodoAction(item, index)}
                                        disabled={Boolean(createdActions[key]) || Boolean(creatingAction)}
                                      >
                                        {createdActions[key] ? <Check size={13} /> : creatingAction === key ? <Loader2 size={13} className="mdn-spin" /> : <Plus size={13} />}
                                        {createdActions[key] ? '已加入' : '待办'}
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {aiEvents.length > 0 && (
                              <div className="mdn-ai-action-group">
                                <div className="mdn-ai-result-label"><CalendarDays size={13} /> 日程建议 <span>{aiEvents.length}</span></div>
                                {aiEvents.map((item, index) => {
                                  const key = `event:${index}:${item.title}`;
                                  const time = [item.start_time, item.end_time].filter(Boolean).join('–');
                                  return (
                                    <div className="mdn-ai-action-item" key={key}>
                                      <div className="mdn-ai-action-main">
                                        <strong>{item.title}</strong>
                                        <span>{item.date || '未指定日期'}{time ? ` · ${time}` : ''}</span>
                                        {item.description && <p>{item.description}</p>}
                                      </div>
                                      <button
                                        type="button"
                                        className={`mdn-ai-add${createdActions[key] ? ' is-done' : ''}`}
                                        onClick={() => void createEventAction(item, index)}
                                        disabled={Boolean(createdActions[key]) || Boolean(creatingAction)}
                                      >
                                        {createdActions[key] ? <Check size={13} /> : creatingAction === key ? <Loader2 size={13} className="mdn-spin" /> : <Plus size={13} />}
                                        {createdActions[key] ? '已加入' : '日历'}
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </>
                        )}
                        <p className="mdn-ai-disclaimer">只生成建议；点「待办」或「日历」才会写入，不会自动批量创建。</p>
                      </div>
                    )}

                    {!aiError && !aiLoading && aiView !== 'actions' && !aiSummary && !aiPolished && aiTodos.length === 0 && aiEvents.length === 0 && (
                      <div className="mdn-ai-idle">
                        <Sparkles size={20} />
                        <p>选择一个操作，AI 会读取当前笔记正文。</p>
                        <span>字体、字号和本地保存状态不会发给模型。</span>
                      </div>
                    )}
                  </>
                )}
              </aside>
            )}

            <footer className="mdn-statusbar">
              <span><FileText size={12} /> Markdown 源文件</span>
              <span>{saveState === 'saving' ? '正在写入 IndexedDB…' : `更新于 ${formatDate(activeNote.updatedAt)}`}</span>
              <span className="mdn-status-spacer" />
              <span>{stats.chars} 字符</span>
              <span>{stats.words} 字</span>
              <span>{stats.lines} 行</span>
              <span className="mdn-status-hint">Ctrl+S 保存 · Ctrl+B 加粗</span>
            </footer>
          </>
        )}
      </main>

      {toast && <div className="mdn-toast" role="status"><Check size={14} />{toast}</div>}
    </div>
  );
};

const MenuLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="mdn-menu-label">{children}</div>
);
