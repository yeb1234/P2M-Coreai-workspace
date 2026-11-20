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

/**
 * 日期型 Todo：同一天 00:00 到 23:59。
 *
 * 这不是一个「24 小时工作块」，只是截止到某一天。历史上 UI 和番茄规划
 * 都把它当真实时长，才出现「一整天 / 8 个番茄钟」两套口径。
 */
export function isAllDaySchedule(item: Pick<ScheduleItem, 'startAt' | 'dueAt'>): boolean {
  if (!item.startAt || !item.dueAt) return false;
  const start = new Date(item.startAt);
  const due = new Date(item.dueAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(due.getTime())) return false;
  return (
    datePart(item.startAt) === datePart(item.dueAt)
    && start.getHours() === 0
    && start.getMinutes() === 0
    && due.getHours() === 23
    && due.getMinutes() === 59
  );
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
