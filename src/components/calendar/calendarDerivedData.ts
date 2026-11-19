import type { ScheduleCalendarEvent, ScheduleItem } from '../../types';
import { datePart, hasScheduleTime, scheduleItemToCalendarEvent } from '../../lib/scheduleTime';

export function getItemsForCalendarMonth(
  items: Record<string, ScheduleItem>,
  year: number,
  month: number,
): ScheduleItem[] {
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  return Object.values(items).filter((item) => !item.deletedAt && hasScheduleTime(item) && datePart(item.startAt).startsWith(monthPrefix));
}

export function getItemsForCalendarDates(
  items: Record<string, ScheduleItem>,
  dates: string[],
): ScheduleItem[] {
  const dateSet = new Set(dates);
  return Object.values(items).filter((item) => !item.deletedAt && hasScheduleTime(item) && dateSet.has(datePart(item.startAt)));
}

export function groupScheduleItemsByDate(items: ScheduleItem[]) {
  const eventsByDate: Record<string, ScheduleCalendarEvent[]> = {};
  const pendingByDate: Record<string, ScheduleItem[]> = {};
  const completedByDate: Record<string, ScheduleItem[]> = {};

  items.forEach((item) => {
    if (!hasScheduleTime(item)) return;
    const date = datePart(item.startAt);
    if (item.type === 'event') {
      if (!eventsByDate[date]) eventsByDate[date] = [];
      eventsByDate[date].push(scheduleItemToCalendarEvent(item));
      return;
    }

    const target = item.status === 'completed' ? completedByDate : pendingByDate;
    if (!target[date]) target[date] = [];
    target[date].push(item);
  });

  Object.values(eventsByDate).forEach((events) => events.sort((a, b) => String(a.startTime).localeCompare(String(b.startTime))));
  Object.values(pendingByDate).forEach((todos) => todos.sort((a, b) => new Date(a.startAt ?? 0).getTime() - new Date(b.startAt ?? 0).getTime()));
  Object.values(completedByDate).forEach((todos) => todos.sort((a, b) => new Date(b.completedAt ?? b.updatedAt).getTime() - new Date(a.completedAt ?? a.updatedAt).getTime()));

  return { eventsByDate, pendingByDate, completedByDate };
}

export function getScheduleItemsForDate(items: Record<string, ScheduleItem>, date: string): ScheduleItem[] {
  return Object.values(items).filter((item) => !item.deletedAt && hasScheduleTime(item) && datePart(item.startAt) === date);
}
