import type {
  ID,
  PomodoroConfig,
  PomodoroSession,
  PomodoroTimerState,
  ScheduleItem,
} from '../../types';
import { toLocalDateString } from '../date';
import { calculateSchedulePomodoroRounds } from '../pomodoroPlanning';
import { selectTodoProjection } from './todo';

/**
 * 番茄钟卡片的唯一派生口径。
 *
 * 为什么单独抽出来：工作台番茄卡片原来自己重算了一遍「今日待办 dueAt 过滤 +
 * 番茄轮次合计」，和待办页 / 番茄页的口径各走一套；首发视图还会随机跳转。
 * 现在番茄数、专注时长直接吃 store 的 getTodayStats() 结果（与
 * PomodoroStats 页同源，session 过滤只在 pomodoroStore.getTodayStats 一处），
 * 今日待办复用 selectTodoProjection，卡片这边不再写第二份过滤/算数代码。
 */

export interface PomodoroTodayStats {
  totalPomodoros: number;
  totalMinutes: number;
}

export interface PomodoroProjectionInput {
  /** getTodayStats() 的返回结果，今日番茄数 / 专注时长直接用，不在此二次过滤 sessions */
  todayStats: PomodoroTodayStats;
  /** 订阅用的 sessions 原始切片；保留入参只是为了和 store slice 对齐，投影内不做过滤 */
  sessions: Record<ID, PomodoroSession>;
  /** scheduleStore.items 原始切片 */
  items: Record<string, ScheduleItem>;
  /** pomodoroStore.config，提供 dailyGoal 兜底与轮次计算参数 */
  config: PomodoroConfig;
  /** pomodoroStore.timer，判断是否在运行 */
  timer: PomodoroTimerState;
  /** 可注入的今天日期（YYYY-MM-DD），测试固定日期用 */
  today?: string;
}

export interface PomodoroProjection {
  today: string;
  /** 今日番茄数，来自 getTodayStats() */
  totalPomodoros: number;
  /** 今日专注分钟，来自 getTodayStats() */
  totalMinutes: number;
  /** 今天到期（dueAt 落在今天、带时间）的待办，含已完成；来自 selectTodoProjection */
  todayDue: ScheduleItem[];
  todayDone: number;
  todayTotal: number;
  todayInProgress: number;
  /** 今日待办排出来的番茄轮次合计；无今日待办目标时回落到 config.dailyGoal */
  goalRounds: number;
  /** 是否有今日待办目标（有待办排期出轮次）；没有时进度条不展示 */
  hasTodoGoal: boolean;
  /** 进度百分比（0–100），以目标轮次为分母 */
  progress: number;
  isRunning: boolean;
}

export function selectPomodoroProjection(input: PomodoroProjectionInput): PomodoroProjection {
  const today = input.today ?? toLocalDateString(new Date());
  const { todayStats, items, config, timer } = input;

  // 今日待办的过滤 / 计数全部走 selectTodoProjection，这里不再写 dueAt 过滤
  const todoProjection = selectTodoProjection(items, today);
  const { todayDue, todayCounts } = todoProjection;

  // 今日待办目标口径与待办页工具栏一致：未完成的今日待办，逐条算轮次后合计
  const activeTodayDue = todayDue.filter((todo) => todo.status !== 'completed');
  const plannedRounds = activeTodayDue.reduce(
    (sum, todo) => sum + calculateSchedulePomodoroRounds(todo, config),
    0,
  );
  const hasTodoGoal = plannedRounds > 0;
  const goalRounds = hasTodoGoal ? plannedRounds : config.dailyGoal;
  const progress = hasTodoGoal
    ? Math.min((todayStats.totalPomodoros / goalRounds) * 100, 100)
    : 0;

  return {
    today,
    totalPomodoros: todayStats.totalPomodoros,
    totalMinutes: todayStats.totalMinutes,
    todayDue,
    todayDone: todayCounts.done,
    todayTotal: todayCounts.total,
    todayInProgress: todayDue.filter((todo) => todo.status === 'in_progress').length,
    goalRounds,
    hasTodoGoal,
    progress,
    isRunning: timer.status === 'running',
  };
}
