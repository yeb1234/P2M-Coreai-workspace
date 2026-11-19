import { PRIORITY_COLORS, type ISODateTimeString, type ScheduleCalendarEvent, type ScheduleItem } from '../types';
import { toLocalDateString } from './date';

type ScheduledScheduleItem = ScheduleItem & { startAt: ISODateTimeString; dueAt: ISODateTimeString };

export function floorToMinute(date: Date): Date {
  const next = new Date(date);
  next.setSeconds(0, 0);
  return next;
}

export function toMinuteISOString(date: Date): string {
  const d = floorToMinute(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`;
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

export function getNextWholeHour(now = new Date()): { date: string; startTime: string; endTime: string; endDate: string } {
  const d = new Date(now);
  if (d.getMinutes() !== 0 || d.getSeconds() !== 0 || d.getMilliseconds() !== 0) {
    d.setHours(d.getHours() + 1, 0, 0, 0);
  } else {
    d.setMinutes(0, 0, 0);
  }
  const startDate = toLocalDateString(d);
  const startHour = d.getHours();

  const endD = new Date(d);
  endD.setHours(startHour + 1, 0, 0, 0);
  const endDate = toLocalDateString(endD);
  const endHour = endD.getHours();

  return {
    date: startDate,
    startTime: `${String(startHour).padStart(2, '0')}:00`,
    endTime: `${String(endHour).padStart(2, '0')}:00`,
    endDate,
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
