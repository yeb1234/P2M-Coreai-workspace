import React, { useMemo } from 'react';
import { useCalendarStore, useScheduleStore } from '../../stores';
import { getWeekDays, getWeekDayNames, isTodayCheck, toISODateString } from '../../lib/date';
import { getItemsForCalendarDates, groupScheduleItemsByDate } from './calendarDerivedData';
import type { ISODateString } from '../../types';

interface WeekViewProps {
  onDayDoubleClick?: (date: ISODateString) => void;
}

export const WeekView: React.FC<WeekViewProps> = ({ onDayDoubleClick }) => {
  const rawMonth = useCalendarStore((s) => s.currentMonth);
  const currentMonth = useMemo(() => rawMonth instanceof Date ? rawMonth : new Date(rawMonth), [rawMonth]);
  const selectedDate = useCalendarStore((s) => s.selectedDate);
  const setSelectedDate = useCalendarStore((s) => s.setSelectedDate);
  const scheduleItems = useScheduleStore((s) => s.items);
  const weekDays = useMemo(() => getWeekDays(currentMonth), [currentMonth]);
  const dayNames = useMemo(() => getWeekDayNames(), []);
  const weekDateStrings = useMemo(() => weekDays.map((date) => toISODateString(date)), [weekDays]);
  const weekItems = useMemo(() => getItemsForCalendarDates(scheduleItems, weekDateStrings), [scheduleItems, weekDateStrings]);
  const { eventsByDate, pendingByDate } = useMemo(() => groupScheduleItemsByDate(weekItems), [weekItems]);

  return (
    <div className="space-y-3 md:grid md:grid-cols-7 md:gap-2 md:space-y-0">
      <div className="grid grid-cols-4 gap-1.5 md:hidden">
        {weekDays.map((date, idx) => {
          const dateStr = toISODateString(date);
          const events = eventsByDate[dateStr] || [];
          const todos = pendingByDate[dateStr] || [];
          const isToday = isTodayCheck(date);
          const isSelected = selectedDate === dateStr;
          const totalItems = events.length + todos.length;
          return (
            <button
              key={dateStr}
              type="button"
              onClick={() => setSelectedDate(dateStr)}
              onDoubleClick={() => onDayDoubleClick?.(dateStr)}
              className="flex min-w-0 items-center justify-center gap-1.5 rounded-xl px-2 py-2 transition-all"
              style={{
                background: isSelected
                  ? 'linear-gradient(160deg, color-mix(in srgb, var(--accent) 22%, var(--bg-card)) 0%, color-mix(in srgb, var(--accent) 10%, var(--bg-card)) 100%)'
                  : isToday
                  ? 'color-mix(in srgb, var(--accent) 8%, var(--bg-card))'
                  : undefined,
                boxShadow: isSelected ? 'var(--shadow-card)' : 'none',
              }}
            >
              <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium transition-all ${isToday ? 'bg-[var(--accent)] text-white' : isSelected ? 'text-[var(--accent)] font-bold ring-1 ring-[var(--accent)]' : 'text-[var(--text-primary)]'}`}>
                {date.getDate()}
              </span>
              <span className={`min-w-0 text-[11px] font-medium ${isToday ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
                {dayNames[idx]}
              </span>
              <span className={`ml-auto text-[10px] ${totalItems > 0 ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
                {totalItems > 0 ? totalItems : ''}
              </span>
            </button>
          );
        })}
      </div>

      <div className="space-y-2 md:hidden">
        {weekDays.map((date, idx) => {
          const dateStr = toISODateString(date);
          const events = eventsByDate[dateStr] || [];
          const dayTodos = pendingByDate[dateStr] || [];
          const isToday = isTodayCheck(date);
          const isSelected = selectedDate === dateStr;
          const hasItems = events.length > 0 || dayTodos.length > 0;
          return (
            <button
              key={dateStr}
              type="button"
              onClick={() => setSelectedDate(dateStr)}
              onDoubleClick={() => onDayDoubleClick?.(dateStr)}
              className={`w-full rounded-xl border p-3 text-left transition-all ${isSelected ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]' : 'border-[var(--border-light)]'}`}
              style={{
                background: isToday ? 'color-mix(in srgb, var(--accent) 7%, var(--bg-card))' : 'var(--bg-card)',
                boxShadow: isSelected ? 'var(--shadow-card)' : 'none',
              }}
            >
              <div className="mb-2 flex items-center gap-2">
                <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${isToday ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-secondary)] text-[var(--text-primary)]'}`}>
                  {date.getDate()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[var(--text-primary)]">{dayNames[idx]}</p>
                  <p className="text-[10px] text-[var(--text-muted)]">{dateStr}</p>
                </div>
                <span className="text-[10px] text-[var(--text-muted)]">{events.length + dayTodos.length} 项</span>
              </div>
              {!hasItems ? (
                <p className="rounded-lg bg-[var(--bg-secondary)] px-2 py-2 text-xs text-[var(--text-muted)]">当天无内容</p>
              ) : (
                <div className="space-y-1.5">
                  {events.map((event) => (
                    <div key={event.id} className="rounded-lg px-2 py-1.5 text-xs" style={{ background: event.color }}>
                      <div className="truncate font-medium text-white">{event.title}</div>
                    </div>
                  ))}
                  {dayTodos.map((todo) => (
                    <div key={todo.id} className="rounded-lg bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] px-2 py-1.5 text-xs">
                      <div className="truncate font-medium text-[var(--accent)]">{todo.priority === 'high' ? '! ' : ''}{todo.title}</div>
                      {todo.pomodoroRounds > 0 && <div className="text-[10px] text-[var(--text-muted)]">{todo.pomodoroRounds} 轮</div>}
                    </div>
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {weekDays.map((date, idx) => {
        const dateStr = toISODateString(date);
        const events = eventsByDate[dateStr] || [];
        const todos = pendingByDate[dateStr] || [];
        const isToday = isTodayCheck(date);
        const isSelected = selectedDate === dateStr;
        return (
          <button
            key={dateStr}
            type="button"
            onClick={() => setSelectedDate(dateStr)}
            onDoubleClick={() => onDayDoubleClick?.(dateStr)}
            className={`hidden md:flex flex-col items-stretch text-left rounded-lg border transition-all hover:shadow-sm ${isSelected ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]' : 'border-[var(--border-light)] hover:border-[var(--border-medium)]'} ${isToday ? 'bg-[color-mix(in_srgb,var(--accent)_8%,var(--bg-card))]' : ''}`}
            style={{
              background: isSelected ? 'linear-gradient(160deg, color-mix(in srgb, var(--accent) 22%, var(--bg-card)) 0%, color-mix(in srgb, var(--accent) 10%, var(--bg-card)) 100%)' : undefined,
              boxShadow: isSelected ? 'var(--shadow-card)' : 'none',
            }}
          >
            <div className="text-center py-2 border-b border-[var(--border-light)]">
              <div className={`text-[10px] ${isToday ? 'text-[var(--accent)] font-bold' : 'text-[var(--text-muted)]'}`}>{dayNames[idx]}</div>
              <span className={`inline-flex items-center justify-center w-6 h-6 text-xs font-medium rounded-full ${isToday ? 'bg-[var(--accent)] text-white' : isSelected ? 'text-[var(--accent)] font-bold' : 'text-[var(--text-primary)]'}`}>
                {date.getDate()}
              </span>
            </div>
            <div className="flex-1 space-y-1 min-h-[100px] p-1.5">
              {events.length === 0 && todos.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <span className="text-[9px] text-[var(--text-muted)]">-</span>
                </div>
              ) : (
                <>
                  {events.map((event) => (
                    <div key={event.id} className="text-[11px] p-1.5 rounded" style={{ background: event.color }}>
                      <div className="font-medium text-white truncate">{event.title}</div>
                    </div>
                  ))}
                  {todos.slice(0, 3).map((todo) => (
                    <div key={todo.id} className="text-[11px] p-1.5 rounded bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]">
                      <div className="font-medium text-[var(--accent)] truncate">{todo.priority === 'high' ? '!' : ''} {todo.title}</div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
};
