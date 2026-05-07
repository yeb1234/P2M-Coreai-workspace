import React, { useMemo, useCallback } from 'react';
import { useCalendarStore } from '../../stores';
import { getWeekDays, getWeekDayNames, isTodayCheck, toISODateString } from '../../lib/date';
import type { ISODateString } from '../../types';

export const WeekView: React.FC = () => {
  const currentMonth = useCalendarStore((s) => s.currentMonth);
  const selectedDate = useCalendarStore((s) => s.selectedDate);
  const setSelectedDate = useCalendarStore((s) => s.setSelectedDate);
  const getEventsForDate = useCalendarStore((s) => s.getEventsForDate);

  const weekDays = getWeekDays(currentMonth);
  const dayNames = getWeekDayNames();

  return (
    <div className="grid grid-cols-7 gap-2">
      {weekDays.map((date, idx) => {
        const dateStr = toISODateString(date);
        const events = getEventsForDate(dateStr);
        const isToday = isTodayCheck(date);
        const isSelected = selectedDate === dateStr;

        return (
          <button
            key={dateStr}
            type="button"
            onClick={() => setSelectedDate(dateStr)}
            className={`flex flex-col text-left rounded-xl border transition-all hover:shadow-md ${
              isSelected
                ? 'border-[#c87d2f] ring-1 ring-[#c87d2f]'
                : 'border-[#e5e2dd] hover:border-[#d1cdc6]'
            }`}
            style={{
              background: isSelected
                ? 'linear-gradient(160deg, #e8d4a030 0%, #e8d4a015 50%, #e8d4a008 100%)'
                : 'linear-gradient(160deg, #faf9f7 0%, #f5f3ef 100%)',
              boxShadow: isSelected ? '2px 2px 0px #e8d4a020, 0 1px 3px rgba(0,0,0,0.04)' : '1px 1px 0px #e8d4a010',
            }}
          >
            <div className="text-center py-2 border-b border-[#e5e2dd]">
              <div className="text-[10px] text-[#9ca3af] mb-0.5">{dayNames[idx]}</div>
              <span
                className={`inline-flex items-center justify-center w-7 h-7 text-sm font-medium rounded-full ${
                  isToday
                    ? 'bg-[#c87d2f] text-white'
                    : isSelected
                    ? 'text-[#c87d2f] font-bold'
                    : 'text-[#1a1a1a]'
                }`}
              >
                {date.getDate()}
              </span>
            </div>

            <div className="flex-1 space-y-1 min-h-[100px] p-1.5">
              {events.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <span className="text-[9px] text-[#d1cdc6]">-</span>
                </div>
              ) : (
                events.map((event) => (
                  <div
                    key={event.id}
                    className="text-[11px] p-1.5 rounded"
                    style={{
                      background: `${event.color}28`,
                      borderLeft: `2px solid ${event.color}`,
                    }}
                  >
                    <div className="font-medium text-[#1a1a1a] truncate">{event.title}</div>
                    {event.startTime && (
                      <div className="text-[10px] text-[#6b7280]">{event.startTime}</div>
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
