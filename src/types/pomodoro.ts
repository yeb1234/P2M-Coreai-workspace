import type { ID, ISODateTimeString } from './common';
import type { AmbientSound } from '../lib/sounds';

export type PomodoroPhase = 'work' | 'short_break' | 'long_break';
export type PomodoroStatus = 'idle' | 'running' | 'paused';
export type AmbientPlaybackMode = 'manual' | 'focus';
export type AmbientVolumeBySound = Partial<Record<Exclude<AmbientSound, 'none'>, number>>;

export interface PomodoroConfig {
  workDuration: number;
  shortBreakDuration: number;
  longBreakDuration: number;
  longBreakInterval: number;
  dailyGoal: number;
  ambientPlaybackMode: AmbientPlaybackMode;
  ambientSound: AmbientSound;
  ambientVolumeBySound: AmbientVolumeBySound;
  ambientWasPlaying: boolean;
}

export interface PomodoroSession {
  id: ID;
  todoId: ID | null;
  phase: PomodoroPhase;
  plannedDuration: number;
  actualDuration: number;
  completed: boolean;
  startTime: ISODateTimeString;
  endTime: ISODateTimeString | null;
  calendarEventId: ID | null;
}

export interface PomodoroTimerState {
  status: PomodoroStatus;
  phase: PomodoroPhase;
  timeRemaining: number;
  sessionsCompleted: number;
  currentSessionId: ID | null;
  linkedTodoId: ID | null;
}

export const DEFAULT_CONFIG: PomodoroConfig = {
  workDuration: 25,
  shortBreakDuration: 5,
  longBreakDuration: 15,
  longBreakInterval: 4,
  dailyGoal: 8,
  ambientPlaybackMode: 'manual',
  ambientSound: 'none',
  ambientVolumeBySound: {},
  ambientWasPlaying: false,
};

export const PHASE_LABELS: Record<PomodoroPhase, string> = {
  work: '专注',
  short_break: '短休息',
  long_break: '长休息',
};
