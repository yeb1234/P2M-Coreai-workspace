import type { CalendarEvent, ScheduleItem } from '../../types';
import { toLocalDateString } from '../date';
import { selectTodoProjection } from './todo';
import { getScheduleItemsForDate } from './calendar';

/**
 * 「今日概览」卡片的唯一派生口径。
 *
 * 原来卡片在 useMemo 里自己重算了四项数字：待办用 startAt 当天过滤（待办排期在
 * dueAt，基本恒为 0/N）、番茄自己又过滤了一遍 sessions、事件只数 schedule items
 * 且不看日历。现在四项全部在这里写死口径，卡片和数据中心页（StatsPage）共用同一份。
 */

export interface QuickStatsProjectionInput {
  /** scheduleStore.items 原始切片 */
  items: Record<string, ScheduleItem>;
  /** getTodayStats() 的返回结果，番茄数直接用 */
  todayStats: { totalPomodoros: number; totalMinutes: number };
  /** notesStore.notes 原始数组 */
  notes: { id: string }[];
  /**
   * calendarStore.events 原始切片。
   * 保留入参用于兼容旧测试；「今日事件」与「日程管理」徽章都已改读
   * schedule_items，日视图真正渲染的也是 schedule items。
   */
  calendarEvents: Record<string, CalendarEvent>;
  /** 可注入的今天日期（YYYY-MM-DD），测试固定日期用 */
  today?: string;
}

export interface QuickStatsProjection {
  today: string;
  /** 今日已完成待办（done/total），来自 selectTodoProjection 的今日待办计数 */
  todayDone: number;
  todayTotal: number;
  /** 今日番茄数，来自 getTodayStats()，与番茄统计页同源 */
  pomodoros: number;
  /** 笔记总数，与笔记页 / 数据中心笔记行同源 */
  notesCount: number;
  /** 今天开始（startAt 落在今天）的日程条目数，含 event 类型、不含已删除 */
  eventsCount: number;
}

export function selectQuickStatsProjection(
  input: QuickStatsProjectionInput,
): QuickStatsProjection {
  const today = input.today ?? toLocalDateString(new Date());
  const { items, todayStats, notes } = input;

  // 口径：今日完成 = 今天到期的待办中已完成 / 总数。
  // 对应待办页（TodoList）与数据中心页待办计数：基础集合是 type==='todo' 且未删除，
  // 今日判定走 dueAt，复用 selectTodoProjection，不在此另写 dueAt 过滤。
  const todoProjection = selectTodoProjection(items, today);

  // 口径：今日事件 = startAt 落在今天的 schedule items 条数（含 event 类型）。
  // 复用日历投影的 getScheduleItemsForDate，与日历日视图 CalendarPage 同一份过滤：
  // !deletedAt && hasScheduleTime && datePart(startAt) === date，todo 和 event 都算。
  const eventsCount = getScheduleItemsForDate(items, today).length;

  return {
    today,
    todayDone: todoProjection.todayCounts.done,
    todayTotal: todoProjection.todayCounts.total,
    pomodoros: todayStats.totalPomodoros,
    notesCount: notes.length,
    eventsCount,
  };
}
