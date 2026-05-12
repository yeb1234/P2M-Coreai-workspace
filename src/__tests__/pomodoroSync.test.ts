import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildPomodoroRemoteConfigSnapshot,
  buildPomodoroRemoteHistorySnapshot,
  buildPomodoroRemoteRuntimeSnapshot,
  isRemotePomodoroConfigNewer,
  isRemotePomodoroRuntimeNewer,
  mergePomodoroSessionHistories,
} from '../lib/pomodoroSync';
import { DEFAULT_CONFIG, type PomodoroSession, type PomodoroTimerState } from '../types';

const completedSession: PomodoroSession = {
  id: 'done-1',
  todoId: null,
  phase: 'work',
  plannedDuration: 25,
  actualDuration: 25,
  completed: true,
  startTime: '2026-05-12T08:00:00.000Z',
  endTime: '2026-05-12T08:25:00.000Z',
  calendarEventId: null,
};

const activeSession: PomodoroSession = {
  id: 'active-1',
  todoId: 'todo-1',
  phase: 'work',
  plannedDuration: 25,
  actualDuration: 0,
  completed: false,
  startTime: '2026-05-12T09:00:00.000Z',
  endTime: null,
  calendarEventId: null,
};

describe('pomodoro remote runtime sync', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds a button-action snapshot without requiring per-second writes', () => {
    vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-05-11T10:00:00.000Z');
    const timer: PomodoroTimerState = {
      status: 'running',
      phase: 'work',
      timeRemaining: 1200,
      sessionsCompleted: 1,
      currentSessionId: activeSession.id,
      linkedTodoId: null,
    };

    const snapshot = buildPomodoroRemoteRuntimeSnapshot(timer, {
      [activeSession.id]: activeSession,
    }, 1000, 'start');

    expect(snapshot.kind).toBe('pomodoro-runtime-v2');
    expect(snapshot.action).toBe('start');
    expect(snapshot.timer).toEqual(timer);
    expect(snapshot.activeSession).toEqual(activeSession);
    expect(snapshot.lastTickTimestamp).toBe(1000);
    expect(snapshot.updatedAt).toBe('2026-05-11T10:00:00.000Z');
  });

  it('uses updatedAt to decide whether remote runtime should replace local state', () => {
    const remote = buildPomodoroRemoteRuntimeSnapshot({
      status: 'paused',
      phase: 'work',
      timeRemaining: 600,
      sessionsCompleted: 0,
      currentSessionId: null,
      linkedTodoId: null,
    }, {}, null, 'pause');
    remote.updatedAt = new Date(2000).toISOString();

    expect(isRemotePomodoroRuntimeNewer(remote, 1000)).toBe(true);
    expect(isRemotePomodoroRuntimeNewer(remote, 3000)).toBe(false);
  });

  it('keeps config and history as separate v2 snapshots', () => {
    const config = buildPomodoroRemoteConfigSnapshot({ ...DEFAULT_CONFIG, workDuration: 35 });
    const history = buildPomodoroRemoteHistorySnapshot({
      [completedSession.id]: completedSession,
      [activeSession.id]: activeSession,
    });

    expect(config.kind).toBe('pomodoro-config-v2');
    expect(config.config.workDuration).toBe(35);
    expect(history.kind).toBe('pomodoro-history-v2');
    expect(history.sessions).toEqual({ [completedSession.id]: completedSession });
  });

  it('uses updatedAt to decide whether remote config should replace local config', () => {
    const remote = buildPomodoroRemoteConfigSnapshot(DEFAULT_CONFIG, new Date(5000).toISOString());

    expect(isRemotePomodoroConfigNewer(remote, new Date(4000).toISOString())).toBe(true);
    expect(isRemotePomodoroConfigNewer(remote, new Date(6000).toISOString())).toBe(false);
  });

  it('merges completed histories by session id without dropping local-only records', () => {
    const localSession = { ...completedSession, id: 'local-only' };
    const remoteSession = { ...completedSession, id: 'remote-only' };

    const merged = mergePomodoroSessionHistories(
      { [localSession.id]: localSession, [activeSession.id]: activeSession },
      { [remoteSession.id]: remoteSession },
    );

    expect(Object.keys(merged).sort()).toEqual(['active-1', 'local-only', 'remote-only']);
    expect(merged['remote-only']).toEqual(remoteSession);
  });
});
