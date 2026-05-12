import type { ID, ISODateString, ISODateTimeString, TimeString } from './common';
import type { TodoPriority, TodoStatus } from './todo';

export type ScheduleItemType = 'todo' | 'event';

export interface ScheduleItem {
  id: ID;
  type: ScheduleItemType;
  title: string;
  description: string;
  status: TodoStatus;
  priority: TodoPriority;
  startAt: ISODateTimeString | null;
  dueAt: ISODateTimeString | null;
  reminderAt: ISODateTimeString | null;
  pomodoroCount: number;
  pomodoroRounds: number;
  totalFocusMinutes: number;
  completedAt: ISODateTimeString | null;
  deletedAt: ISODateTimeString | null;
  sortOrder: number;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
}

export interface ScheduleItemInput {
  type?: ScheduleItemType;
  title: string;
  description?: string;
  status?: TodoStatus;
  priority?: TodoPriority;
  startAt?: ISODateTimeString | null;
  dueAt?: ISODateTimeString | null;
  reminderAt?: ISODateTimeString | null;
  pomodoroCount?: number;
  pomodoroRounds?: number;
  totalFocusMinutes?: number;
  completedAt?: ISODateTimeString | null;
  deletedAt?: ISODateTimeString | null;
  sortOrder?: number;
}

export type ScheduleItemUpdate = Partial<ScheduleItemInput>;

export interface ScheduleFilters {
  priority: TodoPriority | null;
  status: TodoStatus | 'all';
  searchQuery: string;
}

export interface ScheduleCalendarEvent {
  id: ID;
  title: string;
  date: ISODateString;
  startTime?: TimeString;
  endTime?: TimeString;
  type: 'todo' | 'event';
  color: string;
  itemId: ID;
  description?: string;
}
