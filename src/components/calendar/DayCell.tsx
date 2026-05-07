import React from 'react';
import type { CalendarEvent, ISODateString } from '../../types';
import { isTodayCheck, toISODateString } from '../../lib/date';
import { EventChip } from './EventChip';

interface DayCellProps {
  date: Date;
  events: CalendarEvent[];
  isSelected: boolean;
  isCurrentMonth: boolean;
  heatLevel: number;
  onSelect: (date: ISODateString) => void;
  onDoubleClick?: (date: ISODateString) => void;
  onEventClick?: (event: CalendarEvent) => void;
}

const HEAT_COLORS = [
  'transparent',
  'rgba(200, 125, 47, 0.08)',
  'rgba(200, 125, 47, 0.15)',
  'rgba(200, 125, 47, 0.25)',
  'rgba(200, 125, 47, 0.35)',
];

export const DayCell: React.FC<DayCellProps> = React.memo(({
  date,
  events,
  isSelected,
  isCurrentMonth: isInMonth,
  heatLevel,
  onSelect,
  onDoubleClick,
  onEventClick,
}) => {
  const isToday = isTodayCheck(date);
  const dayNumber = date.getDate();
  const dateStr = toISODateString(date);

  return (
    <button
      onClick={() => onSelect(dateStr)}
      onDoubleClick={() => onDoubleClick?.(dateStr)}
      className={`relative h-[76px] p-1.5 rounded-lg border transition-all hover:shadow-md overflow-hidden ${
        isSelected ? 'ring-2 ring-[#c87d2f] border-[#c87d2f]' : ''
      } ${!isInMonth ? 'opacity-40' : ''}`}
      style={{
        background: isSelected
          ? 'linear-gradient(160deg, #e8d4a030 0%, #e8d4a015 50%, #e8d4a008 100%)'
          : heatLevel > 0
          ? HEAT_COLORS[Math.min(heatLevel, 4)]
          : 'linear-gradient(160deg, #faf9f7 0%, #f5f3ef 100%)',
        borderColor: isSelected ? '#c87d2f' : '#e5e2dd',
        boxShadow: isSelected ? '2px 2px 0px #e8d4a020, 0 1px 3px rgba(0,0,0,0.04)' : '1px 1px 0px #e8d4a010',
      }}
    >
      <div
        className={`text-xs font-medium mb-0.5 ${
          isToday
            ? 'w-5 h-5 flex items-center justify-center bg-[#c87d2f] text-white rounded-full mx-auto text-[10px]'
            : 'text-[#1a1a1a]'
        }`}
      >
        {dayNumber}
      </div>

      <div className="space-y-0.5">
        {events.slice(0, 3).map((event) => (
          <EventChip
            key={event.id}
            event={event}
            onClick={() => onEventClick?.(event)}
          />
        ))}
        {events.length > 3 && (
          <span className="text-[10px] text-[#9ca3af] pl-1">
            +{events.length - 3}更多
          </span>
        )}
      </div>
    </button>
  );
});
