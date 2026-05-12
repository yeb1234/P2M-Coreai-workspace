import { PRIORITY_COLORS, type ISODateTimeString, type ScheduleCalendarEvent, type ScheduleItem, type Todo } from '../types';
import { toLocalDateString } from './date';

const FALLBACK_HOUR = 9;
type ScheduledScheduleItem = ScheduleItem & { startAt: ISODateTimeString; dueAt: ISODateTimeString };

export function floorToMinute(date: Date): Date {
  const next = new Date(date);
  next.setSeconds(0, 0);
  return next;
}

export function toMinuteISOString(date: Date): string {
  return floorToMinute(date).toISOString();
}

export function combineLocalDateTime(date: string, time: string): string {
  return toMinuteISOString(new Date(`${date}T${time}:00`));
}

export function defaultDueAt(startAt: string, minutes = 60): string {
  const start = new Date(startAt);
  start.setMinutes(start.getMinutes() + minutes);
  return toMinuteISOString(start);
}

export function datePart(iso: string): string {
  return toLocalDateString(iso);
}

export function timePart(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function dateTimeParts(iso: string): { date: string; time: string } {
  return { date: datePart(iso), time: timePart(iso) };
}

export function hasScheduleTime<T extends Pick<ScheduleItem, 'startAt' | 'dueAt'>>(item: T): item is T & { startAt: ISODateTimeString; dueAt: ISODateTimeString } {
  return Boolean(item.startAt && item.dueAt);
}

export function defaultStartAtForDate(date?: string | null): string {
  const target = date ? new Date(`${date}T${String(FALLBACK_HOUR).padStart(2, '0')}:00:00`) : new Date();
  if (!date) {
    target.setHours(FALLBACK_HOUR, 0, 0, 0);
  }
  return toMinuteISOString(target);
}

export function scheduleItemToTodo(item: ScheduleItem): Todo {
  const start = item.startAt ? dateTimeParts(item.startAt) : null;
  const due = item.dueAt ? dateTimeParts(item.dueAt) : null;
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    priority: item.priority,
    tags: [],
    dueDate: due?.date ?? null,
    startDate: start?.date ?? null,
    startTime: start?.time ?? null,
    endTime: due?.time ?? null,
    reminderAt: item.reminderAt,
    status: item.status,
    pomodoroCount: item.pomodoroCount,
    pomodoroRounds: item.pomodoroRounds,
    totalFocusMinutes: item.totalFocusMinutes,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    completedAt: item.completedAt,
    calendarEventId: null,
  };
}

export function scheduleItemToCalendarEvent(item: ScheduledScheduleItem): ScheduleCalendarEvent {
  const start = dateTimeParts(item.startAt);
  const due = dateTimeParts(item.dueAt);
  return {
    id: item.id,
    title: item.title,
    date: start.date,
    startTime: start.time,
    endTime: due.time,
    type: item.type,
    color: item.type === 'todo' ? PRIORITY_COLORS[item.priority] : '#8b5cf6',
    itemId: item.id,
    description: item.description,
  };
}
