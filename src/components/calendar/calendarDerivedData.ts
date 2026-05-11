import type { CalendarEvent, Todo } from '../../types';
import { toLocalDateString } from '../../lib/date';

export interface CompletedTodoLookup {
  ids: Set<string>;
  titles: Set<string>;
}

export function createCompletedTodoLookup(todos: Record<string, Todo>): CompletedTodoLookup {
  const ids = new Set<string>();
  const titles = new Set<string>();

  Object.values(todos).forEach((todo) => {
    if (todo.status !== 'completed') return;
    ids.add(todo.id);
    titles.add(todo.title);
  });

  return { ids, titles };
}

export function shouldShowCalendarEvent(event: CalendarEvent, completedTodoLookup: CompletedTodoLookup): boolean {
  if (event.type !== 'todo') return true;
  if (event.todoId && completedTodoLookup.ids.has(event.todoId)) return false;
  if (!event.todoId && completedTodoLookup.titles.has(event.title)) return false;
  return true;
}

export function groupCalendarEventsByDate(
  events: CalendarEvent[],
  completedTodoLookup: CompletedTodoLookup,
): Record<string, CalendarEvent[]> {
  const byDate: Record<string, CalendarEvent[]> = {};

  events.forEach((event) => {
    if (event.type === 'pomodoro') return;
    if (!shouldShowCalendarEvent(event, completedTodoLookup)) return;
    if (!byDate[event.date]) byDate[event.date] = [];
    byDate[event.date].push(event);
  });

  return byDate;
}

export function getEventsForCalendarMonth(
  events: Record<string, CalendarEvent>,
  year: number,
  month: number,
): CalendarEvent[] {
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  return Object.values(events).filter((event) => event.date.startsWith(monthPrefix));
}

export function getPomodoroHeatMapForMonth(
  events: Record<string, CalendarEvent>,
  year: number,
  month: number,
): Record<string, number> {
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const heatMap: Record<string, number> = {};

  Object.values(events).forEach((event) => {
    if (event.type !== 'pomodoro' || !event.date.startsWith(monthPrefix)) return;
    heatMap[event.date] = (heatMap[event.date] || 0) + 1;
  });

  return heatMap;
}

export function getEventsForCalendarDates(
  events: Record<string, CalendarEvent>,
  dates: string[],
  completedTodoLookup: CompletedTodoLookup,
): Record<string, CalendarEvent[]> {
  const dateSet = new Set(dates);
  const byDate: Record<string, CalendarEvent[]> = {};

  Object.values(events).forEach((event) => {
    if (!dateSet.has(event.date)) return;
    if (!shouldShowCalendarEvent(event, completedTodoLookup)) return;
    if (!byDate[event.date]) byDate[event.date] = [];
    byDate[event.date].push(event);
  });

  return byDate;
}

export function getEventsForCalendarDate(
  events: Record<string, CalendarEvent>,
  date: string,
  completedTodoLookup: CompletedTodoLookup,
): CalendarEvent[] {
  return Object.values(events).filter(
    (event) => event.date === date && shouldShowCalendarEvent(event, completedTodoLookup),
  );
}

export function groupTodosByCalendarDate(todos: Record<string, Todo>) {
  const pendingByDate: Record<string, Todo[]> = {};
  const completedByDate: Record<string, Todo[]> = {};

  Object.values(todos).forEach((todo) => {
    if (todo.status === 'completed') {
      const date = todo.dueDate ?? (todo.completedAt ? toLocalDateString(todo.completedAt) : null);
      if (!date) return;
      if (!completedByDate[date]) completedByDate[date] = [];
      completedByDate[date].push(todo);
      return;
    }

    if (!todo.dueDate) return;
    if (!pendingByDate[todo.dueDate]) pendingByDate[todo.dueDate] = [];
    pendingByDate[todo.dueDate].push(todo);
  });

  Object.values(completedByDate).forEach((items) => {
    items.sort((a, b) => {
      const aTime = new Date(a.completedAt ?? a.updatedAt ?? a.createdAt).getTime();
      const bTime = new Date(b.completedAt ?? b.updatedAt ?? b.createdAt).getTime();
      return bTime - aTime;
    });
  });

  return { pendingByDate, completedByDate };
}
