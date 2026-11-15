import React, { useCallback, useMemo, useState } from 'react';
import { X, CheckCircle2, ListTodo } from 'lucide-react';
import { useCalendarStore, useScheduleStore } from '../../stores';
import { getMonthDays, getWeekDayNames, isCurrentMonth, toISODateString } from '../../lib/date';
import { DayCell } from './DayCell';
import { WeekView } from './WeekView';
import type { ISODateString } from '../../types';
import { getItemsForCalendarMonth, groupScheduleItemsByDate } from './calendarDerivedData';
import { useIsMobile } from '../../hooks/useMediaQuery';

interface CalendarGridProps {
  onDayDoubleClick?: (date: ISODateString) => void;
}

export const CalendarGrid: React.FC<CalendarGridProps> = ({ onDayDoubleClick }) => {
  const rawMonth = useCalendarStore((s) => s.currentMonth);
  const currentMonth = useMemo(() => rawMonth instanceof Date ? rawMonth : new Date(rawMonth), [rawMonth]);
  const currentView = useCalendarStore((s) => s.currentView);
  const selectedDate = useCalendarStore((s) => s.selectedDate);
  const setSelectedDate = useCalendarStore((s) => s.setSelectedDate);
  const scheduleItems = useScheduleStore((s) => s.items);
  const isMobile = useIsMobile();
  const [popupDate, setPopupDate] = useState<ISODateString | null>(null);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const monthItems = useMemo(() => getItemsForCalendarMonth(scheduleItems, year, month), [month, scheduleItems, year]);
  const { eventsByDate, pendingByDate, completedByDate } = useMemo(() => groupScheduleItemsByDate(monthItems), [monthItems]);
  const days = useMemo(() => getMonthDays(currentMonth), [currentMonth]);
  const weekDays = useMemo(() => getWeekDayNames(), []);

  const handleDaySelect = useCallback((dateStr: ISODateString) => {
    setSelectedDate(dateStr);
    if (isMobile) setPopupDate(dateStr);
  }, [isMobile, setSelectedDate]);

  if (currentView === 'week') {
    return <WeekView onDayDoubleClick={onDayDoubleClick} />;
  }

  return (
    <div>
      <div className="grid grid-cols-7 mb-2">
        {weekDays.map((day) => (
          <div key={day} className="text-center text-xs font-medium text-[var(--text-secondary)] py-2">
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
              completedTodos={completedByDate[dateStr] || []}
              pendingTodos={pendingByDate[dateStr] || []}
              isSelected={selectedDate === dateStr}
              isCurrentMonth={isCurrentMonth(date, currentMonth)}
              heatLevel={0}
              onSelect={handleDaySelect}
              onDoubleClick={onDayDoubleClick}
            />
          );
        })}
      </div>

      {popupDate && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={() => setPopupDate(null)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl p-4 max-h-[60vh] overflow-y-auto safe-area-pb"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-[var(--text-primary)]">{popupDate}</h3>
              <button onClick={() => setPopupDate(null)} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                <X size={16} />
              </button>
            </div>
            {(eventsByDate[popupDate] || []).length === 0 && (pendingByDate[popupDate] || []).length === 0 && (completedByDate[popupDate] || []).length === 0 && (
              <p className="text-xs text-[var(--text-muted)] text-center py-4">当天无内容</p>
            )}
            {(pendingByDate[popupDate] || []).length > 0 && (
              <div className="mb-3">
                <p className="text-[10px] font-medium text-[var(--accent)] mb-1.5 flex items-center gap-1"><ListTodo size={11} /> 待办</p>
                {(pendingByDate[popupDate] || []).map((todo) => (
                  <div key={todo.id} className="flex items-center gap-2 py-1.5 border-b border-[var(--border-light)] last:border-0">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: todo.priority === 'high' ? '#e8a0a0' : todo.priority === 'medium' ? '#e8d4a0' : todo.priority === 'low' ? '#a0c4e8' : '#a0d4a0' }} />
                    <span className="text-xs text-[var(--text-primary)] truncate flex-1">{todo.title}</span>
                    {todo.pomodoroRounds > 0 && <span className="text-[10px] text-[var(--text-muted)]">{todo.pomodoroRounds}轮</span>}
                  </div>
                ))}
              </div>
            )}
            {(eventsByDate[popupDate] || []).length > 0 && (
              <div className="mb-3">
                <p className="text-[10px] font-medium text-[var(--text-secondary)] mb-1.5">日程</p>
                {(eventsByDate[popupDate] || []).map((event) => (
                  <div key={event.id} className="py-1.5 border-b border-[var(--border-light)] last:border-0">
                    <div className="rounded px-2 py-1 text-xs font-medium text-white truncate" style={{ background: event.color }}>
                      {event.title}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {(completedByDate[popupDate] || []).length > 0 && (
              <div>
                <p className="text-[10px] font-medium text-[var(--success)] mb-1.5 flex items-center gap-1"><CheckCircle2 size={11} /> 已完成</p>
                {(completedByDate[popupDate] || []).slice(0, 5).map((todo) => (
                  <div key={todo.id} className="py-1 border-b border-[var(--border-light)] last:border-0">
                    <span className="text-xs text-[var(--text-muted)] line-through">{todo.title}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
