import { describe, expect, it } from 'vitest';
import { getDefaultReminderInputValue, parseTodoQuickInput } from '../lib/todoQuickInput';

describe('TodoForm defaults', () => {
  it('defaults reminder focus to at least 30 minutes later on a half-hour boundary', () => {
    const value = getDefaultReminderInputValue(new Date(2026, 4, 11, 16, 7, 12));

    expect(value).toBe('2026-05-11T17:00');
  });

  it('keeps an exact half-hour target when the 30 minute offset is already aligned', () => {
    const value = getDefaultReminderInputValue(new Date(2026, 4, 11, 16, 0, 0));

    expect(value).toBe('2026-05-11T16:30');
  });

  it('parses same-day afternoon reminders from quick todo text', () => {
    const parsed = parseTodoQuickInput('洗澡 下午6点', new Date(2026, 4, 11, 9, 0, 0));

    expect(parsed.title).toBe('洗澡');
    expect(parsed.dueDate).toBe('2026-05-11');
    expect(parsed.reminderAt).toBe(new Date(2026, 4, 11, 18, 0, 0).toISOString());
  });

  it('parses tomorrow afternoon reminders from quick todo text', () => {
    const parsed = parseTodoQuickInput('洗澡 明天下午6点', new Date(2026, 4, 11, 9, 0, 0));

    expect(parsed.title).toBe('洗澡');
    expect(parsed.dueDate).toBe('2026-05-12');
    expect(parsed.reminderAt).toBe(new Date(2026, 4, 12, 18, 0, 0).toISOString());
  });

  it('keeps tomato shortcuts as individual pomodoros', () => {
    const parsed = parseTodoQuickInput('写报告 明天下午6点 /t1 /p', new Date(2026, 4, 11, 9, 0, 0));

    expect(parsed.title).toBe('写报告');
    expect(parsed.pomodoroRounds).toBe(1);
    expect(parsed.priority).toBe('high');
  });

  it('parses month-day due dates', () => {
    const parsed = parseTodoQuickInput('预约体检 5月9', new Date(2026, 4, 1, 9, 0, 0));

    expect(parsed.title).toBe('预约体检');
    expect(parsed.dueDate).toBe('2026-05-09');
    expect(parsed.reminderAt).toBeUndefined();
  });

  it('parses month-day reminders with time', () => {
    const parsed = parseTodoQuickInput('预约体检 5月9 下午6点', new Date(2026, 4, 1, 9, 0, 0));

    expect(parsed.title).toBe('预约体检');
    expect(parsed.dueDate).toBe('2026-05-09');
    expect(parsed.reminderAt).toBe(new Date(2026, 4, 9, 18, 0, 0).toISOString());
  });

  it('parses bare hour as the next likely occurrence', () => {
    const morning = parseTodoQuickInput('洗澡 6点', new Date(2026, 4, 11, 5, 0, 0));
    const midday = parseTodoQuickInput('洗澡 6点', new Date(2026, 4, 11, 9, 0, 0));
    const night = parseTodoQuickInput('洗澡 6点', new Date(2026, 4, 11, 19, 0, 0));

    expect(morning.reminderAt).toBe(new Date(2026, 4, 11, 6, 0, 0).toISOString());
    expect(midday.reminderAt).toBe(new Date(2026, 4, 11, 18, 0, 0).toISOString());
    expect(night.reminderAt).toBe(new Date(2026, 4, 12, 6, 0, 0).toISOString());
  });

  it('never parses explicit reminder time into the past', () => {
    const sameDayAfternoon = parseTodoQuickInput('洗澡 下午6点', new Date(2026, 4, 11, 19, 0, 0));
    const explicitToday = parseTodoQuickInput('洗澡 今天下午6点', new Date(2026, 4, 11, 19, 0, 0));
    const monthDayPastTime = parseTodoQuickInput('预约体检 5月9 下午6点', new Date(2026, 4, 9, 19, 0, 0));

    expect(sameDayAfternoon.reminderAt).toBe(new Date(2026, 4, 12, 18, 0, 0).toISOString());
    expect(explicitToday.reminderAt).toBe(new Date(2026, 4, 12, 18, 0, 0).toISOString());
    expect(monthDayPastTime.reminderAt).toBe(new Date(2026, 4, 10, 18, 0, 0).toISOString());
  });
});
