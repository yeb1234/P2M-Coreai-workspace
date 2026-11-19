import React from 'react';
import { CheckCircle2, Timer, StickyNote, Calendar } from 'lucide-react';
import { useScheduleStore, usePomodoroStore, useNotesStore, useCalendarStore } from '../../../stores';
import { selectQuickStatsProjection } from '../../../lib/projections/quickStats';

/**
 * 今日概览卡片 = 数据中心页同一份投影的渲染。
 * 四项数字口径全部来自 selectQuickStatsProjection，卡片这边不再内联重算
 * （旧版用 startAt 过滤待办、自己过滤 sessions、事件漏看日历模型）。
 */
export const QuickStatsSummary: React.FC = () => {
  const items = useScheduleStore((s) => s.items);
  const getTodayStats = usePomodoroStore((s) => s.getTodayStats);
  const notes = useNotesStore((s) => s.notes);
  const calendarEvents = useCalendarStore((s) => s.events);

  const projection = selectQuickStatsProjection({
    items,
    todayStats: getTodayStats(),
    notes,
    calendarEvents,
  });

  const itemsList = [
    { icon: <CheckCircle2 size={14} />, label: '今日完成', value: `${projection.todayDone}/${projection.todayTotal}`, color: '#16a34a' },
    { icon: <Timer size={14} />, label: '番茄钟', value: projection.pomodoros, color: '#c87d2f' },
    { icon: <StickyNote size={14} />, label: '便签', value: projection.notesCount, color: '#f59e0b' },
    { icon: <Calendar size={14} />, label: '今日事件', value: projection.eventsCount, color: '#7c3aed' },
  ];

  return (
    <div className="auto-grid-compact">
      {itemsList.map((item) => (
        <div key={item.label} className="flex min-w-0 items-center gap-2 p-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border-light)]">
          <span className="shrink-0" style={{ color: item.color }}>{item.icon}</span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-[var(--text-primary)]">{item.value}</p>
            <p className="text-xs text-[var(--text-muted)]">{item.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
};
