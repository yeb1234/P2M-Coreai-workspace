import React from 'react';
import type { ScheduleCalendarEvent } from '../../types';

interface EventChipProps {
  event: ScheduleCalendarEvent;
  onClick?: () => void;
}

export const EventChip: React.FC<EventChipProps> = React.memo(({ event, onClick }) => {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-1.5 py-0.5 text-xs leading-tight rounded truncate transition-colors hover:opacity-80"
      style={{
        backgroundColor: event.color,
        color: '#fff',
      }}
      title={event.title}
    >
      {event.title}
    </button>
  );
});
