import React from 'react';
import { StickyNote } from 'lucide-react';
import { useNotesStore, useUIStore } from '../../../stores';
import { selectNotesProjection } from '../../../lib/projections/notes';
import { SummaryEmpty } from './SummaryEmpty';

/**
 * 最近便签卡片 = 便签页（NotesPage）第一屏的那几条。
 * 顺序来自 selectNotesProjection（置顶在前、组内按 drag 顺序），
 * 不再是"按 updatedAt 倒序"那套独立口径。
 */
export const RecentNotesSummary: React.FC = () => {
  const notes = useNotesStore((s) => s.notes);
  const { setActiveView } = useUIStore();

  const { recent, total } = selectNotesProjection(notes);

  if (recent.length === 0) {
    return (
      <SummaryEmpty
        icon={<StickyNote size={16} />}
        title="还没有便签"
        hint="在便签页记下第一条"
        onClick={() => setActiveView('notes')}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
          <StickyNote size={12} />
          <span>最近编辑</span>
        </div>
        <span className="text-xs font-semibold text-[var(--accent)] bg-[var(--bg-accent)] px-1.5 py-0.5 rounded-lg">{total}</span>
      </div>
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
            {note.content || '空便签'}
          </p>
        </div>
      ))}
    </div>
  );
};
