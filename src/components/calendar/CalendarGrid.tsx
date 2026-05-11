import React, { useMemo, useCallback, useState } from 'react';
import { X, CheckCircle2, ListTodo } from 'lucide-react';
import { useCalendarStore, useTodoStore } from '../../stores';
import { getMonthDays, getWeekDayNames, isCurrentMonth, toISODateString } from '../../lib/date';
import { DayCell } from './DayCell';
import { WeekView } from './WeekView';
import type { ISODateString } from '../../types';
import {
  createCompletedTodoLookup,
  getEventsForCalendarMonth,
  getPomodoroHeatMapForMonth,
  groupCalendarEventsByDate,
  groupTodosByCalendarDate,
} from './calendarDerivedData';
import { useIsMobile } from '../../hooks/useMediaQuery';

interface CalendarGridProps {
  onDayDoubleClick?: (date: ISODateString) => void;
}

export const CalendarGrid: React.FC<CalendarGridProps> = ({ onDayDoubleClick }) => {
  const rawMonth = useCalendarStore((s) => s.currentMonth);
  const currentMonth = rawMonth instanceof Date ? rawMonth : new Date(rawMonth);
  const currentView = useCalendarStore((s) => s.currentView);
  const selectedDate = useCalendarStore((s) => s.selectedDate);
  const setSelectedDate = useCalendarStore((s) => s.setSelectedDate);
  const calendarEvents = useCalendarStore((s) => s.events);
  const todos = useTodoStore((s) => s.todos);
  const isMobile = useIsMobile();

  const completedTodoLookup = useMemo(() => createCompletedTodoLookup(todos), [todos]);
  const { pendingByDate: pendingTodosByDate, completedByDate: completedTodosByDate } = useMemo(
    () => groupTodosByCalendarDate(todos),
    [todos],
  );

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const rawEvents = useMemo(
    () => getEventsForCalendarMonth(calendarEvents, year, month),
    [calendarEvents, year, month],
  );

  const eventsByDate = useMemo(
    () => groupCalendarEventsByDate(rawEvents, completedTodoLookup),
    [rawEvents, completedTodoLookup],
  );
  const days = useMemo(() => getMonthDays(currentMonth), [currentMonth]);
  const weekDays = useMemo(() => getWeekDayNames(), []);
  const heatMap = useMemo(
    () => getPomodoroHeatMapForMonth(calendarEvents, year, month),
    [calendarEvents, year, month],
  );

  const handleEventClick = useCallback(() => {}, []);

  const [popupDate, setPopupDate] = useState<ISODateString | null>(null);
  const handleDaySelect = useCallback((dateStr: ISODateString) => {
    setSelectedDate(dateStr);
    if (isMobile) setPopupDate(dateStr);
  }, [isMobile, setSelectedDate]);

  // Now safe to branch
  if (currentView === 'week') {
    return <WeekView />;
  }

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
              completedTodos={completedTodosByDate[dateStr] || []}
              pendingTodos={pendingTodosByDate[dateStr] || []}
              isSelected={selectedDate === dateStr}
              isCurrentMonth={isCurrentMonth(date, currentMonth)}
              heatLevel={heatMap[dateStr] || 0}
              onSelect={handleDaySelect}
              onDoubleClick={onDayDoubleClick}
              onEventClick={handleEventClick}
            />
          );
        })}
      </div>

      {popupDate && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={() => setPopupDate(null)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl p-4 max-h-[60vh] overflow-y-auto safe-area-pb"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-[#1a1a1a]">{popupDate}</h3>
              <button onClick={() => setPopupDate(null)} className="p-1.5 rounded-lg text-[#9ca3af] hover:text-[#1a1a1a]">
                <X size={16} />
              </button>
            </div>
            {(eventsByDate[popupDate] || []).length === 0 && (pendingTodosByDate[popupDate] || []).length === 0 && (completedTodosByDate[popupDate] || []).length === 0 && (
              <p className="text-xs text-[#9ca3af] text-center py-4">当天无内容</p>
            )}
            {(pendingTodosByDate[popupDate] || []).length > 0 && (
              <div className="mb-3">
                <p className="text-[10px] font-medium text-[#c87d2f] mb-1.5 flex items-center gap-1"><ListTodo size={11} /> 待办</p>
                {(pendingTodosByDate[popupDate] || []).map((t) => (
                  <div key={t.id} className="flex items-center gap-2 py-1.5 border-b border-[#e5e2dd] last:border-0">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: t.priority === 'high' ? '#e8a0a0' : t.priority === 'medium' ? '#e8d4a0' : t.priority === 'low' ? '#a0c4e8' : '#a0d4a0' }} />
                    <span className="text-xs text-[#1a1a1a] truncate flex-1">{t.title}</span>
                    {t.pomodoroRounds > 0 && <span className="text-[10px] text-[#9ca3af]">{t.pomodoroRounds}轮</span>}
                  </div>
                ))}
              </div>
            )}
            {(eventsByDate[popupDate] || []).length > 0 && (
              <div className="mb-3">
                <p className="text-[10px] font-medium text-[#6b7280] mb-1.5">日程</p>
                {(eventsByDate[popupDate] || []).map((e) => (
                  <div key={e.id} className="py-1.5 border-b border-[#e5e2dd] last:border-0">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: e.color }} />
                      <span className="text-xs text-[#1a1a1a]">{e.title}</span>
                      {e.startTime && <span className="ml-auto text-[10px] text-[#9ca3af]">{e.startTime}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {(completedTodosByDate[popupDate] || []).length > 0 && (
              <div>
                <p className="text-[10px] font-medium text-[#16a34a] mb-1.5 flex items-center gap-1"><CheckCircle2 size={11} /> 已完成</p>
                {(completedTodosByDate[popupDate] || []).slice(0, 5).map((t) => (
                  <div key={t.id} className="py-1 border-b border-[#e5e2dd] last:border-0">
                    <span className="text-xs text-[#9ca3af] line-through">{t.title}</span>
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
