import type { PomodoroConfig, ScheduleItem } from '../types';

export function getScheduleDurationMinutes(startAt: string | null, dueAt: string | null): number {
  if (!startAt || !dueAt) return 0;
  const start = new Date(startAt).getTime();
  const due = new Date(dueAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(due) || due <= start) return 0;
  return Math.floor((due - start) / 60000);
}

export function calculatePomodoroRounds(
  durationMinutes: number,
  config: Pick<PomodoroConfig, 'workDuration' | 'shortBreakDuration' | 'longBreakDuration' | 'longBreakInterval'>
): number {
  if (durationMinutes <= 0) return 0;
  const simpleCycle = config.workDuration + config.shortBreakDuration;
  const oneRoundMinutes = config.longBreakInterval * config.workDuration
    + (config.longBreakInterval - 1) * config.shortBreakDuration
    + config.longBreakDuration;
  const twoRoundsMinutes = 2 * config.longBreakInterval * config.workDuration
    + (2 * config.longBreakInterval - 2) * config.shortBreakDuration
    + config.longBreakDuration;

  if (durationMinutes < oneRoundMinutes) {
    return Math.max(1, Math.min(config.longBreakInterval - 1, Math.floor(durationMinutes / simpleCycle)));
  }
  if (durationMinutes < twoRoundsMinutes) {
    return config.longBreakInterval;
  }
  return 2 * config.longBreakInterval;
}

export function calculateSchedulePomodoroRounds(
  item: Pick<ScheduleItem, 'startAt' | 'dueAt' | 'pomodoroRounds'>,
  config: Pick<PomodoroConfig, 'workDuration' | 'shortBreakDuration' | 'longBreakDuration' | 'longBreakInterval'>
): number {
  if (item.pomodoroRounds > 0) return Math.min(2 * config.longBreakInterval, item.pomodoroRounds);
  if (!item.startAt || !item.dueAt) return config.longBreakInterval;
  return calculatePomodoroRounds(getScheduleDurationMinutes(item.startAt, item.dueAt), config);
}

export function getSchedulePomodoroPlan(
  item: Pick<ScheduleItem, 'startAt' | 'dueAt' | 'pomodoroRounds'>,
  config: Pick<PomodoroConfig, 'workDuration' | 'shortBreakDuration' | 'longBreakDuration' | 'longBreakInterval'>
) {
  const durationMinutes = getScheduleDurationMinutes(item.startAt, item.dueAt);
  const rounds = item.pomodoroRounds > 0
    ? Math.min(2 * config.longBreakInterval, item.pomodoroRounds)
    : (item.startAt && item.dueAt ? calculatePomodoroRounds(durationMinutes, config) : config.longBreakInterval);

  let plannedMinutes: number;
  if (rounds <= config.longBreakInterval) {
    plannedMinutes = rounds * config.workDuration + (rounds - 1) * config.shortBreakDuration;
    if (rounds === config.longBreakInterval) {
      plannedMinutes += config.longBreakDuration;
    }
  } else {
    plannedMinutes = rounds * config.workDuration + (rounds - 2) * config.shortBreakDuration + config.longBreakDuration;
  }

  return {
    durationMinutes,
    rounds,
    plannedMinutes,
    plannedFocusMinutes: rounds * config.workDuration,
  };
}

export function getMaxPomodoroPlanMinutes(
  config: Pick<PomodoroConfig, 'workDuration' | 'shortBreakDuration' | 'longBreakDuration' | 'longBreakInterval'>
): number {
  const rounds = 2 * config.longBreakInterval;
  return rounds * config.workDuration + (rounds - 2) * config.shortBreakDuration + config.longBreakDuration;
}

export const ALLOWED_POMODORO_ROUNDS = [1, 2, 3, 4, 6, 7, 8] as const;

export function getPlannedMinutesForRounds(
  rounds: number,
  config: Pick<PomodoroConfig, 'workDuration' | 'shortBreakDuration' | 'longBreakDuration' | 'longBreakInterval'>
): number {
  if (rounds <= 0) return 0;
  if (rounds <= config.longBreakInterval) {
    let minutes = rounds * config.workDuration + (rounds - 1) * config.shortBreakDuration;
    if (rounds === config.longBreakInterval) {
      minutes += config.longBreakDuration;
    }
    return minutes;
  }
  return rounds * config.workDuration + (rounds - 2) * config.shortBreakDuration + config.longBreakDuration;
}

export function inferAllowedRoundsFromDuration(
  durationMinutes: number,
  config: Pick<PomodoroConfig, 'workDuration' | 'shortBreakDuration' | 'longBreakDuration' | 'longBreakInterval'>
): number {
  if (durationMinutes <= 0) return 1;
  let best = 1;
  for (const rounds of ALLOWED_POMODORO_ROUNDS) {
    if (getPlannedMinutesForRounds(rounds, config) <= durationMinutes) {
      best = rounds;
    }
  }
  return best;
}
