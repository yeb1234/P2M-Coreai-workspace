import type { PomodoroConfig, ScheduleItem } from '../types';

export function getScheduleDurationMinutes(startAt: string | null, dueAt: string | null): number {
  if (!startAt || !dueAt) return 0;
  const start = new Date(startAt).getTime();
  const due = new Date(dueAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(due) || due <= start) return 0;
  return Math.floor((due - start) / 60000);
}

export function calculatePomodoroRounds(durationMinutes: number, config: Pick<PomodoroConfig, 'workDuration' | 'shortBreakDuration'>): number {
  const cycleMinutes = Math.max(1, config.workDuration + config.shortBreakDuration);
  if (durationMinutes <= 0) return 0;
  return Math.max(1, Math.floor(durationMinutes / cycleMinutes));
}

export function calculateSchedulePomodoroRounds(
  item: Pick<ScheduleItem, 'startAt' | 'dueAt' | 'pomodoroRounds'>,
  config: Pick<PomodoroConfig, 'workDuration' | 'shortBreakDuration'>
): number {
  // 用户明确设定了 pomodoroRounds（>0），直接用它作为番茄钟个数
  if (item.pomodoroRounds > 0) return item.pomodoroRounds;
  if (!item.startAt || !item.dueAt) return 1;
  return calculatePomodoroRounds(getScheduleDurationMinutes(item.startAt, item.dueAt), config);
}

export function getSchedulePomodoroPlan(
  item: Pick<ScheduleItem, 'startAt' | 'dueAt' | 'pomodoroRounds'>,
  config: Pick<PomodoroConfig, 'workDuration' | 'shortBreakDuration'>
) {
  const durationMinutes = getScheduleDurationMinutes(item.startAt, item.dueAt);
  // 用户明确设定了 pomodoroRounds（>0），优先使用
  const rounds = item.pomodoroRounds > 0
    ? item.pomodoroRounds
    : (item.startAt && item.dueAt ? calculatePomodoroRounds(durationMinutes, config) : 1);
  const cycleMinutes = Math.max(1, config.workDuration + config.shortBreakDuration);
  return {
    durationMinutes,
    rounds,
    plannedMinutes: rounds * cycleMinutes,
    plannedFocusMinutes: rounds * config.workDuration,
  };
}
