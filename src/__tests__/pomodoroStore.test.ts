import { describe, expect, it } from 'vitest';
import {
  completedPomodoroSessionsOnly,
  createPomodoroInitialTimer,
  migratePomodoroPersistedState,
  restorePomodoroRuntimeState,
  sanitizePomodoroPersistedState,
  usePomodoroStore,
} from '../stores/pomodoroStore';
import { DEFAULT_CONFIG, type PomodoroSession } from '../types';

const completedSession: PomodoroSession = {
  id: 'done',
  todoId: null,
  phase: 'work',
  plannedDuration: 25,
  actualDuration: 25,
  completed: true,
  startTime: '2026-05-11T09:00:00',
  endTime: '2026-05-11T09:25:00',
  calendarEventId: null,
};

const activeSession: PomodoroSession = {
  id: 'active',
  todoId: 'todo-1',
  phase: 'work',
  plannedDuration: 25,
  actualDuration: 0,
  completed: false,
  startTime: '2026-05-11T10:00:00',
  endTime: null,
  calendarEventId: null,
};

describe('pomodoro persistence boundaries', () => {
  it('keeps completed session history and drops active sessions', () => {
    const sessions = completedPomodoroSessionsOnly({
      [completedSession.id]: completedSession,
      [activeSession.id]: activeSession,
    });

    expect(Object.keys(sessions)).toEqual(['done']);
  });

  it('resets timer runtime state when hydrating persisted data', () => {
    const sanitized = sanitizePomodoroPersistedState({
      config: { ...DEFAULT_CONFIG, workDuration: 45 },
      sessions: {
        [completedSession.id]: completedSession,
        [activeSession.id]: activeSession,
      },
      timer: {
        status: 'running',
        phase: 'work',
        timeRemaining: 123,
        sessionsCompleted: 3,
        currentSessionId: activeSession.id,
        linkedTodoId: 'todo-1',
      },
      _lastTickTimestamp: Date.now(),
    });

    expect(sanitized.config.workDuration).toBe(45);
    expect(sanitized.sessions.done).toEqual(completedSession);
    expect(sanitized.sessions.active).toEqual(activeSession);
    expect(sanitized.timer.status).toBe('running');
    expect(sanitized.timer.linkedTodoId).toBe('todo-1');
    expect(sanitized._lastTickTimestamp).not.toBeNull();
  });

  it('keeps permanent config values while restoring runtime state', () => {
    const sanitized = sanitizePomodoroPersistedState({
      config: {
        ...DEFAULT_CONFIG,
        workDuration: 45,
        shortBreakDuration: 8,
        longBreakDuration: 20,
        ambientPlaybackMode: 'focus',
      },
      timer: {
        status: 'idle',
        phase: 'work',
        timeRemaining: 1,
        sessionsCompleted: 2,
        currentSessionId: null,
        linkedTodoId: 'todo-1',
      },
      _lastTickTimestamp: Date.now(),
    });

    expect(sanitized.config.workDuration).toBe(45);
    expect(sanitized.config.shortBreakDuration).toBe(8);
    expect(sanitized.config.longBreakDuration).toBe(20);
    expect(sanitized.config.ambientPlaybackMode).toBe('focus');
    expect(sanitized.timer).toEqual(createPomodoroInitialTimer(sanitized.config));
    expect(sanitized._lastTickTimestamp).toBeNull();
  });

  it('keeps completed history as permanent storage across hydration', () => {
    const sanitized = sanitizePomodoroPersistedState({
      config: DEFAULT_CONFIG,
      sessions: {
        [completedSession.id]: completedSession,
      },
      timer: createPomodoroInitialTimer(DEFAULT_CONFIG),
      _lastTickTimestamp: null,
    });

    expect(sanitized.sessions).toEqual({ [completedSession.id]: completedSession });
  });

  it('restores paused timer state without advancing elapsed time', () => {
    const restored = restorePomodoroRuntimeState(
      DEFAULT_CONFIG,
      {
        status: 'paused',
        phase: 'work',
        timeRemaining: 900,
        sessionsCompleted: 2,
        currentSessionId: 'active',
        linkedTodoId: 'todo-1',
      },
      Date.now() - 60_000,
    );

    expect(restored.timer.status).toBe('paused');
    expect(restored.timer.timeRemaining).toBe(900);
    expect(restored.timer.sessionsCompleted).toBe(2);
    expect(restored.lastTickTimestamp).toBeNull();
  });

  it('deducts elapsed time when restoring a running timer', () => {
    const now = Date.now();
    const restored = restorePomodoroRuntimeState(
      DEFAULT_CONFIG,
      {
        status: 'running',
        phase: 'work',
        timeRemaining: 900,
        sessionsCompleted: 1,
        currentSessionId: 'active',
        linkedTodoId: null,
      },
      now - 120_000,
    );

    expect(restored.timer.status).toBe('running');
    expect(restored.timer.timeRemaining).toBeGreaterThanOrEqual(779);
    expect(restored.timer.timeRemaining).toBeLessThanOrEqual(780);
    expect(restored.lastTickTimestamp).not.toBeNull();
  });

  it('keeps expired running timer visible instead of silently resetting it', () => {
    const restored = restorePomodoroRuntimeState(
      DEFAULT_CONFIG,
      {
        status: 'running',
        phase: 'work',
        timeRemaining: 20,
        sessionsCompleted: 0,
        currentSessionId: 'active',
        linkedTodoId: null,
      },
      Date.now() - 60_000,
    );

    expect(restored.timer.status).toBe('paused');
    expect(restored.timer.timeRemaining).toBe(0);
    expect(restored.lastTickTimestamp).toBeNull();
  });

  it('uses initial work duration for idle persisted timers', () => {
    const restored = restorePomodoroRuntimeState(DEFAULT_CONFIG, undefined, null);

    expect(restored.timer).toEqual(createPomodoroInitialTimer(DEFAULT_CONFIG));
    expect(restored.lastTickTimestamp).toBeNull();
  });

  it('keeps reset timers reset after refresh hydration', () => {
    const sanitized = sanitizePomodoroPersistedState({
      config: DEFAULT_CONFIG,
      sessions: {
        [activeSession.id]: activeSession,
      },
      timer: {
        status: 'idle',
        phase: 'work',
        timeRemaining: DEFAULT_CONFIG.workDuration * 60,
        sessionsCompleted: 0,
        currentSessionId: null,
        linkedTodoId: activeSession.todoId,
      },
      _lastTickTimestamp: null,
    });

    expect(sanitized.timer).toEqual(createPomodoroInitialTimer(DEFAULT_CONFIG));
    expect(sanitized.sessions.active).toBeUndefined();
    expect(sanitized._lastTickTimestamp).toBeNull();
  });

  it('keeps skipped fallback timers idle after refresh hydration', () => {
    const sanitized = sanitizePomodoroPersistedState({
      config: DEFAULT_CONFIG,
      timer: {
        status: 'idle',
        phase: 'work',
        timeRemaining: DEFAULT_CONFIG.workDuration * 60,
        sessionsCompleted: 0,
        currentSessionId: null,
        linkedTodoId: null,
      },
      _lastTickTimestamp: Date.now(),
    });

    expect(sanitized.timer).toEqual(createPomodoroInitialTimer(DEFAULT_CONFIG));
    expect(sanitized._lastTickTimestamp).toBeNull();
  });

  it('migrates legacy minute-based remaining time before runtime restore', () => {
    const migrated = migratePomodoroPersistedState({
      config: { ...DEFAULT_CONFIG, workDuration: 25 },
      timer: {
        status: 'paused',
        phase: 'work',
        timeRemaining: 25,
        sessionsCompleted: 0,
        currentSessionId: activeSession.id,
        linkedTodoId: null,
      },
      sessions: {
        [activeSession.id]: activeSession,
      },
      _lastTickTimestamp: Date.now(),
    }, 1);

    expect(migrated.timer.status).toBe('paused');
    expect(migrated.timer.timeRemaining).toBe(1500);
    expect(migrated.sessions.active).toEqual(activeSession);
    expect(migrated._lastTickTimestamp).toBeNull();
  });

  it('does not treat active runtime sessions as permanent history once timer is reset', () => {
    const sanitized = sanitizePomodoroPersistedState({
      config: DEFAULT_CONFIG,
      sessions: {
        [completedSession.id]: completedSession,
        [activeSession.id]: activeSession,
      },
      timer: {
        status: 'idle',
        phase: 'work',
        timeRemaining: DEFAULT_CONFIG.workDuration * 60,
        sessionsCompleted: 0,
        currentSessionId: null,
        linkedTodoId: null,
      },
      _lastTickTimestamp: null,
    });

    expect(sanitized.sessions).toEqual({ [completedSession.id]: completedSession });
  });

  it('does not reset current timer when saving non-duration config fields', () => {
    usePomodoroStore.setState({
      config: { ...DEFAULT_CONFIG, ambientPlaybackMode: 'focus' },
      timer: {
        status: 'running',
        phase: 'work',
        timeRemaining: 777,
        sessionsCompleted: 1,
        currentSessionId: 'active',
        linkedTodoId: null,
      },
      sessions: {},
      _lastTickTimestamp: 123,
    });

    usePomodoroStore.getState().updateConfig({
      ...DEFAULT_CONFIG,
      ambientPlaybackMode: 'manual',
    });

    expect(usePomodoroStore.getState().timer.timeRemaining).toBe(777);
    expect(usePomodoroStore.getState().timer.status).toBe('running');
    expect(usePomodoroStore.getState().config.ambientPlaybackMode).toBe('manual');
  });
});
