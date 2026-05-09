import React, { useMemo, useCallback } from 'react';
import { useCalendarStore, useTodoStore } from '../../stores';
import { getMonthDays, getWeekDayNames, isCurrentMonth, toISODateString } from '../../lib/date';
import { DayCell } from './DayCell';
import { WeekView } from './WeekView';
import type { CalendarEvent, ISODateString } from '../../types';

interface CalendarGridProps {
  onDayDoubleClick?: (date: ISODateString) => void;
}

export const CalendarGrid: React.FC<CalendarGridProps> = ({ onDayDoubleClick }) => {
  const rawMonth = useCalendarStore((s) => s.currentMonth);
  const currentMonth = rawMonth instanceof Date ? rawMonth : new Date(rawMonth);
  const currentView = useCalendarStore((s) => s.currentView);
  const selectedDate = useCalendarStore((s) => s.selectedDate);
  const setSelectedDate = useCalendarStore((s) => s.setSelectedDate);
  const getEventsForMonth = useCalendarStore((s) => s.getEventsForMonth);
  const getPomodoroHeatMap = useCalendarStore((s) => s.getPomodoroHeatMap);
  const todos = useTodoStore((s) => s.todos);

  // Hooks must be called BEFORE any early returns (Rules of Hooks)
  const completedTodoSet = useMemo(() => {
    const completed = Object.values(todos).filter((t) => t.status === 'completed');
    return {
      ids: new Set(completed.map((t) => t.id)),
      titles: new Set(completed.map((t) => t.title)),
    };
  }, [todos]);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const rawEvents = getEventsForMonth(year, month);

  const eventsByDate: Record<string, CalendarEvent[]> = {};
  rawEvents.forEach((event) => {
    if (event.type === 'pomodoro') return;
    if (event.type === 'todo') {
      if (event.todoId && completedTodoSet.ids.has(event.todoId)) return;
      if (!event.todoId && completedTodoSet.titles.has(event.title)) return;
    }
    if (!eventsByDate[event.date]) eventsByDate[event.date] = [];
    eventsByDate[event.date].push(event);
  });

  const handleEventClick = useCallback(() => {}, []);

  // Now safe to branch
  if (currentView === 'week') {
    return <WeekView />;
  }

  const days = getMonthDays(currentMonth);
  const weekDays = getWeekDayNames();
  const heatMap = getPomodoroHeatMap(year, month);

  return (
    <div>
      <div className="grid grid-cols-7 mb-2">
        {weekDays.map((day) => (
          <div key={day} className="text-center text-xs font-medium text-[#6b7280] py-2">
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((date) => {
          const dateStr = toISODateString(date);
          return (
            <DayCell
              key={dateStr}
              date={date}
              events={eventsByDate[dateStr] || []}
              isSelected={selectedDate === dateStr}
              isCurrentMonth={isCurrentMonth(date, currentMonth)}
              heatLevel={heatMap[dateStr] || 0}
              onSelect={setSelectedDate}
              onDoubleClick={onDayDoubleClick}
              onEventClick={handleEventClick}
            />
          );
        })}
      </div>
    </div>
  );
};
