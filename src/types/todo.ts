import type { ID, ISODateString, ISODateTimeString } from './common';

export type TodoPriority = 'high' | 'medium' | 'low' | 'green';
export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export interface TodoTag {
  id: ID;
  name: string;
  color: string;
}

export interface Todo {
  id: ID;
  title: string;
  description: string;
  priority: TodoPriority;
  tags: ID[];
  dueDate: ISODateString | null;
  startDate: ISODateString | null;
  startTime: string | null;
  endTime: string | null;
  reminderAt: ISODateTimeString | null;
  status: TodoStatus;
  pomodoroCount: number;
  pomodoroRounds: number;
  totalFocusMinutes: number;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
  completedAt?: ISODateTimeString | null;
  calendarEventId: ID | null;
}

export const PRIORITY_COLORS: Record<TodoPriority, string> = {
  high: '#e8a0a0',    // soft pink - sticky note
  medium: '#e8d4a0',  // warm yellow - sticky note
  low: '#a0c4e8',     // soft blue - sticky note
  green: '#a0d4a0',   // soft green - sticky note
};

export const PRIORITY_LABELS: Record<TodoPriority, string> = {
  high: '粉',
  medium: '黄',
  low: '蓝',
  green: '绿',
};
