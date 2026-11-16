import React, { useMemo } from 'react';
import { StickyNote } from 'lucide-react';
import { useNotesStore, useUIStore } from '../../../stores';
import { SummaryEmpty } from './SummaryEmpty';

export const RecentNotesSummary: React.FC = () => {
  const notes = useNotesStore((s) => s.notes);
  const { setActiveView } = useUIStore();

  const recent = useMemo(() => {
    return [...notes].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 3);
  }, [notes]);

  if (recent.length === 0) {
    return (
      <SummaryEmpty
        icon={<StickyNote size={16} />}
        title="还没有笔记"
        hint="在笔记页记下第一条"
        onClick={() => setActiveView('notes')}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-2">
      {recent.map((note) => (
        <div key={note.id} className={`${note.color} flex min-h-[74px] flex-col rounded-[var(--r-1)] p-2.5`}>
          <div className="mb-1 flex items-center gap-2">
            <StickyNote size={12} className="flex-shrink-0 text-[var(--text-secondary)]" />
            <span className="truncate text-xs font-medium text-[var(--text-primary)]">{note.title}</span>
          </div>
          {/* line-clamp-2 的类名在产物里存在，但实际没截断 —— 便签正文会
              撑出底色块，最后一行贴在边上。改用内联样式保证生效。
              min-h 让三张便签高度一致，否则内容长短不同会参差。 */}
          <p
            className="text-xs leading-relaxed text-[var(--text-secondary)]"
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {note.content || '空笔记'}
          </p>
        </div>
      ))}
    </div>
  );
};
