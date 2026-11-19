import { describe, expect, it } from 'vitest';
import { formatNotificationTimeAgo } from '../components/layout/notificationTime';

describe('notification time formatting', () => {
  const now = new Date('2026-05-11T12:00:00.000Z').getTime();

  it('formats recent notifications as relative Chinese text', () => {
    expect(formatNotificationTimeAgo('2026-05-11T11:59:40.000Z', now)).toBe('刚刚');
    expect(formatNotificationTimeAgo('2026-05-11T11:35:00.000Z', now)).toBe('25分钟前');
    expect(formatNotificationTimeAgo('2026-05-11T09:30:00.000Z', now)).toBe('2小时前');
  });

  it('uses a date for older or invalid notification times', () => {
    expect(formatNotificationTimeAgo('2026-05-09T12:00:00.000Z', now)).toContain('2026');
    expect(formatNotificationTimeAgo('not-a-date', now)).toBe('');
  });
});
