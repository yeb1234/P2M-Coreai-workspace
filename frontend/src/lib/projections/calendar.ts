import type { ScheduleItem } from '../../types';
import { toLocalDateString } from '../date';
import {
  getItemsForCalendarDates,
  getItemsForCalendarMonth,
  getScheduleItemsForDate,
  groupScheduleItemsByDate,
} from '../../components/calendar/calendarDerivedData';

/**
 * 日历看板的唯一派生口径。
 *
 * 取数实现留在 calendarDerivedData（日历页月/周/日视图本来就在用它，
 * 也是回归契约测试盯着的地方），这里不复制一份，只做转出 + 卡片投影。
 * 卡片和日历页因此读的是同一段过滤：未删除 + 带起止时间 + startAt 落在那天。
 */
export { getItemsForCalendarDates, getItemsForCalendarMonth, getScheduleItemsForDate, groupScheduleItemsByDate };

/** 卡片首屏展示的条目数；超出部分走"还有 N 项"入口。 */
export const CALENDAR_CARD_LIMIT = 2;

export interface CalendarProjection {
  today: string;
  /** 今天的全部条目，按开始时间升序（与卡片展示顺序一致） */
  items: ScheduleItem[];
  /** 卡片首屏展示的前 N 条 */
  display: ScheduleItem[];
  /** 今天条目总数 */
  total: number;
  /** 超出首屏的条目数（"还有 N 项"里的 N） */
  overflow: number;
}

export function selectCalendarProjection(
  items: Record<string, ScheduleItem>,
  today: string = toLocalDateString(new Date()),
): CalendarProjection {
  const todayItems = getScheduleItemsForDate(items, today).sort(
    (a, b) => new Date(a.startAt ?? 0).getTime() - new Date(b.startAt ?? 0).getTime(),
  );

  return {
    today,
    items: todayItems,
    display: todayItems.slice(0, CALENDAR_CARD_LIMIT),
    total: todayItems.length,
    overflow: Math.max(0, todayItems.length - CALENDAR_CARD_LIMIT),
  };
}
