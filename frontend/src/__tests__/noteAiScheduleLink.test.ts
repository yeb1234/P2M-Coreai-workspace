import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createScheduleItem, refreshScheduleFromServer } = vi.hoisted(() => ({
  createScheduleItem: vi.fn(),
  refreshScheduleFromServer: vi.fn(),
}));

vi.mock('../lib/scheduleApi', () => ({
  createScheduleItem: (...args: unknown[]) => createScheduleItem(...args),
}));

vi.mock('../lib/scheduleSync', () => ({
  refreshScheduleFromServer: (...args: unknown[]) => refreshScheduleFromServer(...args),
}));

import { createCalendarEventFromAi, createTodoFromAi } from '../lib/noteAiApi';

describe('note AI schedule linkage', () => {
  beforeEach(() => {
    createScheduleItem.mockReset().mockResolvedValue({});
    refreshScheduleFromServer.mockReset().mockResolvedValue(undefined);
  });

  it('writes todo due date into schedule_items and refreshes the shared store', async () => {
    await createTodoFromAi({
      title: '复习 query 改写',
      description: ' 口述一遍 ',
      due_date: '2026-11-21',
      priority: 'high',
    });

    expect(createScheduleItem).toHaveBeenCalledWith({
      type: 'todo',
      title: '复习 query 改写',
      description: '口述一遍',
      priority: 'high',
      status: 'pending',
      startAt: '2026-11-21T00:00:00',
      dueAt: '2026-11-21T23:59:00',
    });
    expect(refreshScheduleFromServer).toHaveBeenCalledTimes(1);
  });

  it('writes a timed event into schedule_items instead of legacy calendar_events', async () => {
    await createCalendarEventFromAi({
      title: '联动验收-日历',
      date: '2026-11-23',
      start_time: '15:00',
      end_time: '16:00',
      description: '聊天/笔记共用',
    });

    expect(createScheduleItem).toHaveBeenCalledWith({
      type: 'event',
      title: '联动验收-日历',
      description: '聊天/笔记共用',
      status: 'pending',
      priority: 'green',
      startAt: '2026-11-23T15:00:00',
      dueAt: '2026-11-23T16:00:00',
    });
    expect(refreshScheduleFromServer).toHaveBeenCalledTimes(1);
  });

  it('defaults a start-only event to one hour and a date-only event to all day', async () => {
    await createCalendarEventFromAi({
      title: '只有开始',
      date: '2026-11-24',
      start_time: '09:30',
    });
    expect(createScheduleItem).toHaveBeenLastCalledWith(expect.objectContaining({
      startAt: '2026-11-24T09:30:00',
      dueAt: '2026-11-24T10:30:00',
    }));

    await createCalendarEventFromAi({
      title: '全天',
      date: '2026-11-25',
    });
    expect(createScheduleItem).toHaveBeenLastCalledWith(expect.objectContaining({
      startAt: '2026-11-25T00:00:00',
      dueAt: '2026-11-25T23:59:00',
    }));
  });
});
