import React from 'react';
import { Calendar } from 'lucide-react';
import { useScheduleStore, useUIStore } from '../../../stores';
import { formatDate } from '../../../lib/date';
import { hasScheduleTime, timePart } from '../../../lib/scheduleTime';
import { selectCalendarProjection } from '../../../lib/projections/calendar';
import { PRIORITY_COLORS } from '../../../types';
import { SummaryEmpty } from './SummaryEmpty';

/**
 * 日历卡片 = 日历页日视图同一份投影的渲染。
 * 今天有哪些条目、总数和"还有 N 项"都来自 selectCalendarProjection，
 * 卡片这边不再自己过滤/切片。
 */
export const CalendarSummary: React.FC = () => {
  const items = useScheduleStore((s) => s.items);
  const { setActiveView } = useUIStore();

  // 不 memo：投影是几十条量级的纯计算，memorize 反而容易漏依赖变成陈旧值
  const { display, total, overflow } = selectCalendarProjection(items);

  return (
    <div className="flex flex-1 flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
          <Calendar size={12} />
          <span>{formatDate(new Date(), 'MM月dd日')}</span>
        </div>
        <span className="text-xs font-semibold text-[var(--accent)] bg-[var(--bg-accent)] px-1.5 py-0.5 rounded-lg">{total}</span>
      </div>

      {total === 0 ? (
        <SummaryEmpty
          icon={<Calendar size={16} />}
          title="今天还没有安排"
          hint="点这里打开周历"
          onClick={() => setActiveView('calendar')}
        />
      ) : (
        <div className="space-y-1">
          {display.map((event) => {
            if (!hasScheduleTime(event)) return null;
            const color = event.type === 'todo' ? PRIORITY_COLORS[event.priority] : '#8b5cf6';
            return (
              <div
                key={event.id}
                className="flex items-center gap-2 text-xs p-2 rounded-lg bg-[var(--bg-elevated)]"
                style={{
                  background: `linear-gradient(135deg, ${color}15 0%, transparent 100%)`,
                  borderLeft: `3px solid ${color}`,
                }}
              >
                <span className="truncate text-[var(--text-primary)] font-medium">{event.title}</span>
                <span className="text-xs text-[var(--text-muted)] ml-auto flex-shrink-0">{timePart(event.startAt)}</span>
              </div>
            );
          })}
          {overflow > 0 && (
            <div
              className="flex items-center gap-2 text-xs p-2 rounded-lg cursor-pointer hover:bg-[var(--bg-accent)] transition-colors"
              onClick={() => setActiveView('calendar')}
            >
              <span className="text-[var(--text-muted)] font-medium">...还有 {overflow} 项</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
