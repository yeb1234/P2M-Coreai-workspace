import { describe, expect, it } from 'vitest';
import { calculatePomodoroRounds, calculateSchedulePomodoroRounds, getSchedulePomodoroPlan, getMaxPomodoroPlanMinutes } from '../lib/pomodoroPlanning';

// default: 1轮 = 4个番茄钟(130min), 2轮 = 8个番茄钟(245min)
const defaultConfig = { workDuration: 25, shortBreakDuration: 5, longBreakDuration: 15, longBreakInterval: 4 };

describe('pomodoro planning from schedule time range', () => {
  it('returns pomodoro count for short duration (< 1 round)', () => {
    // 30min / 30 = 1个番茄钟
    expect(calculatePomodoroRounds(30, defaultConfig)).toBe(1);
  });

  it('returns multiple pomodoros when duration fits several but < 1 round', () => {
    // 90min / 30 = 3个番茄钟 (< 130min的1轮)
    expect(calculatePomodoroRounds(90, defaultConfig)).toBe(3);
  });

  it('returns 1 round when duration reaches 1 round threshold', () => {
    expect(calculatePomodoroRounds(130, defaultConfig)).toBe(4);
  });

  it('returns 1 round for duration between 1 and 2 rounds', () => {
    expect(calculatePomodoroRounds(200, defaultConfig)).toBe(4);
  });

  it('returns 2 rounds when duration reaches 2 rounds threshold', () => {
    expect(calculatePomodoroRounds(245, defaultConfig)).toBe(8);
  });

  it('caps at 2 rounds even for very long durations', () => {
    expect(calculatePomodoroRounds(500, defaultConfig)).toBe(8);
  });

  it('uses schedule start/due times as planning source', () => {
    // 120min < 130min(1轮), floor(120/30)=4 capped by longBreakInterval-1=3 → 3个番茄钟
    expect(calculateSchedulePomodoroRounds({
      startAt: '2026-05-12T09:00:00.000Z',
      dueAt: '2026-05-12T11:00:00.000Z',
      pomodoroRounds: 0,
    }, defaultConfig)).toBe(3);
  });

  it('uses one round for unscheduled todos', () => {
    expect(calculateSchedulePomodoroRounds({
      startAt: null,
      dueAt: null,
      pomodoroRounds: 0,
    }, defaultConfig)).toBe(4);
  });

  it('prefers user-set pomodoroRounds over time-range calculation', () => {
    expect(calculateSchedulePomodoroRounds({
      startAt: '2026-05-12T09:00:00.000Z',
      dueAt: '2026-05-12T11:00:00.000Z',
      pomodoroRounds: 4,
    }, defaultConfig)).toBe(4);
  });

  it('caps user-set pomodoroRounds at 2 rounds (8 pomodoros)', () => {
    expect(calculateSchedulePomodoroRounds({
      startAt: '2026-05-12T09:00:00.000Z',
      dueAt: '2026-05-12T11:00:00.000Z',
      pomodoroRounds: 10,
    }, defaultConfig)).toBe(8);
  });
});

describe('getSchedulePomodoroPlan', () => {
  it('short plan (< 1 round) uses work + shortBreak only', () => {
    const plan = getSchedulePomodoroPlan({
      startAt: '2026-05-12T09:00:00.000Z',
      dueAt: '2026-05-12T09:30:00.000Z',
      pomodoroRounds: 0,
    }, defaultConfig);
    expect(plan.rounds).toBe(1);
    expect(plan.plannedMinutes).toBe(25); // 1 work, no break after last
    expect(plan.plannedFocusMinutes).toBe(25);
  });

  it('3-pomodoro plan uses correct breaks', () => {
    const plan = getSchedulePomodoroPlan({
      startAt: '2026-05-12T09:00:00.000Z',
      dueAt: '2026-05-12T10:30:00.000Z', // 90min → 3 pomodoros
      pomodoroRounds: 0,
    }, defaultConfig);
    expect(plan.rounds).toBe(3);
    expect(plan.plannedMinutes).toBe(85); // 3*25 + 2*5
    expect(plan.plannedFocusMinutes).toBe(75);
  });

  it('1-round plan includes long break', () => {
    const plan = getSchedulePomodoroPlan({
      startAt: '2026-05-12T09:00:00.000Z',
      dueAt: '2026-05-12T11:10:00.000Z', // 130min → 1 round
      pomodoroRounds: 0,
    }, defaultConfig);
    expect(plan.rounds).toBe(4);
    expect(plan.plannedMinutes).toBe(130); // 4*25 + 3*5 + 15
    expect(plan.plannedFocusMinutes).toBe(100);
  });

  it('2-round plan excludes trailing long break', () => {
    const plan = getSchedulePomodoroPlan({
      startAt: '2026-05-12T09:00:00.000Z',
      dueAt: '2026-05-12T13:05:00.000Z', // 245min → 2 rounds
      pomodoroRounds: 0,
    }, defaultConfig);
    expect(plan.rounds).toBe(8);
    expect(plan.plannedMinutes).toBe(245); // 8*25 + 6*5 + 15
    expect(plan.plannedFocusMinutes).toBe(200);
  });

  it('caps manual pomodoroRounds at 2 rounds in plan', () => {
    const plan = getSchedulePomodoroPlan({
      startAt: '2026-05-12T09:00:00.000Z',
      dueAt: '2026-05-12T13:05:00.000Z',
      pomodoroRounds: 12,
    }, defaultConfig);
    expect(plan.rounds).toBe(8);
    expect(plan.plannedMinutes).toBe(245);
  });
});

describe('getMaxPomodoroPlanMinutes', () => {
  it('returns 2-round duration (excludes trailing long break)', () => {
    expect(getMaxPomodoroPlanMinutes(defaultConfig)).toBe(245);
  });
});
