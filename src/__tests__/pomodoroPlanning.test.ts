import { describe, expect, it } from 'vitest';
import { calculatePomodoroRounds, calculateSchedulePomodoroRounds } from '../lib/pomodoroPlanning';

describe('pomodoro planning from schedule time range', () => {
  it('calculates four pomodoros for a two-hour schedule with 25+5 defaults', () => {
    expect(calculatePomodoroRounds(120, { workDuration: 25, shortBreakDuration: 5 })).toBe(4);
  });

  it('floors pomodoro rounds for longer focus configurations', () => {
    expect(calculatePomodoroRounds(120, { workDuration: 35, shortBreakDuration: 5 })).toBe(3);
  });

  it('uses the schedule start and due times as the planning source', () => {
    expect(calculateSchedulePomodoroRounds({
      startAt: '2026-05-12T09:00:00.000Z',
      dueAt: '2026-05-12T11:00:00.000Z',
    }, { workDuration: 25, shortBreakDuration: 5 })).toBe(4);
  });

  it('uses one pomodoro for unscheduled todos', () => {
    expect(calculateSchedulePomodoroRounds({
      startAt: null,
      dueAt: null,
    }, { workDuration: 25, shortBreakDuration: 5 })).toBe(1);
  });
});
