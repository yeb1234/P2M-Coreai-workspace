import React, { useMemo } from 'react';
import { StickyNote } from 'lucide-react';
import { useNotesStore } from '../../../stores';

export const RecentNotesSummary: React.FC = () => {
  const notes = useNotesStore((s) => s.notes);

  const recent = useMemo(() => {
    return [...notes].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 3);
  }, [notes]);

  if (recent.length === 0) {
    return <p className="text-xs text-[var(--text-muted)] text-center py-4">还没有笔记</p>;
  }

  return (
    <div className="space-y-2">
      {recent.map((note) => (
        <div key={note.id} className={`${note.color} rounded-lg p-2.5`}>
          <div className="flex items-center gap-2 mb-1">
            <StickyNote size={12} className="text-[#6b7280] flex-shrink-0" />
            <span className="text-xs font-medium text-[#1a1a1a] truncate">{note.title}</span>
          </div>
          <p className="text-[10px] text-[#6b7280] line-clamp-2 leading-relaxed">{note.content || '空笔记'}</p>
        </div>
      ))}
    </div>
  );
};
