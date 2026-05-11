import { describe, expect, it } from 'vitest';
import { formatWatchProgress, getWatchProgressPercent } from '../components/video/videoFormat';

describe('video format utilities', () => {
  it('calculates watch progress only when a real duration is available', () => {
    expect(getWatchProgressPercent(30, 120)).toBe(25);
    expect(getWatchProgressPercent(200, 100)).toBe(100);
    expect(getWatchProgressPercent(-5, 100)).toBe(0);
    expect(getWatchProgressPercent(30, null)).toBeNull();
    expect(getWatchProgressPercent(null, 120)).toBeNull();
  });

  it('formats watch progress consistently across video lists', () => {
    expect(formatWatchProgress(65, 125)).toBe('1:05 / 2:05');
    expect(formatWatchProgress(null, 125)).toBe('--:-- / 2:05');
  });
});
