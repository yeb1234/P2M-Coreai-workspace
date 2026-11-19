import type { ID, ISODateTimeString } from './common';

export interface WorldClock {
  id: ID;
  label: string;
  timeZone: string;
}

export interface TimeAlarm {
  id: ID;
  label: string;
  time: string;
  enabled: boolean;
  lastTriggeredDate: string | null;
  createdAt: ISODateTimeString;
}

export interface TimeReminder {
  id: ID;
  title: string;
  remindAt: ISODateTimeString;
  enabled: boolean;
  triggeredAt: ISODateTimeString | null;
  source: 'manual' | 'todo';
  todoId: ID | null;
  createdAt: ISODateTimeString;
}

export interface CountdownPreset {
  id: ID;
  label: string;
  seconds: number;
}
