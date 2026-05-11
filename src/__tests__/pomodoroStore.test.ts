import { describe, expect, it } from 'vitest';
import {
  completedPomodoroSessionsOnly,
  createPomodoroInitialTimer,
  sanitizePomodoroPersistedState,
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
    expect(sanitized.sessions).toEqual({ done: completedSession });
    expect(sanitized.timer).toEqual(createPomodoroInitialTimer(sanitized.config));
    expect(sanitized._lastTickTimestamp).toBeNull();
  });
});
