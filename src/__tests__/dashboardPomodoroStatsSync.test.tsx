import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PomodoroSummary } from '../components/dashboard/summaries/PomodoroSummary';
import { QuickStatsSummary } from '../components/dashboard/summaries/QuickStatsSummary';
import { useScheduleStore } from '../stores/scheduleStore';
import { useNotesStore } from '../stores/notesStore';
import { useCalendarStore } from '../stores/calendarStore';
import { usePomodoroStore, createPomodoroInitialTimer } from '../stores/pomodoroStore';
import { selectPomodoroProjection } from '../lib/projections/pomodoro';
import { selectQuickStatsProjection } from '../lib/projections/quickStats';
import { toLocalDateString } from '../lib/date';
import { DEFAULT_CONFIG, type PomodoroSession, type ScheduleItem } from '../types';

vi.mock('../lib/scheduleApi', () => ({
  fetchScheduleItems: vi.fn(async () => []),
  createScheduleItem: vi.fn(async () => undefined),
  patchScheduleItem: vi.fn(async () => undefined),
  deleteScheduleItem: vi.fn(async () => undefined),
  restoreScheduleItem: vi.fn(async () => undefined),
  clearScheduleItems: vi.fn(async () => undefined),
}));

vi.mock('../lib/authApi', () => ({
  hasAuthToken: vi.fn(() => true),
  getUserData: vi.fn(async () => null),
  setUserData: vi.fn(async () => undefined),
}));

function makeTodo(overrides: Partial<ScheduleItem> & { id: string }): ScheduleItem {
  const { id, ...rest } = overrides;
  return {
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
    id,
  } as ScheduleItem;
}

function makeSession(overrides: Partial<PomodoroSession> & { id: string }): PomodoroSession {
  return {
    todoId: null,
    phase: 'work',
    plannedDuration: 25,
    actualDuration: 25,
    completed: true,
    startTime: '2026-11-16T09:00:00+08:00',
    endTime: '2026-11-16T09:25:00+08:00',
    calendarEventId: null,
    ...overrides,
  };
}

describe('工作台番茄 / 概览卡片 = 插件页同一份投影', () => {
  beforeEach(() => {
    useScheduleStore.setState({ items: {}, itemOrder: [], loading: false, error: null });
    useNotesStore.setState({ notes: [], trash: {} });
    useCalendarStore.setState({ events: {} });
    usePomodoroStore.setState({
      config: DEFAULT_CONFIG,
      timer: createPomodoroInitialTimer(DEFAULT_CONFIG),
      sessions: {},
      _lastTickTimestamp: null,
      _remoteRuntimeUpdatedAt: null,
      _configUpdatedAt: null,
      _historyUpdatedAt: null,
    });
  });

  it('番茄投影：今日番茄 / 专注时长吃 getTodayStats 结果，今日待办复用待办投影', () => {
    const today = '2026-11-16';
    const sessions: Record<string, PomodoroSession> = {
      s1: makeSession({ id: 's1' }),
      s2: makeSession({ id: 's2', startTime: '2026-11-15T09:00:00+08:00', endTime: '2026-11-15T09:25:00+08:00' }),
      s3: makeSession({ id: 's3', completed: false }),
      s4: makeSession({ id: 's4', phase: 'short_break' }),
    };
    const items: Record<string, ScheduleItem> = {
      a: makeTodo({ id: 'a', status: 'completed', startAt: '2026-11-16T09:00:00+08:00', dueAt: '2026-11-16T10:00:00+08:00' }),
      b: makeTodo({ id: 'b', status: 'in_progress', startAt: '2026-11-16T11:00:00+08:00', dueAt: '2026-11-16T12:00:00+08:00' }),
      c: makeTodo({ id: 'c', status: 'completed', startAt: '2026-11-15T09:00:00+08:00', dueAt: '2026-11-15T10:00:00+08:00' }),
      d: makeTodo({ id: 'd', deletedAt: '2026-11-16T02:00:00+08:00', startAt: '2026-11-16T09:00:00+08:00', dueAt: '2026-11-16T10:00:00+08:00' }),
    };

    // todayStats 即 store.getTodayStats() 的返回形状；卡片里直接吃这个结果
    const projection = selectPomodoroProjection({
      todayStats: { totalPomodoros: 1, totalMinutes: 25 },
      sessions,
      items,
      config: DEFAULT_CONFIG,
      timer: createPomodoroInitialTimer(DEFAULT_CONFIG),
      today,
    });

    expect(projection.totalPomodoros).toBe(1);
    expect(projection.totalMinutes).toBe(25);
    expect(projection.todayDone).toBe(1);
    expect(projection.todayTotal).toBe(2);
    expect(projection.todayInProgress).toBe(1);
  });

  it('概览投影：今日完成 / 番茄 / 笔记 / 今日事件四项口径写死', () => {
    const today = '2026-11-16';
    const items: Record<string, ScheduleItem> = {
      a: makeTodo({ id: 'a', status: 'completed', startAt: '2026-11-16T09:00:00+08:00', dueAt: '2026-11-16T10:00:00+08:00' }),
      b: makeTodo({ id: 'b', startAt: '2026-11-16T11:00:00+08:00', dueAt: '2026-11-16T12:00:00+08:00' }),
      e: { ...makeTodo({ id: 'e', startAt: '2026-11-16T13:00:00+08:00', dueAt: '2026-11-16T14:00:00+08:00' }), type: 'event' as const },
      c: makeTodo({ id: 'c', status: 'completed', startAt: '2026-11-15T09:00:00+08:00', dueAt: '2026-11-15T10:00:00+08:00' }),
    };

    const projection = selectQuickStatsProjection({
      items,
      todayStats: { totalPomodoros: 3, totalMinutes: 75 },
      notes: [{ id: 'n1' }, { id: 'n2' }],
      calendarEvents: {},
      today,
    });

    expect(projection.todayDone).toBe(1);
    expect(projection.todayTotal).toBe(2);
    expect(projection.pomodoros).toBe(3);
    expect(projection.notesCount).toBe(2);
    // 今日事件：startAt 落在今天的 schedule items，含 event 类型（a、b、e）
    expect(projection.eventsCount).toBe(3);
  });

  it('番茄卡片订阅 store：补一条今天完成的 work session，番茄数 0 → 1，无需重挂载', () => {
    render(<PomodoroSummary />);

    const tomatoBox = screen.getByText('番茄数').parentElement!;
    expect(tomatoBox.querySelector('p')?.textContent).toBe('0');

    const today = toLocalDateString(new Date());
    act(() => {
      usePomodoroStore.setState({
        sessions: {
          s1: makeSession({
            id: 's1',
            startTime: `${today}T09:00:00+08:00`,
            endTime: `${today}T09:25:00+08:00`,
          }),
        },
      });
    });

    expect(tomatoBox.querySelector('p')?.textContent).toBe('1');
  });

  it('概览卡片订阅 store：补一条今天到期且已完成的待办，今日完成 0/0 → 1/1', () => {
    render(<QuickStatsSummary />);

    const doneBox = screen.getByText('今日完成').parentElement!;
    expect(doneBox.querySelector('p')?.textContent).toBe('0/0');

    const today = toLocalDateString(new Date());
    act(() => {
      useScheduleStore.setState({
        items: {
          t1: makeTodo({
            id: 't1',
            status: 'completed',
            startAt: `${today}T09:00:00+08:00`,
            dueAt: `${today}T10:00:00+08:00`,
          }),
        },
      });
    });

    expect(doneBox.querySelector('p')?.textContent).toBe('1/1');
  });
});
