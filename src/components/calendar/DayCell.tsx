import React from 'react';
import type { ISODateString, ScheduleCalendarEvent, ScheduleItem } from '../../types';
import { isTodayCheck, toISODateString } from '../../lib/date';
import { EventChip } from './EventChip';

interface DayCellProps {
  date: Date;
  events: ScheduleCalendarEvent[];
  completedTodos?: ScheduleItem[];
  pendingTodos?: ScheduleItem[];
  isSelected: boolean;
  isCurrentMonth: boolean;
  heatLevel: number;
  onSelect: (date: ISODateString) => void;
  onDoubleClick?: (date: ISODateString) => void;
  onEventClick?: (event: ScheduleCalendarEvent) => void;
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
  completedTodos = [],
  pendingTodos = [],
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
  const visibleCompletedTodos = completedTodos.slice(0, 1);
  const visiblePending = pendingTodos.slice(0, 2);

  return (
    <button
      onClick={() => onSelect(dateStr)}
      onDoubleClick={() => onDoubleClick?.(dateStr)}
      className={`relative h-[52px] md:h-[76px] p-1 rounded-lg border transition-all hover:shadow-md overflow-hidden ${
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
        className={`text-[10px] md:text-xs font-medium mb-0.5 ${
          isToday
            ? 'w-4 h-4 md:w-5 md:h-5 flex items-center justify-center bg-[#c87d2f] text-white rounded-full mx-auto text-[8px] md:text-[10px]'
            : 'text-[#1a1a1a]'
        }`}
      >
        {dayNumber}
      </div>

      <div className="space-y-0.5 overflow-y-auto max-h-[28px] md:max-h-[42px]">
        {events.map((event) => (
          <EventChip
            key={event.id}
            event={event}
            onClick={() => onEventClick?.(event)}
          />
        ))}
        {events.length === 0 && visiblePending.map((todo) => (
          <div
            key={todo.id}
            className="truncate rounded px-1 py-0.5 text-left text-[8px] md:text-[10px] leading-2.5 md:leading-3 text-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]"
            title={todo.title}
          >
            {todo.priority === 'high' ? '!' : ''} {todo.title}
          </div>
        ))}
        {events.length === 0 && pendingTodos.length > visiblePending.length && (
          <div className="truncate px-1 text-left text-[8px] md:text-[10px] leading-2.5 text-[var(--text-muted)]">
            +{pendingTodos.length - visiblePending.length} 个待办
          </div>
        )}
        {events.length === 0 && pendingTodos.length === 0 && visibleCompletedTodos.length > 0 && (
          <div className="truncate rounded px-1 py-0.5 text-left text-[8px] md:text-[10px] leading-2.5 md:leading-3 text-[var(--success)] bg-[color-mix(in_srgb,var(--success)_10%,transparent)]">
            ✓ {visibleCompletedTodos[0].title}
          </div>
        )}
      </div>
    </button>
  );
});
