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
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <button
          onClick={handleToday}
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-sm font-medium text-[var(--text-secondary)] bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-lg hover:bg-[var(--bg-base)] transition-colors"
        >
          <Calendar size={14} />
          今天
        </button>

        <div className="flex shrink-0 items-center">
          <button
            onClick={handlePrev}
            className="p-1.5 hover:bg-[var(--bg-base)] rounded-lg transition-colors"
          >
            <ChevronLeft size={20} className="text-[var(--text-secondary)]" />
          </button>
          <button
            onClick={handleNext}
            className="p-1.5 hover:bg-[var(--bg-base)] rounded-lg transition-colors"
          >
            <ChevronRight size={20} className="text-[var(--text-secondary)]" />
          </button>
        </div>

        <h2 className="calendar-toolbar-title min-w-0 flex-1 text-base font-semibold text-[var(--text-primary)] md:text-lg">
          {titleText}
        </h2>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1 bg-[var(--bg-base)] rounded-lg p-0.5">
        <button
          onClick={() => setView('month')}
          className={`whitespace-nowrap px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
            currentView === 'month'
              ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          月
        </button>
        <button
          onClick={() => setView('week')}
          className={`whitespace-nowrap px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
            currentView === 'week'
              ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          周
        </button>
      </div>
    </div>
  );
};
