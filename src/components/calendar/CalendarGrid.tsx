import React, { useMemo, useCallback } from 'react';
import { useCalendarStore } from '../../stores';
import { getMonthDays, getWeekDayNames, isCurrentMonth, toISODateString } from '../../lib/date';
import { DayCell } from './DayCell';
import { WeekView } from './WeekView';
import type { CalendarEvent, ISODateString } from '../../types';

interface CalendarGridProps {
  onDayDoubleClick?: (date: ISODateString) => void;
}

export const CalendarGrid: React.FC<CalendarGridProps> = ({ onDayDoubleClick }) => {
  const currentMonth = useCalendarStore((s) => s.currentMonth);
  const currentView = useCalendarStore((s) => s.currentView);
  const selectedDate = useCalendarStore((s) => s.selectedDate);
  const setSelectedDate = useCalendarStore((s) => s.setSelectedDate);
  const getEventsForMonth = useCalendarStore((s) => s.getEventsForMonth);
  const getPomodoroHeatMap = useCalendarStore((s) => s.getPomodoroHeatMap);

  if (currentView === 'week') {
    return <WeekView />;
  }

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const days = getMonthDays(currentMonth);
  const weekDays = getWeekDayNames();
  const events = getEventsForMonth(year, month);
  const heatMap = getPomodoroHeatMap(year, month);

  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    events.forEach((event) => {
      if (!map[event.date]) map[event.date] = [];
      map[event.date].push(event);
    });
    return map;
  }, [events]);

  const handleEventClick = useCallback(() => {}, []);

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
