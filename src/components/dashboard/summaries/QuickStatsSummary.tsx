import React, { useMemo } from 'react';
import { CheckCircle2, Timer, StickyNote, Calendar } from 'lucide-react';
import { useTodoStore, usePomodoroStore, useNotesStore, useCalendarStore } from '../../../stores';
import { toLocalDateString } from '../../../lib/date';

export const QuickStatsSummary: React.FC = () => {
  const todos = useTodoStore((s) => s.todos);
  const sessions = usePomodoroStore((s) => s.sessions);
  const notes = useNotesStore((s) => s.notes);
  const events = useCalendarStore((s) => s.events);

  const stats = useMemo(() => {
    const today = toLocalDateString(new Date());
    const todayTodos = Object.values(todos).filter((t) => t.dueDate === today);
    const completedToday = todayTodos.filter((t) => t.status === 'completed').length;
    const todaySessions = Object.values(sessions || {}).filter(
      (s) => s.completed && s.phase === 'work' && toLocalDateString(s.startTime) === today
    );
    const todayEvents = Object.values(events).filter((e) => e.date === today);

    return {
      todosDone: completedToday,
      todosTotal: todayTodos.length,
      pomodoros: todaySessions.length,
      notesCount: notes.length,
      eventsCount: todayEvents.length,
    };
  }, [todos, sessions, notes, events]);

  const items = [
    { icon: <CheckCircle2 size={14} />, label: '今日完成', value: `${stats.todosDone}/${stats.todosTotal}`, color: '#16a34a' },
    { icon: <Timer size={14} />, label: '番茄钟', value: stats.pomodoros, color: '#c87d2f' },
    { icon: <StickyNote size={14} />, label: '笔记', value: stats.notesCount, color: '#f59e0b' },
    { icon: <Calendar size={14} />, label: '今日事件', value: stats.eventsCount, color: '#7c3aed' },
  ];

  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2 p-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border-light)]">
          <span style={{ color: item.color }}>{item.icon}</span>
          <div>
            <p className="text-sm font-bold text-[var(--text-primary)]">{item.value}</p>
            <p className="text-[10px] text-[var(--text-muted)]">{item.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
};
