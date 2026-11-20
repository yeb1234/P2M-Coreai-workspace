import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCrossModuleSync } from '../hooks/useCrossModuleSync';
import { useNotificationStore } from '../stores/notificationStore';
import { usePomodoroStore, createPomodoroInitialTimer } from '../stores/pomodoroStore';
import { useScheduleStore } from '../stores/scheduleStore';
import { DEFAULT_CONFIG, type PomodoroSession, type ScheduleItem } from '../types';

vi.mock('../lib/sounds', () => ({
  playBreakSound: vi.fn(),
  playPomodoroCue: vi.fn(),
  playNotificationSound: vi.fn(),
}));

vi.mock('../lib/scheduleApi', () => ({
  fetchScheduleItems: vi.fn(async () => []),
  createScheduleItem: vi.fn(async () => undefined),
  patchScheduleItem: vi.fn(async () => undefined),
  deleteScheduleItem: vi.fn(async () => undefined),
  restoreScheduleItem: vi.fn(async () => undefined),
  clearScheduleItems: vi.fn(async () => undefined),
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

function makeCompletedSession(): PomodoroSession {
  return {
    id: 'session-1',
    todoId: 'todo-1',
    phase: 'work',
    plannedDuration: 25,
    actualDuration: 25,
    completed: true,
    startTime: '2026-05-12T09:00:00+08:00',
    endTime: '2026-05-12T09:25:00+08:00',
    calendarEventId: null,
  };
}

describe('pomodoro -> schedule cross module sync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-12T01:25:00.000Z'));
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
    useScheduleStore.setState({
      items: { 'todo-1': makeTodo({ id: 'todo-1', status: 'pending', pomodoroCount: 1, pomodoroRounds: 1 }) },
      itemOrder: ['todo-1'],
      loading: false,
      error: null,
    });
    vi.spyOn(usePomodoroStore.getState(), 'restoreTimer').mockImplementation(() => undefined);
    vi.spyOn(usePomodoroStore.getState(), 'restoreRemoteState').mockResolvedValue(undefined);
    vi.spyOn(usePomodoroStore.getState(), 'syncRemoteRuntime').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('记录专注事件时不重复累加待办番茄数，并把事件写进 schedule store', async () => {
    const hook = renderHook(() => useCrossModuleSync(true));

    await act(async () => {
      usePomodoroStore.setState({ sessions: { 'session-1': makeCompletedSession() } });
      vi.advanceTimersByTime(0);
      await Promise.resolve();
    });

    const todo = useScheduleStore.getState().items['todo-1'];
    expect(todo.pomodoroCount).toBe(1);
    expect(todo.totalFocusMinutes).toBe(0);
    expect(todo.status).toBe('completed');

    const events = Object.values(useScheduleStore.getState().items).filter((item) => item.type === 'event');
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(expect.objectContaining({
      title: '专注 25分钟',
      startAt: '2026-05-12T09:00:00+08:00',
      dueAt: '2026-05-12T09:25:00+08:00',
      priority: 'green',
    }));

    expect(usePomodoroStore.getState().sessions['session-1'].calendarEventId).toBe(events[0].id);
    hook.unmount();
  });
});
