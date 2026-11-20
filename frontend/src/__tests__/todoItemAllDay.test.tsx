import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ScheduleItem } from '../types';
import { TodoItem } from '../components/todo/TodoItem';

vi.mock('../lib/sounds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/sounds')>();
  return {
    ...actual,
    playInteractionSound: vi.fn(),
    playNotificationSound: vi.fn(),
  };
});

function makeTodo(overrides: Partial<ScheduleItem>): ScheduleItem {
  return {
    id: 'todo-1',
    type: 'todo',
    title: '测试待办',
    description: '',
    status: 'pending',
    priority: 'green',
    startAt: '2026-11-21T00:00:00',
    dueAt: '2026-11-21T23:59:00',
    reminderAt: null,
    pomodoroCount: 0,
    pomodoroRounds: 0,
    totalFocusMinutes: 0,
    completedAt: null,
    deletedAt: null,
    sortOrder: 0,
    createdAt: '2026-11-20T12:00:00',
    updatedAt: '2026-11-20T12:00:00',
    ...overrides,
  };
}

describe('TodoItem date-only display', () => {
  it('shows 全天 and does not infer 8 pomodoros from a full-day range', () => {
    render(<TodoItem todo={makeTodo({})} onEdit={() => undefined} />);

    expect(screen.getByText('全天')).toBeTruthy();
    expect(screen.queryByText('00:00 - 23:59')).toBeNull();
    expect(screen.queryByText('预计8个番茄钟')).toBeNull();
    expect(screen.getByText('预计1个番茄钟')).toBeTruthy();
  });

  it('keeps an explicit AI estimate visible on a date-only todo', () => {
    render(<TodoItem todo={makeTodo({ pomodoroRounds: 2 })} onEdit={() => undefined} />);

    expect(screen.getByText('全天')).toBeTruthy();
    expect(screen.getByText('预计2个番茄钟')).toBeTruthy();
  });
});
