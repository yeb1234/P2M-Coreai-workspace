import React, { useMemo } from 'react';
import { CheckCircle2, Timer, StickyNote, Calendar } from 'lucide-react';
import { useScheduleStore, usePomodoroStore, useNotesStore } from '../../../stores';
import { toLocalDateString } from '../../../lib/date';
import { datePart, hasScheduleTime } from '../../../lib/scheduleTime';

export const QuickStatsSummary: React.FC = () => {
  const scheduleItems = useScheduleStore((s) => s.items);
  const sessions = usePomodoroStore((s) => s.sessions);
  const notes = useNotesStore((s) => s.notes);

  const stats = useMemo(() => {
    const today = toLocalDateString(new Date());
    const todayItems = Object.values(scheduleItems).filter((item) => !item.deletedAt && hasScheduleTime(item) && datePart(item.startAt) === today);
    const todayTodos = todayItems.filter((item) => item.type === 'todo');
    const completedToday = todayTodos.filter((t) => t.status === 'completed').length;
    const todaySessions = Object.values(sessions || {}).filter(
      (s) => s.completed && s.phase === 'work' && toLocalDateString(s.startTime) === today
    );

    return {
      todosDone: completedToday,
      todosTotal: todayTodos.length,
      pomodoros: todaySessions.length,
      notesCount: notes.length,
      eventsCount: todayItems.length,
    };
  }, [scheduleItems, sessions, notes]);

  const items = [
    { icon: <CheckCircle2 size={14} />, label: '今日完成', value: `${stats.todosDone}/${stats.todosTotal}`, color: '#16a34a' },
    { icon: <Timer size={14} />, label: '番茄钟', value: stats.pomodoros, color: '#c87d2f' },
    { icon: <StickyNote size={14} />, label: '笔记', value: stats.notesCount, color: '#f59e0b' },
    { icon: <Calendar size={14} />, label: '今日事件', value: stats.eventsCount, color: '#7c3aed' },
  ];

  return (
    <div className="auto-grid-compact">
      {items.map((item) => (
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
