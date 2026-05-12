import type { TodoPriority } from '../types';

export interface ParsedTodoQuickInput {
  title: string;
  priority?: TodoPriority;
  dueDate?: string;
  reminderAt?: string;
  pomodoroRounds?: number;
}

const PRIORITY_SHORTCUTS: Record<string, TodoPriority> = {
  '/g': 'green',
  '/p': 'high',
  '/y': 'medium',
  '/b': 'low',
};

const DATE_OFFSET: Record<string, number> = {
  今天: 0,
  明天: 1,
  后天: 2,
};

export function formatLocalDateTimeInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function getDefaultReminderInputValue(nowDate = new Date()): string {
  const next = new Date(nowDate.getTime() + 30 * 60 * 1000);
  const minutes = next.getMinutes();
  const remainder = minutes % 30;
  if (remainder !== 0) {
    next.setMinutes(minutes + (30 - remainder));
  }
  next.setSeconds(0, 0);
  return formatLocalDateTimeInput(next);
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeHour(hour: number, meridiem?: string): number {
  if (meridiem === '下午' || meridiem === '晚上' || meridiem === '夜里') {
    return hour < 12 ? hour + 12 : hour;
  }
  if (meridiem === '中午') {
    return hour < 11 ? hour + 12 : hour;
  }
  if (meridiem === '凌晨' && hour === 12) return 0;
  return hour;
}

function buildDate(baseDate: Date, offset: number, hour: number, minute: number): Date {
  const date = new Date(baseDate);
  date.setDate(date.getDate() + offset);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function buildMonthDayDate(baseDate: Date, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(baseDate);
  date.setMonth(month - 1, day);
  date.setHours(0, 0, 0, 0);
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  if (date.getTime() < new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate()).getTime()) {
    date.setFullYear(date.getFullYear() + 1);
  }
  return date;
}

function buildNextAmbiguousTime(baseDate: Date, rawHour: number, minute: number): Date | null {
  if (rawHour < 0 || rawHour > 23 || minute < 0 || minute > 59) return null;
  const candidates = [rawHour];
  if (rawHour >= 1 && rawHour <= 11) candidates.push(rawHour + 12);

  for (const hour of candidates) {
    const candidate = buildDate(baseDate, 0, hour, minute);
    if (candidate.getTime() > baseDate.getTime()) return candidate;
  }

  return buildDate(baseDate, 1, candidates[0], minute);
}

function moveReminderToFuture(reminderDate: Date, baseDate: Date, allowSameDayAlternative: boolean): Date {
  if (reminderDate.getTime() > baseDate.getTime()) return reminderDate;
  if (allowSameDayAlternative) {
    const afternoonDate = new Date(reminderDate);
    const hour = afternoonDate.getHours();
    if (hour >= 1 && hour <= 11) {
      afternoonDate.setHours(hour + 12);
      if (afternoonDate.getTime() > baseDate.getTime()) return afternoonDate;
    }
  }
  const next = new Date(reminderDate);
  next.setDate(next.getDate() + 1);
  return next;
}

export function parseTodoQuickInput(input: string, nowDate = new Date()): ParsedTodoQuickInput {
  let title = input.trim();
  const result: ParsedTodoQuickInput = { title };

  for (const [shortcut, priority] of Object.entries(PRIORITY_SHORTCUTS)) {
    const pattern = new RegExp(`(?:^|\\s)${shortcut.replace('/', '\\/')}(?=\\s|$)`);
    if (pattern.test(title)) {
      result.priority = priority;
      title = title.replace(pattern, ' ').trim();
      break;
    }
  }

  const pomodoroMatch = title.match(/(?:^|\s)\/t([1-9]\d*)(?=\s|$)/i);
  if (pomodoroMatch) {
    result.pomodoroRounds = Number.parseInt(pomodoroMatch[1], 10);
    title = title.replace(pomodoroMatch[0], ' ').trim();
  }

  const monthDayPattern = /(?:^|\s)(?:(\d{4})年)?(\d{1,2})月(\d{1,2})(?:日|号)?(?:\s|$)/;
  const monthDayMatch = title.match(monthDayPattern);
  let explicitMonthDay: Date | null = null;
  if (monthDayMatch) {
    const [, yearText, monthText, dayText] = monthDayMatch;
    explicitMonthDay = buildMonthDayDate(nowDate, Number.parseInt(monthText, 10), Number.parseInt(dayText, 10));
    if (explicitMonthDay && yearText) {
      explicitMonthDay.setFullYear(Number.parseInt(yearText, 10));
    }
    if (explicitMonthDay) {
      result.dueDate = formatLocalDate(explicitMonthDay);
      title = title.replace(monthDayMatch[0], ' ').trim();
    }
  }

  const timePattern = /(?:^|\s)(?:(今天|明天|后天)\s*)?(凌晨|早上|上午|中午|下午|晚上|夜里)?\s*(\d{1,2})(?:(?:[:：](\d{1,2})|点(?:(半)|(\d{1,2})分?)?)(?=\s|$|[\u4e00-\u9fff])|(?=\s|$))/;
  const timeMatch = title.match(timePattern);
  if (timeMatch) {
    const [, dateWord, meridiem, hourText, colonMinuteText, halfMinuteText, pointMinuteText] = timeMatch;
    const rawHour = Number.parseInt(hourText, 10);
    const rawMinute = halfMinuteText === '半'
      ? 30
      : colonMinuteText
      ? Number.parseInt(colonMinuteText, 10)
      : pointMinuteText
      ? Number.parseInt(pointMinuteText.replace('分', ''), 10)
      : 0;
    const hour = normalizeHour(rawHour, meridiem);
    if (hour >= 0 && hour <= 23 && rawMinute >= 0 && rawMinute <= 59) {
      let reminderDate: Date | null = null;
      if (explicitMonthDay) {
        reminderDate = new Date(explicitMonthDay);
        reminderDate.setHours(hour, rawMinute, 0, 0);
      } else if (!dateWord && !meridiem) {
        reminderDate = buildNextAmbiguousTime(nowDate, rawHour, rawMinute);
      } else {
        reminderDate = buildDate(nowDate, DATE_OFFSET[dateWord || '今天'] ?? 0, hour, rawMinute);
      }
      if (!reminderDate) return result;
      reminderDate = moveReminderToFuture(reminderDate, nowDate, !dateWord && !meridiem);
      result.dueDate = formatLocalDate(reminderDate);
      result.reminderAt = reminderDate.toISOString();
      title = title.replace(timeMatch[0], ' ').trim();
    }
  } else {
    const dateMatch = title.match(/(?:^|\s)(今天|明天|后天)(?:\s|$)/);
    if (dateMatch) {
      const due = new Date(nowDate);
      due.setDate(due.getDate() + DATE_OFFSET[dateMatch[1]]);
      result.dueDate = formatLocalDate(due);
      title = title.replace(dateMatch[0], ' ').trim();
    }
  }

  result.title = title.replace(/\s+/g, ' ').trim();
  return result;
}
