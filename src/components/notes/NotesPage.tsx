import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Clock, Filter, GripVertical, Pin, Plus, RotateCcw, Save, Search, SlidersHorizontal, StickyNote, Tag, Trash2, X } from 'lucide-react';
import { CollapsibleToolPanel, EmptyState, PageTitle } from '../shared';
import { useNotesStore, useUIStore } from '../../stores';
import type { Note, NoteColor, NoteInsertPosition } from '../../stores/notesStore';
import { getNoteTags, NOTE_COLOR_OPTIONS } from '../../stores/notesStore';
import { playInteractionSound } from '../../lib/sounds';

const COLOR_DOT = Object.fromEntries(NOTE_COLOR_OPTIONS.map((item) => [item.value, item.dot])) as Record<NoteColor, string>;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}

export const NotesPage: React.FC = () => {
  const notes = useNotesStore((s) => s.notes);
  useNotesStore((s) => s.trash);
  const addNote = useNotesStore((s) => s.addNote);
  const upsertTodayAiNote = useNotesStore((s) => s.upsertTodayAiNote);
  const updateNote = useNotesStore((s) => s.updateNote);
  const reorderNotes = useNotesStore((s) => s.reorderNotes);
  const deleteNote = useNotesStore((s) => s.deleteNote);
  const restoreNote = useNotesStore((s) => s.restoreNote);
  const permanentDeleteNote = useNotesStore((s) => s.permanentDeleteNote);
  const clearTrash = useNotesStore((s) => s.clearTrash);
  const togglePin = useNotesStore((s) => s.togglePin);
  const getTrashedNotes = useNotesStore((s) => s.getTrashedNotes);
  const setActiveNoteId = useUIStore((s) => s.setActiveNoteId);
  const noteEnterBehavior = useUIStore((s) => s.noteEnterBehavior);
  const contentInputRef = useRef<HTMLTextAreaElement>(null);

  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState<string>('all');
  const [activeColor, setActiveColor] = useState<NoteColor | 'all'>('all');
  const [edit, setEdit] = useState<{ id: string | null; title: string; content: string; color: NoteColor; tag: string }>({ id: null, title: '', content: '', color: 'sticky-yellow', tag: '' });
  const [showTrash, setShowTrash] = useState(false);
  const [collapsedTrash, setCollapsedTrash] = useState(false);
  const [collapsedFilters, setCollapsedFilters] = useState(false);
  const [showToolbar, setShowToolbar] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [insertPosition, setInsertPosition] = useState<NoteInsertPosition>('after');
  const [hoveredNoteId, setHoveredNoteId] = useState<string | null>(null);

  const trashedNotes = getTrashedNotes();

  const tagStats = useMemo(() => {
    const stats = new Map<string, number>();
    notes.forEach((note) => {
      getNoteTags(note).forEach((tag) => {
        stats.set(tag, (stats.get(tag) || 0) + 1);
      });
    });
    return Array.from(stats.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }, [notes]);

  const colorStats = useMemo(() => {
    return NOTE_COLOR_OPTIONS.map((color) => ({
      ...color,
      count: notes.filter((note) => note.color === color.value).length,
    }));
  }, [notes]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return notes.filter((note) => {
      const noteTags = getNoteTags(note);
      if (activeTag !== 'all' && !noteTags.includes(activeTag)) return false;
      if (activeColor !== 'all' && note.color !== activeColor) return false;
      if (!q) return true;
      return (
        note.title.toLowerCase().includes(q) ||
        note.content.toLowerCase().includes(q) ||
        noteTags.some((tag) => tag.toLowerCase().includes(q))
      );
    });
  }, [activeColor, activeTag, notes, search]);

  const pinned = useMemo(() => filtered.filter((note) => note.pinned), [filtered]);
  const unpinned = useMemo(() => filtered.filter((note) => !note.pinned), [filtered]);

  const startEdit = useCallback((note: Note) => {
    setActiveNoteId(note.id);
    setEdit({ id: note.id, title: note.title, content: note.content, color: note.color, tag: note.tag });
  }, [setActiveNoteId]);

  const startNew = useCallback(() => {
    const id = addNote({
      title: '新笔记',
      content: '',
      color: activeColor === 'all' ? 'sticky-yellow' : activeColor,
      tag: activeTag === 'all' ? '' : activeTag,
    });
    const created = useNotesStore.getState().notes.find((note) => note.id === id);
    if (created) startEdit(created);
    playInteractionSound('success');
  }, [activeColor, activeTag, addNote, startEdit]);

  const createTodayAiNote = useCallback(() => {
    const id = upsertTodayAiNote();
    const note = useNotesStore.getState().notes.find((item) => item.id === id);
    if (note) {
      setActiveTag('all');
      setActiveColor('all');
      startEdit(note);
      playInteractionSound('success');
    }
  }, [startEdit, upsertTodayAiNote]);

  const saveEdit = useCallback(() => {
    if (!edit.id) return;
    updateNote(edit.id, {
      title: edit.title.trim() || '未命名笔记',
      content: edit.content,
      color: edit.color,
      tag: edit.tag,
    });
    setActiveNoteId(edit.id);
    setEdit((prev) => ({ ...prev, id: null }));
    playInteractionSound('save');
  }, [edit, setActiveNoteId, updateNote]);

  const handleEditContentKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter') return;
    const shouldSave = noteEnterBehavior === 'enter_save' ? !event.altKey : event.altKey;
    if (!shouldSave) {
      event.preventDefault();
      const target = event.currentTarget;
      const { selectionStart, selectionEnd } = target;
      const newValue = target.value.slice(0, selectionStart) + '\n' + target.value.slice(selectionEnd);
      setEdit((prev) => ({ ...prev, content: newValue }));
      requestAnimationFrame(() => {
        const el = contentInputRef.current;
        if (el) el.selectionStart = el.selectionEnd = selectionStart + 1;
      });
      return;
    }
    event.preventDefault();
    saveEdit();
  }, [noteEnterBehavior, saveEdit]);

  const handleEditTitleKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    contentInputRef.current?.focus();
  }, []);

  const handleDelete = useCallback((id: string) => {
    deleteNote(id);
    if (edit.id === id) setEdit((prev) => ({ ...prev, id: null }));
    if (edit.id === id) setActiveNoteId(null);
    playInteractionSound('delete');
  }, [deleteNote, edit.id, setActiveNoteId]);

  const handleNoteDragOver = useCallback((event: React.DragEvent<HTMLDivElement>, noteId: string) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const dragged = dragId ? notes.find((note) => note.id === dragId) : null;
    const target = notes.find((note) => note.id === noteId);
    if (dragged && target && dragged.pinned !== target.pinned) {
      event.dataTransfer.dropEffect = 'none';
      setOverId(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const position = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
    setOverId(noteId);
    setInsertPosition(position);
  }, [dragId, notes]);

  const handleNoteDrop = useCallback((event: React.DragEvent<HTMLDivElement>, noteId: string) => {
    event.preventDefault();
    if (dragId && dragId !== noteId) {
      const dragged = notes.find((note) => note.id === dragId);
      const target = notes.find((note) => note.id === noteId);
      if (dragged && target && dragged.pinned === target.pinned) {
        reorderNotes(dragId, noteId, insertPosition);
      }
      playInteractionSound('tap');
    }
    setDragId(null);
    setOverId(null);
  }, [dragId, insertPosition, notes, reorderNotes]);

  const handleNoteDragEnd = useCallback(() => {
    setDragId(null);
    setOverId(null);
  }, []);

  const resetFilters = () => {
    setSearch('');
    setActiveTag('all');
    setActiveColor('all');
  };

  const activeColorLabel = activeColor === 'all'
    ? '全部'
    : NOTE_COLOR_OPTIONS.find((item) => item.value === activeColor)?.label || '全部';
  const activeTagLabel = activeTag === 'all' ? '全部' : activeTag;

  const renderCard = (note: Note) => {
    if (edit.id === note.id) {
      return (
        <div key={note.id} className={`${edit.color} rounded-xl p-4 col-span-1 sm:col-span-2 lg:col-span-2`}>
          <input
            type="text"
            value={edit.title}
            onChange={(event) => setEdit((prev) => ({ ...prev, title: event.target.value }))}
            onKeyDown={handleEditTitleKeyDown}
            className="w-full text-sm font-semibold text-[var(--text-primary)] bg-transparent outline-none border-b border-[var(--border-medium)] pb-1 mb-2"
            placeholder="标题"
            autoFocus
          />
          <textarea
            ref={contentInputRef}
            value={edit.content}
            onChange={(event) => setEdit((prev) => ({ ...prev, content: event.target.value }))}
            onKeyDown={handleEditContentKeyDown}
            className="w-full text-xs text-[#374151] bg-transparent outline-none resize-none min-h-[120px] leading-relaxed"
            placeholder={noteEnterBehavior === 'enter_save' ? '写点什么... Enter 保存，Alt+Enter 换行' : '写点什么... Enter 换行，Alt+Enter 保存'}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 mt-2 pt-2 border-t border-[var(--border-medium)]/30">
            <div className="flex items-center gap-1.5">
              {NOTE_COLOR_OPTIONS.map((color) => (
                <button
                  key={color.value}
                  onClick={() => setEdit((prev) => ({ ...prev, color: color.value }))}
                  className={`w-5 h-5 rounded-full border-2 transition-all ${edit.color === color.value ? 'border-[#1a1a1a] scale-110' : 'border-white/70'}`}
                  style={{ backgroundColor: color.dot }}
                  title={color.label}
                />
              ))}
              <input
                type="text"
                value={edit.tag}
                onChange={(event) => setEdit((prev) => ({ ...prev, tag: event.target.value }))}
                className="ml-2 text-xs px-2 py-1 bg-white/70 rounded-full outline-none w-24"
                placeholder="标签"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => { setActiveNoteId(note.id); setEdit((prev) => ({ ...prev, id: null })); }}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-white/65 hover:text-[var(--danger)]"
                title="取消"
                aria-label="取消编辑"
              >
                <X size={14} strokeWidth={2.2} />
              </button>
              <button
                type="button"
                onClick={saveEdit}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[var(--success)] text-white shadow-sm transition-colors hover:bg-[#15803d]"
                title="保存"
                aria-label="保存笔记"
              >
                <Save size={14} strokeWidth={2.2} />
              </button>
            </div>
          </div>
        </div>
      );
    }

    const isHovered = hoveredNoteId === note.id;

    return (
      <div
        key={note.id}
        data-note-card
        data-note-id={note.id}
        className={`${note.color} relative rounded-xl p-4 cursor-pointer transition-all duration-300 group ${
          dragId === note.id ? 'opacity-55 shadow-2xl scale-[1.015] z-10' : isHovered ? 'shadow-xl z-20 scale-[1.02]' : 'hover:shadow-md'
        }`}
        onMouseEnter={() => setHoveredNoteId(note.id)}
        onMouseLeave={() => setHoveredNoteId((id) => id === note.id ? null : id)}
        onDragOver={(event) => handleNoteDragOver(event, note.id)}
        onDrop={(event) => handleNoteDrop(event, note.id)}
        onClick={() => startEdit(note)}
      >
        <div
          className="absolute left-2 top-3 cursor-grab rounded-md px-0.5 py-1 text-[var(--text-secondary)]/45 opacity-0 transition-all hover:bg-white/45 hover:text-[#374151] active:cursor-grabbing group-hover:opacity-100"
          draggable
          onClick={(event) => event.stopPropagation()}
          onDragStart={(event) => {
            event.stopPropagation();
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', note.id);
            const card = (event.currentTarget as HTMLElement).closest('[data-note-card]') as HTMLElement | null;
            if (card) {
              const gripRect = event.currentTarget.getBoundingClientRect();
              const cardRect = card.getBoundingClientRect();
              event.dataTransfer.setDragImage(card, gripRect.left - cardRect.left + gripRect.width / 2, gripRect.top - cardRect.top + gripRect.height / 2);
            }
            setDragId(note.id);
          }}
          onDragEnd={handleNoteDragEnd}
          title="拖动调整顺序"
        >
          <GripVertical size={15} />
        </div>
        <button
          onClick={(event) => { event.stopPropagation(); togglePin(note.id); }}
          className={`absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity ${note.pinned ? 'opacity-100 text-[var(--accent)]' : 'text-[var(--text-secondary)] hover:text-[var(--accent)]'}`}
          title={note.pinned ? '取消置顶' : '置顶'}
        >
          <Pin size={12} />
        </button>
        <button
          onClick={(event) => { event.stopPropagation(); handleDelete(note.id); }}
          className="absolute top-3 right-8 opacity-0 group-hover:opacity-100 transition-opacity text-[var(--text-secondary)] hover:text-[var(--danger)]"
          title="移入垃圾箱"
        >
          <Trash2 size={12} />
        </button>
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2 pl-4 pr-12">{note.title}</h3>
        <p className={`text-xs text-[#374151] leading-relaxed whitespace-pre-wrap ${isHovered ? '' : 'line-clamp-4'}`}>{note.content || '空笔记'}</p>
        <div className="flex items-center justify-between mt-3 pt-2 border-t border-[var(--border-medium)]/20">
          <div className="flex min-w-0 flex-wrap gap-1">
            {getNoteTags(note).slice(0, 3).map((tag) => (
              <button
                key={tag}
                onClick={(event) => { event.stopPropagation(); setActiveTag(tag); }}
                className="text-xs px-2 py-0.5 bg-white/65 text-[#4b5563] rounded-full hover:bg-white/90 transition-colors"
                title={`筛选 #${tag}`}
              >
                #{tag}
              </button>
            ))}
          </div>
          <span className="text-xs text-[var(--text-secondary)] flex items-center gap-1">
            <Clock size={10} />
            {timeAgo(note.updatedAt)}
          </span>
        </div>
        {overId === note.id && dragId !== note.id && (
          <div
            className={`pointer-events-none absolute top-3 bottom-3 w-1 rounded-full bg-gradient-to-b from-transparent via-[#f59e0b] to-transparent ${
              insertPosition === 'before' ? '-left-0.5' : '-right-0.5'
            }`}
            style={{ boxShadow: '0 0 14px rgba(245,158,11,0.55)' }}
          >
            <span className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--warn)] shadow-sm" />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-full pt-2 space-y-5">
      {/* Mobile compact header */}
      <div className="md:hidden mb-1 pb-1 border-b border-[var(--border-light)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <StickyNote size={16} className="text-[var(--warn)]" />
            <h2 className="text-sm font-bold text-[var(--text-primary)]">笔记</h2>
            <span className="text-xs text-[var(--text-muted)]">({notes.length})</span>
          </div>
          <div className="flex items-center gap-0.5">
            <button onClick={() => setShowToolbar(!showToolbar)} className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors ${showToolbar ? 'text-[var(--warn)] bg-[#fffbeb]' : 'text-[var(--text-muted)]'}`} title="筛选">
              <SlidersHorizontal size={13} />
              <span>{activeColorLabel !== '全部' ? activeColorLabel : activeTagLabel !== '全部' ? `#${activeTagLabel}` : '全部'}</span>
            </button>
            <button onClick={() => setShowTrash(!showTrash)} className={`p-1.5 rounded-lg relative ${showTrash ? 'text-[var(--danger)] bg-[var(--danger-bg)]' : 'text-[var(--text-muted)]'}`} title="垃圾箱">
              <Trash2 size={14} />
              {trashedNotes.length > 0 && <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-[var(--danger)] text-white text-xs rounded-full flex items-center justify-center">{trashedNotes.length}</span>}
            </button>
            <button onClick={startNew} className="p-1.5 rounded-lg text-[var(--warn)] bg-[#fffbeb]" title="新建笔记">
              <Plus size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Mobile filters - shown directly */}
      {showToolbar && (
        <div className="space-y-1.5 md:hidden">
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setActiveColor('all')}
              className={`px-2 py-0.5 text-xs rounded-full transition-colors ${activeColor === 'all' ? 'bg-[var(--warn)] text-white' : 'bg-[var(--bg-base)] text-[var(--text-secondary)]'}`}
            >
              全部
            </button>
            {colorStats.map((color) => (
              <button
                key={color.value}
                onClick={() => setActiveColor(color.value)}
                className={`px-2 py-0.5 text-xs rounded-full transition-colors flex items-center gap-1 ${activeColor === color.value ? 'text-white' : 'bg-[var(--bg-base)] text-[var(--text-secondary)]'}`}
                style={{ backgroundColor: activeColor === color.value ? color.dot : undefined }}
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color.dot }} />
                {color.label}
              </button>
            ))}
          </div>
          {tagStats.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setActiveTag('all')}
                className={`px-2 py-0.5 text-xs rounded-full transition-colors ${activeTag === 'all' ? 'bg-[var(--warn)] text-white' : 'bg-[var(--bg-base)] text-[var(--text-secondary)]'}`}
              >
                全部标签
              </button>
              {tagStats.slice(0, 8).map((tag) => (
                <button
                  key={tag.name}
                  onClick={() => setActiveTag(tag.name)}
                  className={`px-2 py-0.5 text-xs rounded-full transition-colors ${activeTag === tag.name ? 'bg-[var(--warn)] text-white' : 'bg-[var(--bg-base)] text-[var(--text-secondary)]'}`}
                >
                  #{tag.name}
                </button>
              ))}
            </div>
          )}
          {(activeColor !== 'all' || activeTag !== 'all') && (
            <button onClick={resetFilters} className="text-xs text-[var(--text-muted)] hover:text-[var(--warn)] transition-colors">
              清除筛选
            </button>
          )}
        </div>
      )}

      {/* Desktop header */}
      <div className="hidden md:block">
        <PageTitle
          title="笔记"
          subtitle={`${notes.length} 条笔记，${trashedNotes.length} 条在垃圾箱；拖动卡片手柄调整顺序`}
          icon={<StickyNote size={22} />}
          action={
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowTrash((value) => !value)}
                className={`p-2 rounded-lg transition-colors relative ${showTrash ? 'text-[var(--danger)] bg-[var(--danger-bg)]' : 'text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger-bg)]'}`}
                title="垃圾箱"
              >
                <Trash2 size={16} />
                {trashedNotes.length > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 bg-[var(--danger)] text-white text-xs rounded-full flex items-center justify-center">
                    {trashedNotes.length}
                  </span>
                )}
              </button>
              <button
                onClick={createTodayAiNote}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-[#7c3aed] bg-[#f5f3ff] border border-[#ddd6fe] rounded-lg hover:bg-[#ede9fe] transition-colors"
                title="施工中：先生成或更新一条置顶的今日 AI 笔记"
              >
                <StickyNote size={16} />
                AI 今日笔记
                <span className="text-xs font-normal text-[#8b5cf6]">施工中</span>
              </button>
              <button onClick={startNew} className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-[var(--warn)] rounded-lg hover:bg-[#d97706] transition-colors">
                <Plus size={16} />
                新建笔记
              </button>
            </div>
          }
        />
      </div>

      {/* Desktop filters */}
      <div className="hidden md:block">
      <CollapsibleToolPanel
        collapsed={collapsedFilters}
        onToggle={() => setCollapsedFilters((value) => !value)}
        title="筛选设置"
        icon={<SlidersHorizontal size={13} />}
        summary={<>颜色: {activeColorLabel} / 标签: {activeTagLabel}</>}
      >
        <div className="relative max-w-xl">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索标题、正文或标签..."
            className="w-full pl-8 pr-3 py-1.5 border border-[var(--border-light)] rounded-lg focus:ring-2 focus:ring-[#f59e0b] focus:border-transparent outline-none transition-all text-xs bg-[var(--bg-elevated)]"
          />
        </div>

        <div className="flex items-start gap-2">
          <div className="flex h-6 w-12 shrink-0 items-center gap-1.5 text-xs text-[var(--text-secondary)]">
            <Filter size={13} className="text-[var(--text-muted)]" />
            <span>颜色</span>
          </div>
          <div className="flex flex-1 flex-wrap gap-1.5">
            <button
              onClick={() => setActiveColor('all')}
              className={`h-6 px-2.5 text-xs rounded-full transition-colors ${activeColor === 'all' ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-base)] text-[var(--text-secondary)] hover:bg-[var(--border-light)]'}`}
            >
              全部
            </button>
            {colorStats.map((color) => (
              <button
                key={color.value}
                onClick={() => setActiveColor(color.value)}
                className={`h-6 px-2.5 text-xs rounded-full transition-colors flex items-center gap-1.5 ${
                  activeColor === color.value ? 'text-white' : 'bg-[var(--bg-base)] text-[var(--text-secondary)] hover:bg-[var(--border-light)]'
                }`}
                style={{ backgroundColor: activeColor === color.value ? color.dot : undefined }}
                title={`${color.label} ${color.count} 条`}
              >
                <span className="w-2 h-2 rounded-full bg-white/80" style={{ backgroundColor: activeColor === color.value ? 'rgba(255,255,255,0.85)' : color.dot }} />
                <span>{color.label}</span>
                <span className={activeColor === color.value ? 'text-white/75' : 'text-[var(--text-muted)]'}>{color.count}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-start gap-2">
          <div className="flex h-6 w-12 shrink-0 items-center gap-1.5 text-xs text-[var(--text-secondary)]">
            <Tag size={13} className="text-[var(--text-muted)]" />
            <span>标签</span>
          </div>
          <div className="flex flex-1 flex-wrap gap-1.5">
            <button
              onClick={() => setActiveTag('all')}
              className={`h-6 px-2.5 text-xs rounded-full transition-colors ${activeTag === 'all' ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-base)] text-[var(--text-secondary)] hover:bg-[var(--border-light)]'}`}
            >
              全部
            </button>
            {tagStats.map((tag) => (
              <button
                key={tag.name}
                onClick={() => setActiveTag(tag.name)}
                className={`h-6 px-2.5 text-xs rounded-full transition-colors ${
                  activeTag === tag.name ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-base)] text-[var(--text-secondary)] hover:bg-[var(--border-light)]'
                }`}
                title={`${tag.name} ${tag.count} 条`}
              >
                #{tag.name} <span className={activeTag === tag.name ? 'text-white/75' : 'text-[var(--text-muted)]'}>{tag.count}</span>
              </button>
            ))}
          </div>
        </div>

        {(search || activeColor !== 'all' || activeTag !== 'all') && (
          <button onClick={resetFilters} className="h-6 px-2 text-xs text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors">
            清除筛选
          </button>
        )}
      </CollapsibleToolPanel>
      </div>

      {showTrash && (
        <div className="border border-[var(--border-light)] rounded-lg bg-[#f8f6f2] overflow-hidden">
          <button
            type="button"
            onClick={() => setCollapsedTrash((value) => !value)}
            aria-expanded={!collapsedTrash}
            className="flex w-full items-center justify-between border-b border-[var(--border-light)] px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <Trash2 size={14} className="text-[var(--danger)]" />
              <span className="text-sm font-medium text-[var(--text-primary)]">垃圾箱</span>
              <span className="text-xs text-[var(--text-muted)]">({trashedNotes.length})</span>
            </div>
            <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
              {trashedNotes.length > 0 && !collapsedTrash && (
                    <button onClick={() => { clearTrash(); playInteractionSound('delete'); }} className="text-xs text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors px-2 py-1">
                  清空垃圾箱
                </button>
              )}
              <button onClick={() => setShowTrash(false)} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                <X size={14} />
              </button>
            </div>
          </button>
          {!collapsedTrash && (
            trashedNotes.length === 0 ? (
              <div className="text-center py-6 text-[var(--text-muted)] text-sm">垃圾箱为空</div>
            ) : (
              <div className="max-h-64 overflow-y-auto divide-y divide-[var(--border-light)]">
                {trashedNotes.map(({ note, deletedAt }) => (
                  <div key={note.id} className="flex items-center gap-3 px-3 py-2 hover:bg-[var(--bg-accent)] transition-colors">
                    <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: COLOR_DOT[note.color] }} />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-[var(--text-primary)] truncate block">{note.title}</span>
                      <span className="text-xs text-[var(--text-muted)]">删除于 {new Date(deletedAt).toLocaleString('zh-CN')}</span>
                    </div>
                    <button onClick={() => { restoreNote(note.id); playInteractionSound('restore'); }} className="flex items-center gap-1 px-2 py-1 text-xs text-[var(--accent)] hover:bg-[var(--bg-accent)] rounded transition-colors">
                      <RotateCcw size={12} />
                      恢复
                    </button>
                    <button onClick={() => { permanentDeleteNote(note.id); playInteractionSound('delete'); }} className="p-1 text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors" title="永久删除">
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      )}

      {pinned.length > 0 && (
        <section>
          <h3 className="text-xs font-medium text-[var(--text-muted)] mb-2 flex items-center gap-1"><Pin size={10} />置顶</h3>
          <div className="auto-grid-wide">
            {pinned.map(renderCard)}
          </div>
        </section>
      )}

      <section>
        {pinned.length > 0 && <h3 className="text-xs font-medium text-[var(--text-muted)] mb-2">全部笔记</h3>}
        {unpinned.length > 0 ? (
          <div className="auto-grid-wide">
            {unpinned.map(renderCard)}
          </div>
        ) : filtered.length === 0 && (
          <EmptyState
            icon={<StickyNote size={24} className="text-[var(--text-muted)]" />}
            title={search ? '没有找到匹配的笔记' : '还没有笔记'}
            description="可以新建一条笔记，或调整标签、颜色筛选条件。"
          />
        )}
      </section>
    </div>
  );
};
