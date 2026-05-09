import React from 'react';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { formatDate, getNextMonth, getPrevMonth, getNextWeek, getPrevWeek, getWeekDays } from '../../lib/date';
import { useCalendarStore } from '../../stores';

export const CalendarToolbar: React.FC = () => {
  const rawMonth = useCalendarStore((s) => s.currentMonth);
  const currentMonth = rawMonth instanceof Date ? rawMonth : new Date(rawMonth);
  const setCurrentMonth = useCalendarStore((s) => s.setCurrentMonth);
  const currentView = useCalendarStore((s) => s.currentView);
  const setView = useCalendarStore((s) => s.setView);

  const isWeek = currentView === 'week';

  const handlePrev = () => {
    setCurrentMonth(isWeek ? getPrevWeek(currentMonth) : getPrevMonth(currentMonth));
  };

  const handleNext = () => {
    setCurrentMonth(isWeek ? getNextWeek(currentMonth) : getNextMonth(currentMonth));
  };

  const handleToday = () => {
    setCurrentMonth(new Date());
  };

  const titleText = isWeek
    ? (() => {
        const days = getWeekDays(currentMonth);
        const start = days[0];
        const end = days[6];
        const sameMonth = start.getMonth() === end.getMonth();
        if (sameMonth) {
          return `${start.getFullYear()}年${start.getMonth() + 1}月 ${start.getDate()}-${end.getDate()}日`;
        }
        return `${start.getMonth() + 1}月${start.getDate()}日 - ${end.getMonth() + 1}月${end.getDate()}日`;
      })()
    : formatDate(currentMonth, 'yyyy年MM月');

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <button
          onClick={handleToday}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[#6b7280] bg-[#faf9f7] border border-[#e5e2dd] rounded-lg hover:bg-[#f3f2ef] transition-colors"
        >
          <Calendar size={14} />
          今天
        </button>

        <div className="flex items-center">
          <button
            onClick={handlePrev}
            className="p-1.5 hover:bg-[#f3f2ef] rounded-lg transition-colors"
          >
            <ChevronLeft size={20} className="text-[#6b7280]" />
          </button>
          <button
            onClick={handleNext}
            className="p-1.5 hover:bg-[#f3f2ef] rounded-lg transition-colors"
          >
            <ChevronRight size={20} className="text-[#6b7280]" />
          </button>
        </div>

        <h2 className="text-lg font-semibold text-[#1a1a1a]">
          {titleText}
        </h2>
      </div>

      <div className="flex items-center gap-1 bg-[#f3f2ef] rounded-lg p-0.5">
        <button
          onClick={() => setView('month')}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            currentView === 'month'
              ? 'bg-[#faf9f7] text-[#1a1a1a] shadow-sm'
              : 'text-[#6b7280] hover:text-[#1a1a1a]'
          }`}
        >
          月
        </button>
        <button
          onClick={() => setView('week')}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            currentView === 'week'
              ? 'bg-[#faf9f7] text-[#1a1a1a] shadow-sm'
              : 'text-[#6b7280] hover:text-[#1a1a1a]'
          }`}
        >
          周
        </button>
      </div>
    </div>
  );
};
