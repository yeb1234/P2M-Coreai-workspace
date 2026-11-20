import { describe, expect, it } from 'vitest';
import { getNextWholeHour, isAllDaySchedule } from '../lib/scheduleTime';

describe('getNextWholeHour', () => {
  it('returns current hour when exactly on the hour', () => {
    const now = new Date(2026, 4, 12, 11, 0, 0);
    const result = getNextWholeHour(now);

    expect(result.date).toBe('2026-05-12');
    expect(result.startTime).toBe('11:00');
    expect(result.endTime).toBe('12:00');
    expect(result.endDate).toBe('2026-05-12');
  });

  it('rounds up to next hour when minutes are non-zero', () => {
    const now = new Date(2026, 4, 12, 10, 35, 0);
    const result = getNextWholeHour(now);

    expect(result.date).toBe('2026-05-12');
    expect(result.startTime).toBe('11:00');
    expect(result.endTime).toBe('12:00');
    expect(result.endDate).toBe('2026-05-12');
  });

  it('rolls over to next day at 23:01', () => {
    const now = new Date(2026, 4, 12, 23, 1, 0);
    const result = getNextWholeHour(now);

    expect(result.date).toBe('2026-05-13');
    expect(result.startTime).toBe('00:00');
    expect(result.endTime).toBe('01:00');
    expect(result.endDate).toBe('2026-05-13');
  });

  it('endDate rolls over when startTime is 23:00 exact', () => {
    const now = new Date(2026, 4, 12, 22, 45, 0);
    const result = getNextWholeHour(now);

    expect(result.date).toBe('2026-05-12');
    expect(result.startTime).toBe('23:00');
    expect(result.endTime).toBe('00:00');
    expect(result.endDate).toBe('2026-05-13');
  });
});

describe('isAllDaySchedule', () => {
  it('recognizes a same-day 00:00-23:59 todo as date-only', () => {
    expect(isAllDaySchedule({
      startAt: '2026-11-21T00:00:00',
      dueAt: '2026-11-21T23:59:00',
    })).toBe(true);
  });

  it('does not treat a real timed block as all-day', () => {
    expect(isAllDaySchedule({
      startAt: '2026-11-21T09:00:00',
      dueAt: '2026-11-21T17:00:00',
    })).toBe(false);
  });

  it('does not treat a cross-day range as all-day', () => {
    expect(isAllDaySchedule({
      startAt: '2026-11-21T00:00:00',
      dueAt: '2026-11-22T23:59:00',
    })).toBe(false);
  });
});
