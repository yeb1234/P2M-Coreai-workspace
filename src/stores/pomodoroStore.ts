import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { localOnlyStorage } from '../lib/idbStorage';
import type {
  PomodoroSession,
  PomodoroConfig,
  PomodoroTimerState,
  PomodoroPhase,
  AmbientVolumeBySound,
  ID,
} from '../types';
import { DEFAULT_CONFIG } from '../types';
import { generateId } from '../lib/id';
import { toISODateTimeString, toLocalDateString } from '../lib/date';
import {
  buildPomodoroRemoteConfigSnapshot,
  buildPomodoroRemoteHistorySnapshot,
  buildPomodoroRemoteRuntimeSnapshot,
  isRemotePomodoroConfigNewer,
  isRemotePomodoroRuntimeNewer,
  isRemotePomodoroSnapshotNewer,
  loadPomodoroRemoteState,
  mergePomodoroSessionHistories,
  savePomodoroRemoteConfig,
  savePomodoroRemoteHistory,
  savePomodoroRemoteRuntime,
} from '../lib/pomodoroSync';
import { useScheduleStore } from './scheduleStore';
import { calculateSchedulePomodoroRounds } from '../lib/pomodoroPlanning';
import type { AmbientSound } from '../lib/sounds';
import { AMBIENT_SOUNDS } from '../lib/sounds';

/** 虚拟占位任务 ID：番茄钟在没有关联真实 todo 时，使用此 ID 作为挂起任务，方便其他 todo 检测覆盖 */
export const POMODORO_VIRTUAL_TODO_ID = '__pomodoro_virtual__';

interface PomodoroState {
  config: PomodoroConfig;
  timer: PomodoroTimerState;
  sessions: Record<ID, PomodoroSession>;
  _lastTickTimestamp: number | null;
  _remoteRuntimeUpdatedAt: string | null;
  _configUpdatedAt: string | null;
  _historyUpdatedAt: string | null;
  startTimer: (todoId?: ID) => void;
  pauseTimer: () => void;
  resumeTimer: () => void;
  resetTimer: () => void;
  tick: () => void;
  completePhase: () => void;
  skipPhase: () => void;
  updateConfig: (config: Partial<PomodoroConfig>) => void;
  updateAmbientSound: (sound: AmbientSound) => void;
  updateAmbientPlaybackState: (sound: AmbientSound, isPlaying: boolean) => void;
  updateAmbientVolume: (sound: Exclude<AmbientSound, 'none'>, volume: number) => void;
  linkToTodo: (todoId: ID | null) => void;
  updateSession: (id: ID, updates: Partial<PomodoroSession>) => void;
  getActiveSession: () => PomodoroSession | null;
  getSessionsByTodo: (todoId: ID) => PomodoroSession[];
  getTodayStats: () => { totalPomodoros: number; totalMinutes: number };
  getWeekStats: () => { dailyBreakdown: Record<string, { pomodoros: number; minutes: number }> };
  getWeekSessions: () => Record<string, PomodoroSession[]>;
  getPhaseDuration: (phase: PomodoroPhase) => number;
  clearHistory: () => void;
  clearTodayHistory: () => void;
  restoreTimer: () => void;
  restoreRemoteState: () => Promise<void>;
  restoreRemoteRuntime: () => Promise<void>;
  syncRemoteRuntime: (action?: string) => void;
}

const initialTimerState: PomodoroTimerState = {
  status: 'idle',
  phase: 'work',
  timeRemaining: 0,
  sessionsCompleted: 0,
  currentSessionId: null,
  linkedTodoId: null,
};

export function createPomodoroInitialTimer(config: PomodoroConfig): PomodoroTimerState {
  return {
    ...initialTimerState,
    timeRemaining: config.workDuration * 60,
  };
}

export function completedPomodoroSessionsOnly(sessions: Record<ID, PomodoroSession>): Record<ID, PomodoroSession> {
  return Object.fromEntries(
    Object.entries(sessions).filter(([, session]) => session.completed && Boolean(session.endTime)),
  );
}

function getPhaseDurationSeconds(config: PomodoroConfig, phase: PomodoroPhase): number {
  if (phase === 'work') return config.workDuration * 60;
  if (phase === 'short_break') return config.shortBreakDuration * 60;
  return config.longBreakDuration * 60;
}

function getRestorableSessions(sessions: Record<ID, PomodoroSession>, timer: PomodoroTimerState): Record<ID, PomodoroSession> {
  const completed = completedPomodoroSessionsOnly(sessions);
  if (!timer.currentSessionId) return completed;

  const activeSession = sessions[timer.currentSessionId];
  if (!activeSession || activeSession.completed) return completed;

  return {
    ...completed,
    [activeSession.id]: activeSession,
  };
}

function syncPomodoroRuntime(action: string, state: Pick<PomodoroState, 'timer' | 'sessions' | '_lastTickTimestamp'>): string {
  const snapshot = buildPomodoroRemoteRuntimeSnapshot(state.timer, state.sessions, state._lastTickTimestamp, action);
  void savePomodoroRemoteRuntime(snapshot);
  return snapshot.updatedAt;
}

function syncPomodoroConfig(config: PomodoroConfig): string {
  const snapshot = buildPomodoroRemoteConfigSnapshot(config);
  void savePomodoroRemoteConfig(snapshot);
  return snapshot.updatedAt;
}

function syncPomodoroHistory(sessions: Record<ID, PomodoroSession>): string {
  const snapshot = buildPomodoroRemoteHistorySnapshot(sessions);
  void savePomodoroRemoteHistory(snapshot);
  return snapshot.updatedAt;
}

function isKnownAmbientSound(sound: unknown): sound is AmbientSound {
  return sound === 'none' || (typeof sound === 'string' && sound in AMBIENT_SOUNDS);
}

function clampConfigNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numberValue)));
}

function sanitizeAmbientVolumeBySound(value: unknown): AmbientVolumeBySound {
  if (!value || typeof value !== 'object') return {};

  return Object.fromEntries(
    Object.keys(AMBIENT_SOUNDS).flatMap((sound) => {
      const rawVolume = (value as Record<string, unknown>)[sound];
      if (rawVolume === undefined) return [];
      const volume = typeof rawVolume === 'number' ? rawVolume : Number(rawVolume);
      if (!Number.isFinite(volume)) return [];
      return [[sound, Math.max(0, Math.min(100, Math.round(volume)))]];
    }),
  ) as AmbientVolumeBySound;
}

function sanitizePomodoroConfig(config: Partial<PomodoroConfig> | undefined): PomodoroConfig {
  const rawConfig = config || {};
  return {
    ...DEFAULT_CONFIG,
    ...rawConfig,
    workDuration: clampConfigNumber(rawConfig.workDuration, DEFAULT_CONFIG.workDuration, 1, 120),
    shortBreakDuration: clampConfigNumber(rawConfig.shortBreakDuration, DEFAULT_CONFIG.shortBreakDuration, 1, 30),
    longBreakDuration: clampConfigNumber(rawConfig.longBreakDuration, DEFAULT_CONFIG.longBreakDuration, 1, 60),
    longBreakInterval: clampConfigNumber(rawConfig.longBreakInterval, DEFAULT_CONFIG.longBreakInterval, 1, 10),
    dailyGoal: clampConfigNumber(rawConfig.dailyGoal, DEFAULT_CONFIG.dailyGoal, 1, 20),
    ambientPlaybackMode: rawConfig.ambientPlaybackMode === 'focus' || rawConfig.ambientPlaybackMode === 'manual'
      ? rawConfig.ambientPlaybackMode
      : DEFAULT_CONFIG.ambientPlaybackMode,
    ambientSound: isKnownAmbientSound(rawConfig.ambientSound) ? rawConfig.ambientSound : DEFAULT_CONFIG.ambientSound,
    ambientVolumeBySound: sanitizeAmbientVolumeBySound(rawConfig.ambientVolumeBySound),
    ambientWasPlaying: rawConfig.ambientWasPlaying === true,
  };
}

export function restorePomodoroRuntimeState(
  config: PomodoroConfig,
  timer: PomodoroTimerState | undefined,
  lastTickTimestamp: number | null | undefined,
): { timer: PomodoroTimerState; lastTickTimestamp: number | null } {
  if (!timer || timer.status === 'idle') {
    return { timer: createPomodoroInitialTimer(config), lastTickTimestamp: null };
  }

  const maxRemaining = getPhaseDurationSeconds(config, timer.phase);
  const baseRemaining = Math.max(0, Math.min(timer.timeRemaining || maxRemaining, maxRemaining));

  if (timer.status === 'paused') {
    return {
      timer: { ...timer, timeRemaining: baseRemaining },
      lastTickTimestamp: null,
    };
  }

  const now = Date.now();
  const elapsed = lastTickTimestamp ? Math.max(0, Math.floor((now - lastTickTimestamp) / 1000)) : 0;
  const timeRemaining = Math.max(0, baseRemaining - elapsed);

  if (timeRemaining <= 0) {
    return {
      timer: { ...timer, status: 'paused', timeRemaining: 0 },
      lastTickTimestamp: null,
    };
  }

  return {
    timer: { ...timer, status: 'running', timeRemaining },
    lastTickTimestamp: now,
  };
}

export function sanitizePomodoroPersistedState(data: Partial<PomodoroState>): Pick<PomodoroState, 'config' | 'sessions' | 'timer' | '_lastTickTimestamp' | '_remoteRuntimeUpdatedAt' | '_configUpdatedAt' | '_historyUpdatedAt'> {
  const config = sanitizePomodoroConfig(data.config);
  const timer = data.timer || createPomodoroInitialTimer(config);
  const restored = restorePomodoroRuntimeState(config, timer, data._lastTickTimestamp);
  return {
    config,
    sessions: getRestorableSessions((data.sessions || {}) as Record<ID, PomodoroSession>, restored.timer),
    timer: restored.timer,
    _lastTickTimestamp: restored.lastTickTimestamp,
    _remoteRuntimeUpdatedAt: typeof data._remoteRuntimeUpdatedAt === 'string' ? data._remoteRuntimeUpdatedAt : null,
    _configUpdatedAt: typeof data._configUpdatedAt === 'string' ? data._configUpdatedAt : null,
    _historyUpdatedAt: typeof data._historyUpdatedAt === 'string' ? data._historyUpdatedAt : null,
  };
}

export function migratePomodoroPersistedState(persisted: unknown, version: number): Pick<PomodoroState, 'config' | 'sessions' | 'timer' | '_lastTickTimestamp' | '_remoteRuntimeUpdatedAt' | '_configUpdatedAt' | '_historyUpdatedAt'> {
  const data = persisted as Record<string, unknown>;
  const config = data.config && typeof data.config === 'object'
    ? sanitizePomodoroConfig(data.config as Partial<PomodoroConfig>)
    : sanitizePomodoroConfig(undefined);
  const timer = data.timer && typeof data.timer === 'object'
    ? { ...(data.timer as PomodoroTimerState) }
    : undefined;

  // Older storage saved timeRemaining in minutes. Convert before sanitize clamps and restores runtime.
  if (version < 2 && timer && typeof timer.timeRemaining === 'number' && timer.timeRemaining < 120) {
    timer.timeRemaining = (timer.timeRemaining || config.workDuration) * 60;
  }

  return sanitizePomodoroPersistedState({
    ...data,
    config,
    timer,
    sessions: data.sessions && typeof data.sessions === 'object'
      ? data.sessions as Record<ID, PomodoroSession>
      : {},
  } as Partial<PomodoroState>);
}

export const usePomodoroStore = create<PomodoroState>()(
  persist(
    (set, get) => ({
      config: { ...DEFAULT_CONFIG },
      timer: createPomodoroInitialTimer(DEFAULT_CONFIG),
      sessions: {},
      _lastTickTimestamp: null,
      _remoteRuntimeUpdatedAt: null,
      _configUpdatedAt: null,
      _historyUpdatedAt: null,

      startTimer: (todoId) => {
        const state = get();
        const nextPhase: PomodoroPhase = state.timer.status === 'idle' ? 'work' : state.timer.phase;
        const nextTimeRemaining = state.timer.status === 'idle'
          ? state.config.workDuration * 60
          : state.timer.timeRemaining;
        const sessionId = generateId();
        const session: PomodoroSession = {
          id: sessionId,
          todoId: todoId || state.timer.linkedTodoId || null,
          phase: nextPhase,
          plannedDuration: nextTimeRemaining / 60,
          actualDuration: 0,
          completed: false,
          startTime: toISODateTimeString(new Date()),
          endTime: null,
          calendarEventId: null,
        };

        const nextState = {
          sessions: { ...state.sessions, [sessionId]: session },
          timer: {
            ...state.timer,
            status: 'running' as const,
            phase: nextPhase,
            timeRemaining: nextTimeRemaining,
            sessionsCompleted: state.timer.status === 'idle' ? 0 : state.timer.sessionsCompleted,
            currentSessionId: sessionId,
            linkedTodoId: todoId || state.timer.linkedTodoId || null,
          },
          _lastTickTimestamp: Date.now(),
          _remoteRuntimeUpdatedAt: null as string | null,
        };
        nextState._remoteRuntimeUpdatedAt = syncPomodoroRuntime('start', { ...state, ...nextState });

        set(nextState);
      },

      pauseTimer: () => {
        set((state) => {
          const nextState = {
            timer: { ...state.timer, status: 'paused' as const },
            _lastTickTimestamp: null,
            _remoteRuntimeUpdatedAt: null as string | null,
          };
          nextState._remoteRuntimeUpdatedAt = syncPomodoroRuntime('pause', { ...state, ...nextState });
          return nextState;
        });
      },

      resumeTimer: () => {
        set((state) => {
          const nextState = {
            timer: { ...state.timer, status: 'running' as const },
            _lastTickTimestamp: Date.now(),
            _remoteRuntimeUpdatedAt: null as string | null,
          };
          nextState._remoteRuntimeUpdatedAt = syncPomodoroRuntime('resume', { ...state, ...nextState });
          return nextState;
        });
      },

      resetTimer: () => {
        const state = get();
        const { currentSessionId } = state.timer;
        let sessions = state.sessions;

        if (currentSessionId) {
          const session = state.sessions[currentSessionId];
          if (session && !session.completed) {
            const updatedSessions = { ...state.sessions };
            delete updatedSessions[currentSessionId];
            sessions = updatedSessions;
          }
        }

        const nextState = {
          sessions,
          timer: {
            ...initialTimerState,
            timeRemaining: state.config.workDuration * 60,
            linkedTodoId: null,
          },
          _lastTickTimestamp: null,
          _remoteRuntimeUpdatedAt: null as string | null,
          _historyUpdatedAt: state._historyUpdatedAt,
        };
        nextState._remoteRuntimeUpdatedAt = syncPomodoroRuntime('reset', { ...state, ...nextState });
        if (sessions !== state.sessions) {
          nextState._historyUpdatedAt = syncPomodoroHistory(sessions);
        }

        set(nextState);
      },

      tick: () => {
        const state = get();
        if (state.timer.status !== 'running') return;

        const now = Date.now();
        const lastTick = state._lastTickTimestamp || now;
        const elapsed = Math.floor((now - lastTick) / 1000);
        const newTimeRemaining = state.timer.timeRemaining - Math.max(1, elapsed);

        if (newTimeRemaining <= 0) {
          state.completePhase();
          return;
        }

        set({
          timer: { ...state.timer, timeRemaining: newTimeRemaining },
          _lastTickTimestamp: now,
        });
      },

      completePhase: () => {
        const state = get();
        const { currentSessionId, phase, sessionsCompleted, linkedTodoId } = state.timer;

        if (currentSessionId) {
          const session = state.sessions[currentSessionId];
          if (session) {
            const actualDuration = Math.round(
              (Date.now() - new Date(session.startTime).getTime()) / 60000
            );

            const updatedSession: PomodoroSession = {
              ...session,
              completed: true,
              actualDuration: Math.max(1, actualDuration),
              endTime: toISODateTimeString(new Date()),
            };

            const newSessionsCompleted = phase === 'work' ? sessionsCompleted + 1 : sessionsCompleted;

            // 工作阶段完成 → 把这一轮记到关联的待办上。
            //
            // 之前这里什么都不做，但 TodoItem 的进度条读的是 todo.pomodoroCount ——
            // 于是用户关联待办做完 4 个番茄，待办里仍然显示 0/4。
            // 番茄钟只读待办、从不写回，这是两个模块最大的联动缺口。
            //
            // 注意排除虚拟待办（不选具体待办直接开始计时时用的占位 id）。
            if (phase === 'work' && linkedTodoId && linkedTodoId !== POMODORO_VIRTUAL_TODO_ID) {
              const linkedTodo = useScheduleStore.getState().items[linkedTodoId];
              if (linkedTodo && !linkedTodo.deletedAt) {
                useScheduleStore.getState().updateItem(linkedTodoId, {
                  pomodoroCount: linkedTodo.pomodoroCount + 1,
                  totalFocusMinutes: linkedTodo.totalFocusMinutes + Math.max(1, actualDuration),
                });
              }
            }

            let nextPhase: PomodoroPhase;
            let nextTimeRemaining: number;

            if (phase === 'work') {
              if (newSessionsCompleted % state.config.longBreakInterval === 0) {
                nextPhase = 'long_break';
                nextTimeRemaining = state.config.longBreakDuration * 60;
              } else {
                nextPhase = 'short_break';
                nextTimeRemaining = state.config.shortBreakDuration * 60;
              }
            } else {
              const todo = linkedTodoId ? useScheduleStore.getState().items[linkedTodoId] : null;
              const plannedPomodoros = todo ? calculateSchedulePomodoroRounds(todo, state.config) : state.config.longBreakInterval;
              if (!linkedTodoId || plannedPomodoros === 0 || sessionsCompleted >= plannedPomodoros) {
                const nextState = {
                  sessions: { ...state.sessions, [currentSessionId]: updatedSession },
                  timer: {
                    ...initialTimerState,
                    timeRemaining: state.config.workDuration * 60,
                    linkedTodoId,
                  },
                  _lastTickTimestamp: null,
                  _remoteRuntimeUpdatedAt: null as string | null,
                  _historyUpdatedAt: null as string | null,
                };
                const reason = phase === 'short_break' ? 'complete-short-break' : 'complete-long-break';
                nextState._remoteRuntimeUpdatedAt = syncPomodoroRuntime(reason, { ...state, ...nextState });
                nextState._historyUpdatedAt = syncPomodoroHistory(nextState.sessions);
                set(nextState);
                return;
              }
              nextPhase = 'work';
              nextTimeRemaining = state.config.workDuration * 60;
            }

            // Auto-start next phase
            const newSessionId = generateId();
            const nextSession: PomodoroSession = {
              id: newSessionId,
              todoId: linkedTodoId,
              phase: nextPhase,
              plannedDuration: nextTimeRemaining / 60,
              actualDuration: 0,
              completed: false,
              startTime: toISODateTimeString(new Date()),
              endTime: null,
              calendarEventId: null,
            };

            const nextState = {
              sessions: {
                ...state.sessions,
                [currentSessionId]: updatedSession,
                [newSessionId]: nextSession,
              },
              timer: {
                status: 'running' as const,
                phase: nextPhase,
                timeRemaining: nextTimeRemaining,
                sessionsCompleted: newSessionsCompleted,
                currentSessionId: newSessionId,
                linkedTodoId,
              },
              _lastTickTimestamp: Date.now(),
              _remoteRuntimeUpdatedAt: null as string | null,
              _historyUpdatedAt: null as string | null,
            };
            nextState._remoteRuntimeUpdatedAt = syncPomodoroRuntime('complete-phase', { ...state, ...nextState });
            nextState._historyUpdatedAt = syncPomodoroHistory(nextState.sessions);

            set(nextState);

            return;
          }
        }

        const nextState = {
          timer: {
            ...initialTimerState,
            timeRemaining: state.config.workDuration * 60,
            linkedTodoId,
          },
          _lastTickTimestamp: null,
          _remoteRuntimeUpdatedAt: null as string | null,
        };
        nextState._remoteRuntimeUpdatedAt = syncPomodoroRuntime('complete-phase-fallback', { ...state, ...nextState });
        set(nextState);
      },

      skipPhase: () => {
        const state = get();
        const { currentSessionId, phase, sessionsCompleted, linkedTodoId } = state.timer;
        let sessions = state.sessions;

        if (currentSessionId) {
          const session = state.sessions[currentSessionId];
          if (session && !session.completed) {
            const updatedSessions = { ...state.sessions };
            delete updatedSessions[currentSessionId];
            sessions = updatedSessions;
          }
        }

        let nextPhase: PomodoroPhase;
        let nextTimeRemaining: number;

        if (phase === 'work') {
          if (sessionsCompleted % state.config.longBreakInterval === 0 && sessionsCompleted > 0) {
            nextPhase = 'long_break';
            nextTimeRemaining = state.config.longBreakDuration * 60;
          } else {
            nextPhase = 'short_break';
            nextTimeRemaining = state.config.shortBreakDuration * 60;
          }
        } else if (phase === 'short_break') {
          nextPhase = 'work';
          nextTimeRemaining = state.config.workDuration * 60;
        } else {
          const todo = linkedTodoId ? useScheduleStore.getState().items[linkedTodoId] : null;
          const plannedPomodoros = todo ? calculateSchedulePomodoroRounds(todo, state.config) : state.config.longBreakInterval;
          if (!linkedTodoId || plannedPomodoros === 0 || sessionsCompleted >= plannedPomodoros) {
            const nextState = {
              sessions,
              timer: {
                ...initialTimerState,
                timeRemaining: state.config.workDuration * 60,
                linkedTodoId,
              },
              _lastTickTimestamp: null,
              _remoteRuntimeUpdatedAt: null as string | null,
              _historyUpdatedAt: state._historyUpdatedAt,
            };
            nextState._remoteRuntimeUpdatedAt = syncPomodoroRuntime('skip-long-break', { ...state, ...nextState });
            if (sessions !== state.sessions) {
              nextState._historyUpdatedAt = syncPomodoroHistory(sessions);
            }
            set(nextState);
            return;
          }
          nextPhase = 'work';
          nextTimeRemaining = state.config.workDuration * 60;
        }

        const newSessionId = generateId();
        const nextSession: PomodoroSession = {
          id: newSessionId,
          todoId: linkedTodoId,
          phase: nextPhase,
          plannedDuration: nextTimeRemaining / 60,
          actualDuration: 0,
          completed: false,
          startTime: toISODateTimeString(new Date()),
          endTime: null,
          calendarEventId: null,
        };

        const nextState = {
          sessions: {
            ...sessions,
            [newSessionId]: nextSession,
          },
          timer: {
            status: 'running' as const,
            phase: nextPhase,
            timeRemaining: nextTimeRemaining,
            sessionsCompleted,
            currentSessionId: newSessionId,
            linkedTodoId,
          },
          _lastTickTimestamp: Date.now(),
          _remoteRuntimeUpdatedAt: null as string | null,
          _historyUpdatedAt: state._historyUpdatedAt,
        };
        nextState._remoteRuntimeUpdatedAt = syncPomodoroRuntime('skip-phase', { ...state, ...nextState });
        if (sessions !== state.sessions) {
          nextState._historyUpdatedAt = syncPomodoroHistory(sessions);
        }
        set(nextState);
      },

      updateConfig: (config) => {
        set((state) => {
          const newConfig = { ...state.config, ...config };
          let timer = state.timer;
          const changesCurrentPhaseDuration =
            (timer.phase === 'work' && config.workDuration !== undefined && config.workDuration !== state.config.workDuration) ||
            (timer.phase === 'short_break' && config.shortBreakDuration !== undefined && config.shortBreakDuration !== state.config.shortBreakDuration) ||
            (timer.phase === 'long_break' && config.longBreakDuration !== undefined && config.longBreakDuration !== state.config.longBreakDuration);
          if (changesCurrentPhaseDuration) {
            timer = { ...timer, timeRemaining: getPhaseDurationSeconds(newConfig, timer.phase) };
          }
          const configUpdatedAt = syncPomodoroConfig(newConfig);
          const runtimeUpdatedAt = timer !== state.timer
            ? syncPomodoroRuntime('config-duration-change', { ...state, timer })
            : state._remoteRuntimeUpdatedAt;
          return { config: newConfig, timer, _configUpdatedAt: configUpdatedAt, _remoteRuntimeUpdatedAt: runtimeUpdatedAt };
        });
      },

      updateAmbientSound: (sound) => {
        set((state) => ({
          config: { ...state.config, ambientSound: sound, ambientWasPlaying: sound === 'none' ? false : state.config.ambientWasPlaying },
          _configUpdatedAt: syncPomodoroConfig({
            ...state.config,
            ambientSound: sound,
            ambientWasPlaying: sound === 'none' ? false : state.config.ambientWasPlaying,
          }),
        }));
      },

      updateAmbientPlaybackState: (sound, isPlaying) => {
        set((state) => {
          const config = {
            ...state.config,
            ambientSound: sound === 'none' ? state.config.ambientSound : sound,
            ambientWasPlaying: sound !== 'none' && isPlaying,
          };
          return {
            config,
            _configUpdatedAt: syncPomodoroConfig(config),
          };
        });
      },

      updateAmbientVolume: (sound, volume) => {
        set((state) => {
          const clampedVolume = Math.max(0, Math.min(100, Math.round(volume)));
          const config = {
            ...state.config,
            ambientVolumeBySound: {
              ...state.config.ambientVolumeBySound,
              [sound]: clampedVolume,
            },
          };
          return {
            config,
            _configUpdatedAt: syncPomodoroConfig(config),
          };
        });
      },

      linkToTodo: (todoId) => {
        set((state) => {
          const timer = { ...state.timer, linkedTodoId: todoId };
          return {
            timer,
            _remoteRuntimeUpdatedAt: syncPomodoroRuntime('link-todo', { ...state, timer }),
          };
        });
      },

      updateSession: (id, updates) => {
        set((state) => {
          const session = state.sessions[id];
          if (!session) return state;
          const sessions = {
            ...state.sessions,
            [id]: { ...session, ...updates },
          };
          const historyUpdatedAt = sessions[id].completed
            ? syncPomodoroHistory(sessions)
            : state._historyUpdatedAt;
          return {
            sessions,
            _historyUpdatedAt: historyUpdatedAt,
          };
        });
      },

      getActiveSession: () => {
        const state = get();
        if (!state.timer.currentSessionId) return null;
        return state.sessions[state.timer.currentSessionId] || null;
      },

      getSessionsByTodo: (todoId) => {
        return Object.values(get().sessions).filter((s) => s.todoId === todoId);
      },

      getTodayStats: () => {
        const state = get();
        const today = toLocalDateString(new Date());
        const sessions = Object.values(state.sessions).filter(
          (s) => s.completed && s.phase === 'work' && toLocalDateString(s.startTime) === today
        );
        return {
          totalPomodoros: sessions.length,
          totalMinutes: sessions.reduce((sum, s) => sum + s.actualDuration, 0),
        };
      },

      getWeekStats: () => {
        const state = get();
        const now = new Date();
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const sessions = Object.values(state.sessions).filter(
          (s) => s.completed && s.phase === 'work' && new Date(s.startTime) >= weekAgo
        );

        const dailyBreakdown: Record<string, { pomodoros: number; minutes: number }> = {};
        sessions.forEach((s) => {
          const date = toLocalDateString(s.startTime);
          if (!dailyBreakdown[date]) {
            dailyBreakdown[date] = { pomodoros: 0, minutes: 0 };
          }
          dailyBreakdown[date].pomodoros++;
          dailyBreakdown[date].minutes += s.actualDuration;
        });

        return { dailyBreakdown };
      },

      getWeekSessions: () => {
        const state = get();
        const now = new Date();
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const sessions = Object.values(state.sessions).filter(
          (s) => s.completed && s.phase === 'work' && new Date(s.startTime) >= weekAgo
        );

        const grouped: Record<string, PomodoroSession[]> = {};
        sessions.forEach((s) => {
          const date = toLocalDateString(s.startTime);
          if (!grouped[date]) grouped[date] = [];
          grouped[date].push(s);
        });

        // Sort sessions within each day by startTime
        Object.values(grouped).forEach((daySessions) => {
          daySessions.sort((a, b) => a.startTime.localeCompare(b.startTime));
        });

        return grouped;
      },

      getPhaseDuration: (phase) => {
        const config = get().config;
        switch (phase) {
          case 'work': return config.workDuration;
          case 'short_break': return config.shortBreakDuration;
          case 'long_break': return config.longBreakDuration;
          default: return config.workDuration;
        }
      },

      clearHistory: () => {
        set((state) => {
          const sessions = state.timer.currentSessionId
            ? Object.fromEntries(
                Object.entries(state.sessions).filter(([id]) => id === state.timer.currentSessionId),
              )
            : {};
          return {
            sessions,
            _historyUpdatedAt: syncPomodoroHistory(sessions),
          };
        });
      },

      clearTodayHistory: () => {
        set((state) => {
          const today = toLocalDateString(new Date());
          const sessions: Record<ID, PomodoroSession> = {};
          for (const [id, session] of Object.entries(state.sessions)) {
            if (id === state.timer.currentSessionId) {
              sessions[id] = session;
            } else if (toLocalDateString(session.startTime) !== today) {
              sessions[id] = session;
            }
          }
          return {
            sessions,
            _historyUpdatedAt: syncPomodoroHistory(sessions),
          };
        });
      },

      restoreTimer: () => {
        const state = get();
        const restored = restorePomodoroRuntimeState(state.config, state.timer, state._lastTickTimestamp);
        set({ timer: restored.timer, _lastTickTimestamp: restored.lastTickTimestamp });
      },

      restoreRemoteState: async () => {
        const remote = await loadPomodoroRemoteState();

        set((state) => {
          let config = state.config;
          let configUpdatedAt = state._configUpdatedAt;
          let sessions = state.sessions;
          let historyUpdatedAt = state._historyUpdatedAt;
          let timer = state.timer;
          let lastTickTimestamp = state._lastTickTimestamp;
          let runtimeUpdatedAt = state._remoteRuntimeUpdatedAt;

          if (remote.config && isRemotePomodoroConfigNewer(remote.config, configUpdatedAt)) {
            config = sanitizePomodoroConfig(remote.config.config);
            configUpdatedAt = remote.config.updatedAt;
          }

          if (remote.history && isRemotePomodoroSnapshotNewer(remote.history.updatedAt, historyUpdatedAt)) {
            sessions = mergePomodoroSessionHistories(sessions, remote.history.sessions);
            historyUpdatedAt = remote.history.updatedAt;
          }

          if (remote.runtime && isRemotePomodoroRuntimeNewer(remote.runtime, runtimeUpdatedAt)) {
            const runtimeSessions = remote.runtime.activeSession && !remote.runtime.activeSession.completed
              ? { ...sessions, [remote.runtime.activeSession.id]: remote.runtime.activeSession }
              : sessions;
            const restored = restorePomodoroRuntimeState(config, remote.runtime.timer, remote.runtime.lastTickTimestamp);
            sessions = getRestorableSessions(runtimeSessions, restored.timer);
            timer = restored.timer;
            lastTickTimestamp = restored.lastTickTimestamp;
            runtimeUpdatedAt = remote.runtime.updatedAt;
          }

          return {
            config,
            sessions,
            timer,
            _lastTickTimestamp: lastTickTimestamp,
            _remoteRuntimeUpdatedAt: runtimeUpdatedAt,
            _configUpdatedAt: configUpdatedAt,
            _historyUpdatedAt: historyUpdatedAt,
          };
        });
      },

      restoreRemoteRuntime: async () => {
        await get().restoreRemoteState();
      },

      syncRemoteRuntime: (action = 'heartbeat') => {
        const state = get();
        if (state.timer.status !== 'running' && action === 'heartbeat') return;
        const updatedAt = syncPomodoroRuntime(action, state);
        set({ _remoteRuntimeUpdatedAt: updatedAt });
      },
    }),
    {
      name: 'p2m-pomodoro-storage',
      storage: createJSONStorage(() => localOnlyStorage),
      version: 3,
      migrate: (persisted: unknown, version: number) => {
        return migratePomodoroPersistedState(persisted, version);
      },
      partialize: (state) => ({
        config: state.config,
        sessions: getRestorableSessions(state.sessions, state.timer),
        timer: state.timer,
        _lastTickTimestamp: state._lastTickTimestamp,
        _remoteRuntimeUpdatedAt: state._remoteRuntimeUpdatedAt,
        _configUpdatedAt: state._configUpdatedAt,
        _historyUpdatedAt: state._historyUpdatedAt,
      }),
      merge: (persisted, current) => {
        const saved = sanitizePomodoroPersistedState(persisted as Partial<PomodoroState>);
        return {
          ...current,
          ...saved,
        };
      },
    }
  )
);
