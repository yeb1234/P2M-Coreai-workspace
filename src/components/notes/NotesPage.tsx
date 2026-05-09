import React, { useState, useMemo, useCallback } from 'react';
import { StickyNote, Plus, Search, Pin, Clock, X, Save, Trash2 } from 'lucide-react';
import { PageTitle } from '../shared';
import { useNotesStore } from '../../stores';
import type { Note, NoteColor } from '../../stores/notesStore';

const COLORS: { value: NoteColor; label: string }[] = [
  { value: 'sticky-yellow', label: '黄' },
  { value: 'sticky-pink', label: '粉' },
  { value: 'sticky-blue', label: '蓝' },
  { value: 'sticky-green', label: '绿' },
  { value: 'sticky-orange', label: '橙' },
  { value: 'sticky-purple', label: '紫' },
];

const COLOR_DOT: Record<NoteColor, string> = {
  'sticky-yellow': '#f59e0b',
  'sticky-pink': '#ec4899',
  'sticky-blue': '#3b82f6',
  'sticky-green': '#22c55e',
  'sticky-orange': '#f97316',
  'sticky-purple': '#a855f7',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}天前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}

export const NotesPage: React.FC = () => {
  const notes = useNotesStore((s) => s.notes);
  const addNote = useNotesStore((s) => s.addNote);
  const updateNote = useNotesStore((s) => s.updateNote);
  const deleteNote = useNotesStore((s) => s.deleteNote);
  const togglePin = useNotesStore((s) => s.togglePin);

  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editColor, setEditColor] = useState<NoteColor>('sticky-yellow');
  const [editTag, setEditTag] = useState('');

  const filtered = useMemo(() => {
    if (!search) return notes;
    const q = search.toLowerCase();
    return notes.filter((n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q) || n.tag.toLowerCase().includes(q));
  }, [notes, search]);

  const pinned = useMemo(() => filtered.filter((n) => n.pinned), [filtered]);
  const unpinned = useMemo(() => filtered.filter((n) => !n.pinned), [filtered]);

  const startEdit = useCallback((note: Note) => {
    setEditingId(note.id);
    setEditTitle(note.title);
    setEditContent(note.content);
    setEditColor(note.color);
    setEditTag(note.tag);
  }, []);

  const startNew = useCallback(() => {
    const id = addNote({ title: '新笔记', content: '', color: 'sticky-yellow', tag: '' });
    const newNote = notes.find((n) => n.id === id) || { id, title: '新笔记', content: '', color: 'sticky-yellow' as NoteColor, tag: '' };
    startEdit(newNote as Note);
  }, [addNote, notes, startEdit]);

  const saveEdit = useCallback(() => {
    if (editingId) {
      updateNote(editingId, { title: editTitle, content: editContent, color: editColor, tag: editTag });
      setEditingId(null);
    }
  }, [editingId, editTitle, editContent, editColor, editTag, updateNote]);

  const cancelEdit = useCallback(() => setEditingId(null), []);

  const handleDelete = useCallback((id: string) => {
    deleteNote(id);
    if (editingId === id) setEditingId(null);
  }, [deleteNote, editingId]);

  const handleTogglePin = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    togglePin(id);
  }, [togglePin]);

  const renderCard = (note: Note) => {
    if (editingId === note.id) {
      return (
        <div key={note.id} className={`${editColor} rounded-xl p-4 col-span-1 sm:col-span-2 lg:col-span-2`}>
          <input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            className="w-full text-sm font-semibold text-[#1a1a1a] bg-transparent outline-none border-b border-[#d1cdc6] pb-1 mb-2"
            placeholder="标题"
            autoFocus
          />
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full text-xs text-[#6b7280] bg-transparent outline-none resize-none min-h-[120px] leading-relaxed"
            placeholder="写点什么..."
          />
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-[#d1cdc6]/30">
            <div className="flex items-center gap-1.5">
              {COLORS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => { setEditColor(c.value); if (editingId) updateNote(editingId, { color: c.value }); }}
                  className={`w-4 h-4 rounded-full border-2 transition-all ${editColor === c.value ? 'border-[#1a1a1a] scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: COLOR_DOT[c.value] }}
                  title={c.label}
                />
              ))}
              <input
                type="text"
                value={editTag}
                onChange={(e) => setEditTag(e.target.value)}
                className="ml-2 text-[10px] px-2 py-0.5 bg-white/60 rounded-full outline-none w-16"
                placeholder="标签"
              />
            </div>
            <div className="flex gap-1">
              <button onClick={cancelEdit} className="p-1.5 text-[#9ca3af] hover:text-[#dc3545]"><X size={14} /></button>
              <button onClick={saveEdit} className="p-1.5 text-[#16a34a] hover:bg-[#16a34a]/10 rounded"><Save size={14} /></button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div
        key={note.id}
        className={`${note.color} rounded-xl p-4 cursor-pointer hover:shadow-md transition-shadow relative group`}
        onClick={() => startEdit(note)}
      >
        <button
          onClick={(e) => handleTogglePin(note.id, e)}
          className={`absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity ${note.pinned ? 'opacity-100 text-[#c87d2f]' : 'text-[#9ca3af] hover:text-[#c87d2f]'}`}
        >
          <Pin size={12} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); handleDelete(note.id); }}
          className="absolute top-3 right-8 opacity-0 group-hover:opacity-100 transition-opacity text-[#9ca3af] hover:text-[#dc3545]"
        >
          <Trash2 size={12} />
        </button>
        <h3 className="text-sm font-semibold text-[#1a1a1a] mb-2 pr-12">{note.title}</h3>
        <p className="text-xs text-[#6b7280] leading-relaxed line-clamp-4 whitespace-pre-wrap">{note.content}</p>
        <div className="flex items-center justify-between mt-3 pt-2 border-t border-[#d1cdc6]/20">
          {note.tag ? (
            <span className="text-[10px] px-2 py-0.5 bg-white/60 text-[#6b7280] rounded-full">{note.tag}</span>
          ) : <span />}
          <span className="text-[10px] text-[#9ca3af] flex items-center gap-1">
            <Clock size={10} />
            {timeAgo(note.updatedAt)}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full pt-2 space-y-6">
      <PageTitle
        title="笔记"
        subtitle={`${notes.length} 条笔记`}
        icon={<StickyNote size={22} />}
        action={
          <button onClick={startNew} className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-[#f59e0b] rounded-lg hover:bg-[#d97706] transition-colors">
            <Plus size={16} />
            新建笔记
          </button>
        }
      />

      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索笔记..."
          className="w-full pl-10 pr-4 py-2.5 bg-[#faf9f7] border border-[#e5e2dd] rounded-xl text-sm outline-none focus:border-[#f59e0b] focus:ring-2 focus:ring-[#f59e0b]/10"
        />
      </div>

      {pinned.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-[#9ca3af] mb-2 flex items-center gap-1"><Pin size={10} />置顶</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {pinned.map(renderCard)}
          </div>
        </div>
      )}

      <div>
        {pinned.length > 0 && <h3 className="text-xs font-medium text-[#9ca3af] mb-2">全部笔记</h3>}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {unpinned.map(renderCard)}
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-[#9ca3af]">
          <StickyNote size={32} className="mx-auto mb-2 opacity-40" />
          <p className="text-sm">{search ? '没有找到匹配的笔记' : '还没有笔记，点击上方按钮创建'}</p>
        </div>
      )}
    </div>
  );
};
