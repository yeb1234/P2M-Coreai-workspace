import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCrossModuleSync } from '../hooks/useCrossModuleSync';
import { useNotificationStore } from '../stores/notificationStore';
import { usePomodoroStore } from '../stores/pomodoroStore';
import { useScheduleStore } from '../stores/scheduleStore';
import { createPomodoroInitialTimer } from '../stores/pomodoroStore';
import { DEFAULT_CONFIG, type ScheduleItem } from '../types';

vi.mock('../lib/sounds', () => ({
  playBreakSound: vi.fn(),
  playPomodoroCue: vi.fn(),
  playNotificationSound: vi.fn(),
}));

function makeTodo(patch: Partial<ScheduleItem>): ScheduleItem {
  return {
    id: patch.id || 'todo-1',
    type: 'todo',
    title: patch.title || '写报告',
    description: '',
    status: 'pending',
    priority: 'green',
    startAt: null,
    dueAt: null,
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

describe('todo reminder push', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-12T01:00:30.000Z'));
    useNotificationStore.setState({ notifications: [] });
    usePomodoroStore.setState({
      config: DEFAULT_CONFIG,
      timer: createPomodoroInitialTimer(DEFAULT_CONFIG),
      sessions: {},
      _lastTickTimestamp: null,
      _remoteRuntimeUpdatedAt: null,
      _configUpdatedAt: null,
      _historyUpdatedAt: null,
    });
    vi.spyOn(usePomodoroStore.getState(), 'restoreTimer').mockImplementation(() => undefined);
    vi.spyOn(usePomodoroStore.getState(), 'restoreRemoteState').mockResolvedValue(undefined);
    vi.spyOn(usePomodoroStore.getState(), 'syncRemoteRuntime').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('pushes one notification for a reminder that just became due', () => {
    const todo = makeTodo({ reminderAt: '2026-05-12T01:00:00.000Z' });
    useScheduleStore.setState({ items: { [todo.id]: todo }, itemOrder: [todo.id] });

    const hook = renderHook(() => useCrossModuleSync(true));

    expect(useNotificationStore.getState().notifications).toHaveLength(1);

    act(() => {
      useScheduleStore.setState({ items: { [todo.id]: { ...todo, updatedAt: '2026-05-12T01:00:31.000Z' } } });
      vi.advanceTimersByTime(500);
    });

    expect(useNotificationStore.getState().notifications).toHaveLength(1);
    hook.unmount();
  });

  it('does not batch push old overdue reminders on startup', () => {
    const oldTodo = makeTodo({ id: 'old', reminderAt: '2026-05-12T00:30:00.000Z' });
    const currentTodo = makeTodo({ id: 'current', reminderAt: '2026-05-12T01:00:00.000Z' });
    useScheduleStore.setState({
      items: { [oldTodo.id]: oldTodo, [currentTodo.id]: currentTodo },
      itemOrder: [oldTodo.id, currentTodo.id],
    });

    const hook = renderHook(() => useCrossModuleSync(true));

    expect(useNotificationStore.getState().notifications).toHaveLength(1);
    expect(useNotificationStore.getState().notifications[0]).toEqual(expect.objectContaining({
      message: '写报告',
      sourceKey: 'todo-reminder:current:2026-05-12T01:00:00.000Z',
    }));
    hook.unmount();
  });
});
