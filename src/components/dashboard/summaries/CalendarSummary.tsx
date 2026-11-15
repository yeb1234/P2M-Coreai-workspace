import React from 'react';
import { Calendar } from 'lucide-react';
import { useScheduleStore, useUIStore } from '../../../stores';
import { formatDate, toLocalDateString } from '../../../lib/date';
import { datePart, hasScheduleTime, timePart } from '../../../lib/scheduleTime';
import { PRIORITY_COLORS } from '../../../types';

export const CalendarSummary: React.FC = () => {
  const items = useScheduleStore((s) => s.items);
  const { setActiveView } = useUIStore();
  const today = toLocalDateString(new Date());
  const todayEvents = Object.values(items).filter((item) => !item.deletedAt && hasScheduleTime(item) && datePart(item.startAt) === today);
  const displayEvents = todayEvents.slice(0, 3);
  const hasMore = todayEvents.length > 3;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
          <Calendar size={12} />
          <span>{formatDate(new Date(), 'MM月dd日')}</span>
        </div>
        <span className="text-xs font-semibold text-[var(--accent)] bg-[var(--bg-accent)] px-1.5 py-0.5 rounded-lg">{todayEvents.length}</span>
      </div>

      {todayEvents.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)] text-center py-3">今日无事件</p>
      ) : (
        <div className="space-y-1">
          {displayEvents.map((event, idx) => {
            if (!hasScheduleTime(event)) return null;
            const isLast = idx === 2 && hasMore;
            const color = event.type === 'todo' ? PRIORITY_COLORS[event.priority] : '#8b5cf6';
            return (
              <div
                key={event.id}
                className={`flex items-center gap-2 text-xs p-2 rounded-lg ${
                  isLast ? 'cursor-pointer hover:bg-[var(--bg-accent)] transition-colors' : 'bg-[var(--bg-elevated)]'
                }`}
                style={!isLast ? {
                  background: `linear-gradient(135deg, ${color}15 0%, transparent 100%)`,
                  borderLeft: `3px solid ${color}`,
                } : undefined}
                onClick={() => { if (isLast) setActiveView('calendar'); }}
              >
                {isLast ? (
                  <span className="text-[var(--text-muted)] font-medium">...还有 {todayEvents.length - 2} 项</span>
                ) : (
                  <>
                    <span className="truncate text-[var(--text-primary)] font-medium">{event.title}</span>
                    <span className="text-xs text-[var(--text-muted)] ml-auto flex-shrink-0">{timePart(event.startAt)}</span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
