import { describe, it, expect } from 'vitest';
import { toISODateString, formatTime, formatDuration, isTodayCheck } from '../lib/date';

describe('date utilities', () => {
  describe('toISODateString', () => {
    it('formats date as YYYY-MM-DD', () => {
      const date = new Date(2026, 4, 8); // May 8, 2026
      expect(toISODateString(date)).toBe('2026-05-08');
    });

    it('pads single-digit months and days', () => {
      const date = new Date(2026, 0, 5); // Jan 5, 2026
      expect(toISODateString(date)).toBe('2026-01-05');
    });
  });

  describe('formatTime', () => {
    it('formats seconds to MM:SS', () => {
      expect(formatTime(1500)).toBe('25:00');
      expect(formatTime(65)).toBe('01:05');
      expect(formatTime(0)).toBe('00:00');
    });
  });

  describe('formatDuration', () => {
    it('formats minutes to readable string', () => {
      expect(formatDuration(25)).toBe('25分钟');
      expect(formatDuration(60)).toBe('1小时');
      expect(formatDuration(90)).toBe('1小时30分钟');
      expect(formatDuration(0)).toBe('0分钟');
    });
  });

  describe('isTodayCheck', () => {
    it('returns true for today', () => {
      expect(isTodayCheck(new Date())).toBe(true);
    });

    it('returns false for yesterday', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      expect(isTodayCheck(yesterday)).toBe(false);
    });
  });
});
