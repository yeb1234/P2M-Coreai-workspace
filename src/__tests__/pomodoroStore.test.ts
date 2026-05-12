import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  completedPomodoroSessionsOnly,
  createPomodoroInitialTimer,
  migratePomodoroPersistedState,
  restorePomodoroRuntimeState,
  sanitizePomodoroPersistedState,
  usePomodoroStore,
} from '../stores/pomodoroStore';
import { useScheduleStore } from '../stores/scheduleStore';
import { DEFAULT_CONFIG, type PomodoroSession } from '../types';

vi.mock('../lib/authApi', () => ({
  hasAuthToken: vi.fn(() => true),
  getUserData: vi.fn(async () => null),
  setUserData: vi.fn(async () => undefined),
}));

import { getUserData, setUserData } from '../lib/authApi';

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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getUserData).mockResolvedValue(null);
  usePomodoroStore.setState({
    config: DEFAULT_CONFIG,
    timer: createPomodoroInitialTimer(DEFAULT_CONFIG),
    sessions: {},
    _lastTickTimestamp: null,
    _remoteRuntimeUpdatedAt: null,
    _configUpdatedAt: null,
    _historyUpdatedAt: null,
  });
  useScheduleStore.setState({ items: {}, itemOrder: [] });
});

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
        ambientSound: 'rain',
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
    expect(sanitized.config.ambientSound).toBe('rain');
    expect(sanitized.timer).toEqual(createPomodoroInitialTimer(sanitized.config));
    expect(sanitized._lastTickTimestamp).toBeNull();
  });

  it('falls back to no ambient sound for unknown persisted sound values', () => {
    const sanitized = sanitizePomodoroPersistedState({
      config: {
        ...DEFAULT_CONFIG,
        ambientPlaybackMode: 'focus',
        ambientSound: 'missing-sound' as typeof DEFAULT_CONFIG.ambientSound,
      },
    });

    expect(sanitized.config.ambientSound).toBe('none');
  });

  it('keeps full ambient config while sanitizing invalid persisted values', () => {
    const sanitized = sanitizePomodoroPersistedState({
      config: {
        ...DEFAULT_CONFIG,
        workDuration: 500,
        shortBreakDuration: 0,
        longBreakDuration: 90,
        longBreakInterval: 99,
        dailyGoal: 0,
        ambientPlaybackMode: 'manual',
        ambientSound: 'cafe',
        ambientVolumeBySound: {
          cafe: 31.7,
          rain: -10,
          wind: 200,
          forest: 'bad' as unknown as number,
        },
        ambientWasPlaying: true,
      },
    });

    expect(sanitized.config.workDuration).toBe(120);
    expect(sanitized.config.shortBreakDuration).toBe(1);
    expect(sanitized.config.longBreakDuration).toBe(60);
    expect(sanitized.config.longBreakInterval).toBe(10);
    expect(sanitized.config.dailyGoal).toBe(1);
    expect(sanitized.config.ambientPlaybackMode).toBe('manual');
    expect(sanitized.config.ambientSound).toBe('cafe');
    expect(sanitized.config.ambientVolumeBySound).toMatchObject({ cafe: 32, rain: 0, wind: 100 });
    expect(sanitized.config.ambientVolumeBySound.forest).toBeUndefined();
    expect(sanitized.config.ambientWasPlaying).toBe(true);
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

  it('does not write remote runtime on every local tick', () => {
    usePomodoroStore.setState({
      config: DEFAULT_CONFIG,
      timer: {
        status: 'running',
        phase: 'work',
        timeRemaining: 1200,
        sessionsCompleted: 0,
        currentSessionId: 'active',
        linkedTodoId: null,
      },
      sessions: { active: activeSession },
      _lastTickTimestamp: Date.now() - 1000,
    });

    usePomodoroStore.getState().tick();

    expect(setUserData).not.toHaveBeenCalled();
    expect(usePomodoroStore.getState().timer.timeRemaining).toBeLessThan(1200);
  });

  it('writes remote runtime for key timer actions', () => {
    usePomodoroStore.getState().startTimer('todo-1');

    expect(setUserData).toHaveBeenCalledWith('p2m-pomodoro-runtime-v2', expect.stringContaining('"action":"start"'));

    vi.mocked(setUserData).mockClear();
    usePomodoroStore.getState().pauseTimer();

    expect(setUserData).toHaveBeenCalledWith('p2m-pomodoro-runtime-v2', expect.stringContaining('"action":"pause"'));
  });

  it('writes ambient playback state into remote pomodoro config', () => {
    usePomodoroStore.getState().updateAmbientPlaybackState('rain', true);

    expect(usePomodoroStore.getState().config.ambientSound).toBe('rain');
    expect(usePomodoroStore.getState().config.ambientWasPlaying).toBe(true);
    expect(setUserData).toHaveBeenCalledWith('p2m-pomodoro-config-v2', expect.stringContaining('"ambientWasPlaying":true'));

    vi.mocked(setUserData).mockClear();
    usePomodoroStore.getState().updateAmbientPlaybackState('none', false);

    expect(usePomodoroStore.getState().config.ambientSound).toBe('rain');
    expect(usePomodoroStore.getState().config.ambientWasPlaying).toBe(false);
    expect(setUserData).toHaveBeenCalledWith('p2m-pomodoro-config-v2', expect.stringContaining('"ambientWasPlaying":false'));
  });

  it('writes per-sound ambient volume into remote pomodoro config', () => {
    usePomodoroStore.getState().updateAmbientVolume('cafe', 31.7);

    expect(usePomodoroStore.getState().config.ambientVolumeBySound.cafe).toBe(32);
    expect(setUserData).toHaveBeenCalledWith('p2m-pomodoro-config-v2', expect.stringContaining('"ambientVolumeBySound":{"cafe":32}'));
  });

  it('starts a fresh standalone work timer after skipped phases left the idle timer at zero', () => {
    usePomodoroStore.setState({
      config: DEFAULT_CONFIG,
      timer: {
        status: 'idle',
        phase: 'work',
        timeRemaining: 0,
        sessionsCompleted: 1,
        currentSessionId: null,
        linkedTodoId: null,
      },
      sessions: {},
      _lastTickTimestamp: null,
    });

    usePomodoroStore.getState().startTimer();

    const state = usePomodoroStore.getState();
    const activeSession = state.getActiveSession();
    expect(state.timer.status).toBe('running');
    expect(state.timer.phase).toBe('work');
    expect(state.timer.timeRemaining).toBe(DEFAULT_CONFIG.workDuration * 60);
    expect(state.timer.sessionsCompleted).toBe(0);
    expect(activeSession?.phase).toBe('work');
    expect(activeSession?.plannedDuration).toBe(DEFAULT_CONFIG.workDuration);
  });

  it('returns to a full idle work timer after the last linked schedule pomodoro completes', () => {
    useScheduleStore.setState({
      items: {
        'todo-1': {
          id: 'todo-1',
          type: 'todo',
          title: 'One round task',
          description: '',
          status: 'in_progress',
          priority: 'green',
          startAt: '2026-05-12T09:00:00.000Z',
          dueAt: '2026-05-12T09:30:00.000Z',
          reminderAt: null,
          pomodoroCount: 0,
          pomodoroRounds: 1,
          totalFocusMinutes: 0,
          completedAt: null,
          deletedAt: null,
          sortOrder: 0,
          createdAt: '2026-05-12T08:00:00.000Z',
          updatedAt: '2026-05-12T08:00:00.000Z',
        },
      },
    });
    usePomodoroStore.setState({
      config: DEFAULT_CONFIG,
      timer: {
        status: 'running',
        phase: 'work',
        timeRemaining: 1,
        sessionsCompleted: 0,
        currentSessionId: 'active',
        linkedTodoId: 'todo-1',
      },
      sessions: {
        active: {
          ...activeSession,
          id: 'active',
          todoId: 'todo-1',
          startTime: new Date(Date.now() - 25 * 60_000).toISOString(),
        },
      },
      _lastTickTimestamp: Date.now(),
    });

    usePomodoroStore.getState().completePhase();

    const state = usePomodoroStore.getState();
    expect(state.timer.status).toBe('idle');
    expect(state.timer.phase).toBe('work');
    expect(state.timer.timeRemaining).toBe(DEFAULT_CONFIG.workDuration * 60);
  });

  it('writes heartbeat snapshots only while running', () => {
    usePomodoroStore.getState().syncRemoteRuntime('heartbeat');
    expect(setUserData).not.toHaveBeenCalled();

    usePomodoroStore.setState({
      timer: {
        status: 'running',
        phase: 'work',
        timeRemaining: 1200,
        sessionsCompleted: 0,
        currentSessionId: 'active',
        linkedTodoId: null,
      },
      sessions: { active: activeSession },
      _lastTickTimestamp: Date.now(),
    });

    usePomodoroStore.getState().syncRemoteRuntime('heartbeat');

    expect(setUserData).toHaveBeenCalledWith('p2m-pomodoro-runtime-v2', expect.stringContaining('"action":"heartbeat"'));
  });

  it('restores remote config, history, and runtime from v2 snapshots', async () => {
    const remoteConfig = {
      kind: 'pomodoro-config-v2',
      config: {
        ...DEFAULT_CONFIG,
        workDuration: 35,
        ambientPlaybackMode: 'focus',
        ambientSound: 'rain',
        ambientVolumeBySound: { rain: 44 },
        ambientWasPlaying: true,
      },
      deviceId: 'remote',
      updatedAt: new Date(3000).toISOString(),
    };
    const remoteHistory = {
      kind: 'pomodoro-history-v2',
      sessions: { [completedSession.id]: completedSession },
      deviceId: 'remote',
      updatedAt: new Date(3000).toISOString(),
    };
    const remoteRuntime = {
      kind: 'pomodoro-runtime-v2',
      timer: {
        status: 'running',
        phase: 'work',
        timeRemaining: 900,
        sessionsCompleted: 1,
        currentSessionId: activeSession.id,
        linkedTodoId: activeSession.todoId,
      },
      activeSession,
      lastTickTimestamp: Date.now() - 60_000,
      action: 'heartbeat',
      deviceId: 'remote',
      updatedAt: new Date(4000).toISOString(),
    };
    vi.mocked(getUserData).mockImplementation(async (key: string) => {
      if (key === 'p2m-pomodoro-config-v2') return JSON.stringify(remoteConfig);
      if (key === 'p2m-pomodoro-history-v2') return JSON.stringify(remoteHistory);
      if (key === 'p2m-pomodoro-runtime-v2') return JSON.stringify(remoteRuntime);
      return null;
    });

    await usePomodoroStore.getState().restoreRemoteState();

    const state = usePomodoroStore.getState();
    expect(state.config.workDuration).toBe(35);
    expect(state.config.ambientSound).toBe('rain');
    expect(state.config.ambientPlaybackMode).toBe('focus');
    expect(state.config.ambientVolumeBySound.rain).toBe(44);
    expect(state.config.ambientWasPlaying).toBe(true);
    expect(state.sessions.done).toEqual(completedSession);
    expect(state.sessions.active).toEqual(activeSession);
    expect(state.timer.status).toBe('running');
    expect(state.timer.timeRemaining).toBeGreaterThanOrEqual(839);
    expect(state.timer.timeRemaining).toBeLessThanOrEqual(840);
  });

  it('does not rehydrate older remote history after local history was cleared', async () => {
    usePomodoroStore.setState({
      sessions: { [completedSession.id]: completedSession },
      _historyUpdatedAt: new Date(5000).toISOString(),
    });
    usePomodoroStore.getState().clearHistory();
    const clearedAt = usePomodoroStore.getState()._historyUpdatedAt;
    vi.mocked(getUserData).mockImplementation(async (key: string) => {
      if (key === 'p2m-pomodoro-history-v2') {
        return JSON.stringify({
          kind: 'pomodoro-history-v2',
          sessions: { [completedSession.id]: completedSession },
          deviceId: 'remote',
          updatedAt: new Date(4000).toISOString(),
        });
      }
      return null;
    });

    await usePomodoroStore.getState().restoreRemoteState();

    expect(usePomodoroStore.getState().sessions).toEqual({});
    expect(usePomodoroStore.getState()._historyUpdatedAt).toBe(clearedAt);
  });

  it('stops a linked schedule todo after the planned focus rounds are complete', () => {
    useScheduleStore.setState({
      items: {
        'todo-1': {
          id: 'todo-1',
          type: 'todo',
          title: 'Two hour task',
          description: '',
          status: 'in_progress',
          priority: 'green',
          startAt: '2026-05-12T09:00:00.000Z',
          dueAt: '2026-05-12T11:00:00.000Z',
          reminderAt: null,
          pomodoroCount: 3,
          pomodoroRounds: 4,
          totalFocusMinutes: 75,
          completedAt: null,
          deletedAt: null,
          sortOrder: 0,
          createdAt: '2026-05-12T08:00:00.000Z',
          updatedAt: '2026-05-12T08:00:00.000Z',
        },
      },
    });
    usePomodoroStore.setState({
      config: DEFAULT_CONFIG,
      timer: {
        status: 'running',
        phase: 'work',
        timeRemaining: 1,
        sessionsCompleted: 3,
        currentSessionId: 'active',
        linkedTodoId: 'todo-1',
      },
      sessions: {
        active: {
          ...activeSession,
          id: 'active',
          todoId: 'todo-1',
          startTime: new Date(Date.now() - 25 * 60_000).toISOString(),
        },
      },
      _lastTickTimestamp: Date.now(),
    });

    usePomodoroStore.getState().completePhase();

    expect(usePomodoroStore.getState().timer.status).toBe('idle');
    expect(usePomodoroStore.getState().timer.linkedTodoId).toBe('todo-1');
    expect(usePomodoroStore.getState().sessions.active.completed).toBe(true);
  });
});
