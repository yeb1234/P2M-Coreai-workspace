import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { localOnlyStorage } from '../lib/idbStorage';
import type {
  PomodoroSession,
  PomodoroConfig,
  PomodoroTimerState,
  PomodoroPhase,
  ID,
} from '../types';
import { DEFAULT_CONFIG } from '../types';
import { generateId } from '../lib/id';
import { toISODateTimeString, toLocalDateString } from '../lib/date';
import { useTodoStore } from './todoStore';

interface PomodoroState {
  config: PomodoroConfig;
  timer: PomodoroTimerState;
  sessions: Record<ID, PomodoroSession>;
  _lastTickTimestamp: number | null;
  startTimer: (todoId?: ID) => void;
  pauseTimer: () => void;
  resumeTimer: () => void;
  resetTimer: () => void;
  tick: () => void;
  completePhase: () => void;
  updateConfig: (config: Partial<PomodoroConfig>) => void;
  linkToTodo: (todoId: ID | null) => void;
  updateSession: (id: ID, updates: Partial<PomodoroSession>) => void;
  getActiveSession: () => PomodoroSession | null;
  getSessionsByTodo: (todoId: ID) => PomodoroSession[];
  getTodayStats: () => { totalPomodoros: number; totalMinutes: number };
  getWeekStats: () => { dailyBreakdown: Record<string, { pomodoros: number; minutes: number }> };
  getWeekSessions: () => Record<string, PomodoroSession[]>;
  getPhaseDuration: (phase: PomodoroPhase) => number;
  clearHistory: () => void;
  restoreTimer: () => void;
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

export function sanitizePomodoroPersistedState(data: Partial<PomodoroState>): Pick<PomodoroState, 'config' | 'sessions' | 'timer' | '_lastTickTimestamp'> {
  const config = { ...DEFAULT_CONFIG, ...(data.config || {}) };
  return {
    config,
    sessions: completedPomodoroSessionsOnly((data.sessions || {}) as Record<ID, PomodoroSession>),
    timer: createPomodoroInitialTimer(config),
    _lastTickTimestamp: null,
  };
}

export const usePomodoroStore = create<PomodoroState>()(
  persist(
    (set, get) => ({
      config: { ...DEFAULT_CONFIG },
      timer: createPomodoroInitialTimer(DEFAULT_CONFIG),
      sessions: {},
      _lastTickTimestamp: null,

      startTimer: (todoId) => {
        const state = get();
        const sessionId = generateId();
        const session: PomodoroSession = {
          id: sessionId,
          todoId: todoId || state.timer.linkedTodoId || null,
          phase: state.timer.phase,
          plannedDuration: state.getPhaseDuration(state.timer.phase),
          actualDuration: 0,
          completed: false,
          startTime: toISODateTimeString(new Date()),
          endTime: null,
          calendarEventId: null,
        };

        set({
          sessions: { ...state.sessions, [sessionId]: session },
          timer: {
            ...state.timer,
            status: 'running',
            currentSessionId: sessionId,
            linkedTodoId: todoId || state.timer.linkedTodoId || null,
          },
          _lastTickTimestamp: Date.now(),
        });
      },

      pauseTimer: () => {
        set((state) => ({
          timer: { ...state.timer, status: 'paused' },
          _lastTickTimestamp: null,
        }));
      },

      resumeTimer: () => {
        set((state) => ({
          timer: { ...state.timer, status: 'running' },
          _lastTickTimestamp: Date.now(),
        }));
      },

      resetTimer: () => {
        const state = get();
        const { currentSessionId } = state.timer;

        if (currentSessionId) {
          const session = state.sessions[currentSessionId];
          if (session && !session.completed) {
            const updatedSessions = { ...state.sessions };
            delete updatedSessions[currentSessionId];
            set({
              sessions: updatedSessions,
            });
          }
        }

        set({
          timer: {
            ...initialTimerState,
            timeRemaining: state.config.workDuration * 60,
            linkedTodoId: state.timer.linkedTodoId,
          },
        });
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

            if (linkedTodoId && phase === 'work') {
              const todo = useTodoStore.getState().todos[linkedTodoId];
              const plannedPomodoros = Math.max(0, todo?.pomodoroRounds || 0);
              const nextCompletedPomodoros = (todo?.pomodoroCount || 0) + 1;

              if (plannedPomodoros > 0 && nextCompletedPomodoros >= plannedPomodoros) {
                set({
                  sessions: { ...state.sessions, [currentSessionId]: updatedSession },
                  timer: { ...initialTimerState, linkedTodoId },
                  _lastTickTimestamp: null,
                });
                return;
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
            } else if (phase === 'short_break') {
              nextPhase = 'work';
              nextTimeRemaining = state.config.workDuration * 60;
            } else {
              // long_break completed — one full round done, stop the timer
              set({
                sessions: { ...state.sessions, [currentSessionId]: updatedSession },
                timer: {
                  ...initialTimerState,
                  timeRemaining: state.config.workDuration * 60,
                  linkedTodoId,
                },
                _lastTickTimestamp: null,
              });
              return;
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

            set({
              sessions: {
                ...state.sessions,
                [currentSessionId]: updatedSession,
                [newSessionId]: nextSession,
              },
              timer: {
                status: 'running',
                phase: nextPhase,
                timeRemaining: nextTimeRemaining,
                sessionsCompleted: newSessionsCompleted,
                currentSessionId: newSessionId,
                linkedTodoId,
              },
              _lastTickTimestamp: Date.now(),
            });

            return;
          }
        }

        set({
          timer: {
            ...initialTimerState,
            linkedTodoId,
          },
        });
      },

      updateConfig: (config) => {
        set((state) => {
          const newConfig = { ...state.config, ...config };
          let timer = state.timer;
          const phase = timer.phase;
          let duration: number;
          if (phase === 'work') duration = newConfig.workDuration;
          else if (phase === 'short_break') duration = newConfig.shortBreakDuration;
          else duration = newConfig.longBreakDuration;
          timer = { ...timer, timeRemaining: duration * 60 };
          return { config: newConfig, timer };
        });
      },

      linkToTodo: (todoId) => {
        set((state) => ({
          timer: { ...state.timer, linkedTodoId: todoId },
        }));
      },

      updateSession: (id, updates) => {
        set((state) => {
          const session = state.sessions[id];
          if (!session) return state;
          return {
            sessions: {
              ...state.sessions,
              [id]: { ...session, ...updates },
            },
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
        set({ sessions: {} });
      },

      restoreTimer: () => {
        const state = get();
        if (state.timer.status === 'idle' && !state._lastTickTimestamp) return;
        set({ timer: createPomodoroInitialTimer(state.config), _lastTickTimestamp: null });
      },
    }),
    {
      name: 'p2m-pomodoro-storage',
      storage: createJSONStorage(() => localOnlyStorage),
      version: 3,
      migrate: (persisted: unknown, version: number) => {
        const data = persisted as Record<string, unknown>;
        const config = data.config && typeof data.config === 'object'
          ? { ...DEFAULT_CONFIG, ...data.config } as PomodoroConfig
          : { ...DEFAULT_CONFIG };
        const safe: Record<string, unknown> = sanitizePomodoroPersistedState({
          ...data,
          config,
          sessions: data.sessions && typeof data.sessions === 'object'
            ? data.sessions as Record<ID, PomodoroSession>
            : {},
        } as Partial<PomodoroState>);
        // Fix timeRemaining that was saved in minutes instead of seconds
        if (version < 2 && data.timer && typeof data.timer === 'object') {
          const timer = data.timer as Record<string, unknown>;
          if (typeof timer.timeRemaining === 'number' && timer.timeRemaining < 120) {
            timer.timeRemaining = (timer.timeRemaining || config.workDuration) * 60;
          }
        }
        return safe;
      },
      partialize: (state) => ({
        config: state.config,
        sessions: completedPomodoroSessionsOnly(state.sessions),
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
