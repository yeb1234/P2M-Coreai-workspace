import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isToday,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  parseISO,
} from 'date-fns';
import { zhCN } from 'date-fns/locale';
import type { ISODateString } from '../types';

export const formatDate = (date: Date | string, formatStr: string): string => {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, formatStr, { locale: zhCN });
};

export const toISODateString = (date: Date): ISODateString => {
  return format(date, 'yyyy-MM-dd');
};

export const toISODateTimeString = (date: Date): string => {
  const d = date;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
};

/** Get local date string (YYYY-MM-DD) from a Date or ISO string */
export const toLocalDateString = (date: Date | string): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const getMonthDays = (date: Date): Date[] => {
  const start = startOfWeek(startOfMonth(date), { weekStartsOn: 0 });
  const end = endOfWeek(endOfMonth(date), { weekStartsOn: 0 });
  return eachDayOfInterval({ start, end });
};

export const getWeekDays = (date: Date): Date[] => {
  const start = startOfWeek(date, { weekStartsOn: 0 });
  const end = endOfWeek(date, { weekStartsOn: 0 });
  return eachDayOfInterval({ start, end });
};

export const isCurrentMonth = (date: Date, referenceDate: Date): boolean => {
  return isSameMonth(date, referenceDate);
};

export const isTodayCheck = (date: Date | string): boolean => {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return isToday(d);
};

export const getNextMonth = (date: Date): Date => addMonths(date, 1);
export const getPrevMonth = (date: Date): Date => subMonths(date, 1);
export const getNextWeek = (date: Date): Date => addWeeks(date, 1);
export const getPrevWeek = (date: Date): Date => subWeeks(date, 1);

export const getWeekDayNames = (): string[] => {
  return ['日', '一', '二', '三', '四', '五', '六'];
};

export const formatDuration = (minutes: number): string => {
  if (minutes < 60) return `${minutes}分钟`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}小时${mins}分钟` : `${hours}小时`;
};

export const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};
