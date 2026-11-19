import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarSummary } from '../components/dashboard/summaries/CalendarSummary';
import { TodoSummary } from '../components/dashboard/summaries/TodoSummary';
import { useScheduleStore } from '../stores/scheduleStore';
import { useUIStore } from '../stores/uiStore';
import { selectCalendarProjection } from '../lib/projections/calendar';
import { selectTodoProjection, sortTodosByPriority, splitTodoItems } from '../lib/projections/todo';
import type { ScheduleItem } from '../types';

vi.mock('../lib/scheduleApi', () => ({
  fetchScheduleItems: vi.fn(async () => []),
  createScheduleItem: vi.fn(async () => undefined),
  patchScheduleItem: vi.fn(async () => undefined),
  deleteScheduleItem: vi.fn(async () => undefined),
  restoreScheduleItem: vi.fn(async () => undefined),
  clearScheduleItems: vi.fn(async () => undefined),
}));

const TODAY = '2026-11-16';

function makeItem(overrides: Partial<ScheduleItem> & { id: string }): ScheduleItem {
  const { id, ...rest } = overrides;
  return {
    id,
    type: 'todo',
    title: '待办',
    description: '',
    status: 'pending',
    priority: 'green',
    startAt: null,
    dueAt: null,
    reminderAt: null,
    pomodoroCount: 0,
    pomodoroRounds: 0,
    totalFocusMinutes: 0,
    completedAt: null,
    deletedAt: null,
    sortOrder: 0,
    createdAt: '2026-11-16T01:00:00.000Z',
    updatedAt: '2026-11-16T01:00:00.000Z',
    ...rest,
  } as ScheduleItem;
}

describe('日历/待办 工作台摘要与插件页同源', () => {
  beforeEach(() => {
    useScheduleStore.setState({ items: {}, itemOrder: [], loading: false, error: null });
    useUIStore.setState({ activeView: 'dashboard' });
  });

  it('日历投影：今天/昨天/已删除/未排期/混合日程，计数与开始时间顺序正确', () => {
    const items = {
      early: makeItem({ id: 'early', title: '早会', startAt: '2026-11-16T08:00:00+08:00', dueAt: '2026-11-16T08:30:00+08:00' }),
      morning: makeItem({ id: 'morning', title: '上午站会', startAt: '2026-11-16T09:00:00+08:00', dueAt: '2026-11-16T09:30:00+08:00' }),
      review: makeItem({ id: 'review', type: 'event', title: '下午评审', startAt: '2026-11-16T14:00:00+08:00', dueAt: '2026-11-16T15:00:00+08:00' }),
      yesterday: makeItem({ id: 'yesterday', title: '昨天的会', startAt: '2026-11-15T10:00:00+08:00', dueAt: '2026-11-15T11:00:00+08:00' }),
      trashed: makeItem({ id: 'trashed', title: '已删除', startAt: '2026-11-16T10:00:00+08:00', dueAt: '2026-11-16T10:30:00+08:00', deletedAt: '2026-11-16T02:00:00+08:00' }),
      unscheduled: makeItem({ id: 'unscheduled', title: '未排期' }),
    };

    const projection = selectCalendarProjection(items, TODAY);

    expect(projection.total).toBe(3);
    expect(projection.items.map((item) => item.id)).toEqual(['early', 'morning', 'review']);
    expect(projection.display.map((item) => item.id)).toEqual(['early', 'morning']);
    expect(projection.overflow).toBe(1);
  });

  it('日历卡片订阅 store：挂载后新增今天日程立即出现，无需重挂载', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-16T10:00:00+08:00'));
    try {
      render(<CalendarSummary />);
      expect(screen.queryByText('产品评审会')).toBeNull();

      act(() => {
        useScheduleStore.setState((state) => ({
          items: {
            ...state.items,
            review: makeItem({
              id: 'review',
              type: 'event',
              title: '产品评审会',
              startAt: '2026-11-16T15:00:00+08:00',
              dueAt: '2026-11-16T16:00:00+08:00',
            }),
          },
        }));
      });

      expect(screen.getByText('产品评审会')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('待办：页面排序函数与卡片优先级队列首条一致', () => {
    const items = {
      low: makeItem({ id: 'low', title: '低优先待办', priority: 'low', createdAt: '2026-11-16T01:00:00.000Z' }),
      high: makeItem({ id: 'high', title: '高优先待办', priority: 'high', createdAt: '2026-11-16T02:00:00.000Z' }),
      done: makeItem({ id: 'done', title: '已完成待办', status: 'completed', priority: 'high' }),
    };

    const pageOrder = sortTodosByPriority(splitTodoItems(items));
    const projection = selectTodoProjection(items);

    expect(pageOrder[0].id).toBe(projection.priorityQueue[0].id);
    expect(projection.priorityQueue.map((todo) => todo.id)).toEqual(['high', 'low']);

    useScheduleStore.setState({ items });
    render(<TodoSummary />);
    expect(screen.getByText(projection.priorityQueue[0].title)).toBeTruthy();
    expect(screen.queryByText('已完成待办')).toBeNull();
  });
});
