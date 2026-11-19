import type { ScheduleItem } from '../../types';
import { toLocalDateString } from '../date';
import { datePart, hasScheduleTime } from '../scheduleTime';

/**
 * 待办的唯一口径。
 *
 * 为什么单独抽出来：工作台卡片和待办页原来各写一套"过滤 + 排序 + 计数"，
 * 两边的数字经常不一致（改了排序没改卡片、卡片漏了 deletedAt 之类）。
 * 现在只有这一份，页面和卡片都从这里取。
 */

export const TODO_PRIORITY_ORDER: Record<ScheduleItem['priority'], number> = {
  high: 0,
  medium: 1,
  low: 2,
  green: 3,
};

export interface TodoCounts {
  pending: number;
  inProgress: number;
  completed: number;
  total: number;
}

export interface TodoProjection {
  today: string;
  /** 待办页的基础集合（type=todo 且未删除），保持 store 里的顺序 */
  todos: ScheduleItem[];
  /** 未完成（含 pending / in_progress），待办页"未完成"分组的来源 */
  active: ScheduleItem[];
  completed: ScheduleItem[];
  counts: TodoCounts;
  /** 按 dueAt 落在今天、且带时间的待办 */
  todayDue: ScheduleItem[];
  todayCounts: { done: number; total: number };
  overdue: ScheduleItem[];
  completionRate: number;
  /** 待办总数（= counts.total），卡片头部计数用 */
  total: number;
  /** 卡片用的优先级队列：未完成在前、按优先级排，未完成按创建时间兜底 */
  priorityQueue: ScheduleItem[];
}

export function splitTodoItems(items: Record<string, ScheduleItem>): ScheduleItem[] {
  return Object.values(items).filter((item) => item.type === 'todo' && !item.deletedAt);
}

export function buildTodoOrderIndex(itemOrder: string[]): Map<string, number> {
  return new Map(itemOrder.map((id, index) => [id, index]));
}

/**
 * 待办页与卡片共用的排序：未完成在前 → 拖拽顺序（itemOrder）→ 优先级。
 * 拖拽顺序是用户手动排的，必须优先于优先级，否则用户拖动完列表会"弹回去"。
 */
export function sortTodosByPriority(list: ScheduleItem[], orderIndex?: Map<string, number>): ScheduleItem[] {
  return [...list].sort((a, b) => {
    if (a.status === 'completed' && b.status !== 'completed') return 1;
    if (a.status !== 'completed' && b.status === 'completed') return -1;
    if (orderIndex) {
      const orderDiff =
        (orderIndex.get(a.id) ?? Number.POSITIVE_INFINITY) - (orderIndex.get(b.id) ?? Number.POSITIVE_INFINITY);
      if (orderDiff !== 0) return orderDiff;
    }
    const priorityA = TODO_PRIORITY_ORDER[a.priority] ?? TODO_PRIORITY_ORDER.green;
    const priorityB = TODO_PRIORITY_ORDER[b.priority] ?? TODO_PRIORITY_ORDER.green;
    if (priorityA !== priorityB) return priorityA - priorityB;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

export function isTodoDueToday(todo: ScheduleItem, today: string): boolean {
  return hasScheduleTime(todo) && datePart(todo.dueAt) === today;
}

export function selectTodoProjection(
  items: Record<string, ScheduleItem>,
  today: string = toLocalDateString(new Date()),
  itemOrder: string[] = [],
): TodoProjection {
  const todos = splitTodoItems(items);
  const active = todos.filter((todo) => todo.status !== 'completed');
  const completed = todos.filter((todo) => todo.status === 'completed');
  const todayDue = todos.filter((todo) => isTodoDueToday(todo, today));

  const counts: TodoCounts = {
    pending: todos.filter((todo) => todo.status === 'pending').length,
    inProgress: todos.filter((todo) => todo.status === 'in_progress').length,
    completed: completed.length,
    total: todos.length,
  };

  const overdue = active.filter(
    (todo) => hasScheduleTime(todo) && datePart(todo.dueAt) < today,
  );

  return {
    today,
    todos,
    active,
    completed,
    counts,
    todayDue,
    todayCounts: {
      done: todayDue.filter((todo) => todo.status === 'completed').length,
      total: todayDue.length,
    },
    overdue,
    completionRate: counts.total > 0 ? Math.round((counts.completed / counts.total) * 100) : 0,
    total: counts.total,
    priorityQueue: sortTodosByPriority(active, itemOrder.length > 0 ? buildTodoOrderIndex(itemOrder) : undefined),
  };
}
