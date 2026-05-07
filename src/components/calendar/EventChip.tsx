import React from 'react';
import type { CalendarEvent } from '../../types';

interface EventChipProps {
  event: CalendarEvent;
  onClick?: () => void;
}

export const EventChip: React.FC<EventChipProps> = React.memo(({ event, onClick }) => {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-1.5 py-0.5 text-[11px] leading-tight rounded truncate transition-colors hover:opacity-80"
      style={{
        backgroundColor: `${event.color}28`,
        borderLeft: `2px solid ${event.color}`,
        color: '#1a1a1a',
      }}
      title={event.title}
    >
      {event.title}
    </button>
  );
});
