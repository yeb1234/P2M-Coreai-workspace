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
  'color-mix(in srgb, var(--accent) 10%, var(--bg-card))',
  'color-mix(in srgb, var(--accent) 16%, var(--bg-card))',
  'color-mix(in srgb, var(--accent) 24%, var(--bg-card))',
  'color-mix(in srgb, var(--accent) 32%, var(--bg-card))',
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
          ? 'linear-gradient(160deg, color-mix(in srgb, var(--accent) 24%, var(--bg-card)) 0%, color-mix(in srgb, var(--accent) 12%, var(--bg-card)) 100%)'
          : heatLevel > 0
          ? HEAT_COLORS[Math.min(heatLevel, 4)]
          : 'linear-gradient(160deg, var(--bg-card) 0%, var(--bg-elevated) 100%)',
        borderColor: isSelected ? 'var(--accent)' : 'var(--border-light)',
        boxShadow: isSelected ? 'var(--shadow-card)' : 'none',
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

      <div className="space-y-0.5 overflow-y-auto max-h-[42px]">
        {events.map((event) => (
          <EventChip
            key={event.id}
            event={event}
            onClick={() => onEventClick?.(event)}
          />
        ))}
      </div>
    </button>
  );
});
