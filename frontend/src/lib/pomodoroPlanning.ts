import type { PomodoroConfig, ScheduleItem } from '../types';
import { isAllDaySchedule } from './scheduleTime';

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
  // 日期型 Todo 只代表「截止到这一天」，不能把 23 小时 59 分折算成 8 个番茄。
  // 没有显式轮次时按 1 个起算，和后端 create_todo 的默认值保持一致。
  if (isAllDaySchedule(item)) return 1;
  if (!item.startAt || !item.dueAt) return config.longBreakInterval;
  return calculatePomodoroRounds(getScheduleDurationMinutes(item.startAt, item.dueAt), config);
}

export function getSchedulePomodoroPlan(
  item: Pick<ScheduleItem, 'startAt' | 'dueAt' | 'pomodoroRounds'>,
  config: Pick<PomodoroConfig, 'workDuration' | 'shortBreakDuration' | 'longBreakDuration' | 'longBreakInterval'>
) {
  const durationMinutes = getScheduleDurationMinutes(item.startAt, item.dueAt);
  const hasWindow = Boolean(item.startAt && item.dueAt);
  const allDay = isAllDaySchedule(item);
  const rounds = item.pomodoroRounds > 0
    ? Math.min(2 * config.longBreakInterval, item.pomodoroRounds)
    : (allDay ? 1 : (hasWindow ? calculatePomodoroRounds(durationMinutes, config) : config.longBreakInterval));

  let plannedMinutes: number;
  if (rounds <= 0) {
    plannedMinutes = 0;
  } else if (rounds <= config.longBreakInterval) {
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

/**
 * 可选的番茄钟轮次。
 *
 * 为什么跳过「长休息间隔 + 1」这一档：一个长休息周期内的轮次是整齐的
 * （1..interval），第二轮完整的周期是 interval+2..2*interval。
 * 中间那一档（比如 interval=4 时的 5）会落在「刚做完长休息、只多做一个」
 * 的尴尬位置 —— 排出来的时间块既不是一个完整周期，也不好和日程对齐。
 *
 * 2026-11 修的两处问题：
 *
 * 1. **原来硬编码 [1,2,3,4,6,7,8]**，但 longBreakInterval 可以配到 10。
 *    把它设成 5 之后，新建表单的初始值取 longBreakInterval = 5，
 *    而下拉里没有 5 —— <select> 显示空白，用户以为「番茄钟数量不生效」。
 * 2. 上限 8 也是硬编码的，interval=6 时本应能排到 12。
 *
 * 现在按 interval 动态生成，上限 12 防止下拉过长。
 */
export function getAllowedPomodoroRounds(longBreakInterval: number): number[] {
  const interval = Math.max(1, Math.min(10, Math.floor(longBreakInterval) || 4));
  const maxRounds = Math.min(2 * interval, 12);
  const rounds: number[] = [];

  for (let n = 1; n <= interval; n += 1) rounds.push(n);

  // interval+1 这一档刻意跳过（见上面的说明）；如果它超过了上限就不生成
  for (let n = interval + 2; n <= maxRounds; n += 1) rounds.push(n);

  return rounds;
}

/** 兼容旧调用点。默认配置（interval=4）下等价于原来的 [1,2,3,4,6,7,8]。 */
export const ALLOWED_POMODORO_ROUNDS = getAllowedPomodoroRounds(4) as readonly number[];

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
  // 必须用当前 config 的动态列表：写死 [1,2,3,4,6,7,8] 时，
  // longBreakInterval=5 的用户永远推不出 5 个。
  let best = 1;
  for (const rounds of getAllowedPomodoroRounds(config.longBreakInterval)) {
    if (getPlannedMinutesForRounds(rounds, config) <= durationMinutes) {
      best = rounds;
    }
  }
  return best;
}

/** 把任意轮次夹到「允许的档位」里，取不超过它的最大档。 */
export function clampToAllowedRounds(
  rounds: number,
  longBreakInterval: number
): number {
  const allowed = getAllowedPomodoroRounds(longBreakInterval);
  if (allowed.length === 0) return 1;
  let best = allowed[0];
  for (const n of allowed) {
    if (n <= rounds) best = n;
  }
  return best;
}
