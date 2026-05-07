import React from 'react';
import { Calendar } from 'lucide-react';
import { useCalendarStore, useUIStore } from '../../../stores';
import { formatDate, toLocalDateString } from '../../../lib/date';

export const CalendarSummary: React.FC = () => {
  const { getEventsForDate } = useCalendarStore();
  const { setActiveView } = useUIStore();
  const today = toLocalDateString(new Date());
  const todayEvents = getEventsForDate(today);
  const displayEvents = todayEvents.slice(0, 3);
  const hasMore = todayEvents.length > 3;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium text-[#6b7280]">
          <Calendar size={12} />
          <span>{formatDate(new Date(), 'MM月dd日')}</span>
        </div>
        <span className="text-[10px] font-semibold text-[#c87d2f] bg-[#fef7ed] px-1.5 py-0.5 rounded-md">{todayEvents.length}</span>
      </div>

      {todayEvents.length === 0 ? (
        <p className="text-xs text-[#b8b4ac] text-center py-3">今日无事件</p>
      ) : (
        <div className="space-y-1">
          {displayEvents.map((event, idx) => {
            const isLast = idx === 2 && hasMore;
            return (
              <div
                key={event.id}
                className={`flex items-center gap-2 text-xs p-2 rounded-lg ${
                  isLast ? 'cursor-pointer hover:bg-[#fef7ed] transition-colors' : 'bg-[#faf9f7]'
                }`}
                style={!isLast ? {
                  background: `linear-gradient(135deg, ${event.color}15 0%, transparent 100%)`,
                  borderLeft: `3px solid ${event.color}`,
                } : undefined}
                onClick={() => { if (isLast) setActiveView('calendar'); }}
              >
                {isLast ? (
                  <span className="text-[#b8b4ac] font-medium">...还有 {todayEvents.length - 2} 项</span>
                ) : (
                  <>
                    <span className="truncate text-[#1a1a1a] font-medium">{event.title}</span>
                    {event.startTime && (
                      <span className="text-[10px] text-[#9ca3af] ml-auto flex-shrink-0">{event.startTime}</span>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
