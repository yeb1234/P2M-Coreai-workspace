import React, { useMemo } from 'react';
import { useCalendarStore, useTodoStore } from '../../stores';
import { getWeekDays, getWeekDayNames, isTodayCheck, toISODateString } from '../../lib/date';

export const WeekView: React.FC = () => {
  const rawMonth = useCalendarStore((s) => s.currentMonth);
  const currentMonth = rawMonth instanceof Date ? rawMonth : new Date(rawMonth);
  const selectedDate = useCalendarStore((s) => s.selectedDate);
  const setSelectedDate = useCalendarStore((s) => s.setSelectedDate);
  const getEventsForDate = useCalendarStore((s) => s.getEventsForDate);
  const todos = useTodoStore((s) => s.todos);

  const completedTodoSet = useMemo(() => {
    const completed = Object.values(todos).filter((t) => t.status === 'completed');
    return {
      ids: new Set(completed.map((t) => t.id)),
      titles: new Set(completed.map((t) => t.title)),
    };
  }, [todos]);

  const weekDays = getWeekDays(currentMonth);
  const dayNames = getWeekDayNames();

  return (
    <div className="grid grid-cols-7 gap-2">
      {weekDays.map((date, idx) => {
        const dateStr = toISODateString(date);
        const events = getEventsForDate(dateStr).filter((e) => {
          if (e.type !== 'todo') return true;
          if (e.todoId && completedTodoSet.ids.has(e.todoId)) return false;
          if (!e.todoId && completedTodoSet.titles.has(e.title)) return false;
          return true;
        });
        const isToday = isTodayCheck(date);
        const isSelected = selectedDate === dateStr;

        return (
          <button
            key={dateStr}
            type="button"
            onClick={() => setSelectedDate(dateStr)}
            className={`flex flex-col text-left rounded-xl border transition-all hover:shadow-md ${
              isSelected
                ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]'
                : 'border-[var(--border-light)] hover:border-[var(--border-medium)]'
            }`}
            style={{
              background: isSelected
                ? 'linear-gradient(160deg, color-mix(in srgb, var(--accent) 22%, var(--bg-card)) 0%, color-mix(in srgb, var(--accent) 10%, var(--bg-card)) 100%)'
                : 'linear-gradient(160deg, var(--bg-card) 0%, var(--bg-elevated) 100%)',
              boxShadow: isSelected ? 'var(--shadow-card)' : 'none',
            }}
          >
            <div className="text-center py-2 border-b border-[var(--border-light)]">
              <div className="text-[10px] text-[var(--text-muted)] mb-0.5">{dayNames[idx]}</div>
              <span
                className={`inline-flex items-center justify-center w-7 h-7 text-sm font-medium rounded-full ${
                  isToday
                    ? 'bg-[var(--accent)] text-white'
                    : isSelected
                    ? 'text-[var(--accent)] font-bold'
                    : 'text-[var(--text-primary)]'
                }`}
              >
                {date.getDate()}
              </span>
            </div>

            <div className="flex-1 space-y-1 min-h-[100px] p-1.5">
              {events.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <span className="text-[9px] text-[var(--text-muted)]">-</span>
                </div>
              ) : (
                events.map((event) => (
                  <div
                    key={event.id}
                    className="text-[11px] p-1.5 rounded"
                    style={{
                      background: `color-mix(in srgb, ${event.color} 16%, var(--bg-card))`,
                      borderLeft: `2px solid ${event.color}`,
                    }}
                  >
                    <div className="font-medium text-[var(--text-primary)] truncate">{event.title}</div>
                    {event.startTime && (
                      <div className="text-[10px] text-[var(--text-secondary)]">{event.startTime}</div>
                    )}
                  </div>
                ))
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
};
