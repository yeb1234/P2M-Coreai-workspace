import type { ID, ISODateString, ISODateTimeString, TimeString } from './common';

export type CalendarViewType = 'month' | 'week';
export type EventType = 'todo' | 'event' | 'pomodoro' | 'reminder';

export interface CalendarEvent {
  id: ID;
  title: string;
  date: ISODateString;
  startTime?: TimeString;
  endTime?: TimeString;
  type: EventType;
  color: string;
  todoId: ID | null;
  pomodoroSessionId: ID | null;
  description?: string;
  createdAt: ISODateTimeString;
}

