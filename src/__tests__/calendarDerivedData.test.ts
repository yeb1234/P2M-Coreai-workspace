import { describe, expect, it } from 'vitest';
import {
  getItemsForCalendarMonth,
  getScheduleItemsForDate,
  groupScheduleItemsByDate,
} from '../components/calendar/calendarDerivedData';
import type { ScheduleItem } from '../types';

function makeItem(patch: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id: patch.id || 'item-1',
    type: patch.type || 'todo',
    title: patch.title || '待办',
    description: '',
    status: patch.status || 'pending',
    priority: patch.priority || 'green',
    startAt: patch.startAt === undefined ? '2026-05-12T01:00:00.000Z' : patch.startAt,
    dueAt: patch.dueAt === undefined ? '2026-05-12T02:00:00.000Z' : patch.dueAt,
    reminderAt: null,
    pomodoroCount: 0,
    pomodoroRounds: 1,
    totalFocusMinutes: 0,
    completedAt: null,
    deletedAt: null,
    sortOrder: 0,
    createdAt: '2026-05-12T00:00:00.000Z',
    updatedAt: '2026-05-12T00:00:00.000Z',
    ...patch,
  };
}

describe('calendar derived data', () => {
  it('does not include unscheduled todos in calendar views', () => {
    const scheduled = makeItem({ id: 'scheduled' });
    const unscheduled = makeItem({ id: 'unscheduled', startAt: null, dueAt: null });
    const items = { [scheduled.id]: scheduled, [unscheduled.id]: unscheduled };

    expect(getItemsForCalendarMonth(items, 2026, 4)).toEqual([scheduled]);
    expect(getScheduleItemsForDate(items, '2026-05-12')).toEqual([scheduled]);

    const grouped = groupScheduleItemsByDate([scheduled, unscheduled]);
    expect(grouped.pendingByDate['2026-05-12']).toEqual([scheduled]);
    expect(Object.values(grouped.pendingByDate).flat()).not.toContain(unscheduled);
  });
});
