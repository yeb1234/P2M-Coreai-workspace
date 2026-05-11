import { PRIORITY_COLORS, type CalendarEvent, type Todo } from '../types';
import { toLocalDateString } from '../lib/date';

export const TODO_DUE_MARKER = 'todo:due';
export const TODO_REMINDER_MARKER = 'todo:reminder';

export interface TodoCalendarEventData {
  title: string;
  date: string;
  startTime?: string;
  type: 'todo' | 'reminder';
  color: string;
  todoId: string;
  pomodoroSessionId: null;
  description: typeof TODO_DUE_MARKER | typeof TODO_REMINDER_MARKER;
}

export interface TodoCalendarSyncPlan {
  add: TodoCalendarEventData[];
  update: Array<{ id: string; data: TodoCalendarEventData }>;
  delete: string[];
}

function splitReminderDateTime(reminderAt: string): { date: string; time: string } {
  const date = new Date(reminderAt);
  return {
    date: toLocalDateString(date),
    time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
  };
}

function buildDueEventData(todo: Todo): TodoCalendarEventData | null {
  if (!todo.dueDate) return null;
  return {
    title: todo.title,
    date: todo.dueDate,
    type: 'todo',
    color: PRIORITY_COLORS[todo.priority],
    todoId: todo.id,
    pomodoroSessionId: null,
    description: TODO_DUE_MARKER,
  };
}

function buildReminderEventData(todo: Todo): TodoCalendarEventData | null {
  if (!todo.reminderAt) return null;
  const { date, time } = splitReminderDateTime(todo.reminderAt);
  return {
    title: `提醒：${todo.title}`,
    date,
    startTime: time,
    type: 'reminder',
    color: '#f59e0b',
    todoId: todo.id,
    pomodoroSessionId: null,
    description: TODO_REMINDER_MARKER,
  };
}

export function buildTodoCalendarSyncPlan(
  todos: Record<string, Todo>,
  calendarEvents: Record<string, CalendarEvent>,
): TodoCalendarSyncPlan {
  const plan: TodoCalendarSyncPlan = { add: [], update: [], delete: [] };
  const activeTodoIds = new Set(Object.keys(todos));
  const eventsByTodo = new Map<string, CalendarEvent[]>();

  Object.values(calendarEvents).forEach((event) => {
    if (!event.todoId) return;
    const events = eventsByTodo.get(event.todoId) ?? [];
    events.push(event);
    eventsByTodo.set(event.todoId, events);
  });

  Object.values(todos).forEach((todo) => {
    const existingEvents = eventsByTodo.get(todo.id) ?? [];
    const dueEvent = existingEvents.find((event) => event.description === TODO_DUE_MARKER);
    const reminderEvent = existingEvents.find((event) => event.description === TODO_REMINDER_MARKER);
    const dueData = buildDueEventData(todo);
    const reminderData = buildReminderEventData(todo);

    if (dueData && dueEvent) plan.update.push({ id: dueEvent.id, data: dueData });
    if (dueData && !dueEvent) plan.add.push(dueData);
    if (!dueData && dueEvent) plan.delete.push(dueEvent.id);

    if (reminderData && reminderEvent) plan.update.push({ id: reminderEvent.id, data: reminderData });
    if (reminderData && !reminderEvent) plan.add.push(reminderData);
    if (!reminderData && reminderEvent) plan.delete.push(reminderEvent.id);
  });

  Object.values(calendarEvents).forEach((event) => {
    if (!event.todoId || activeTodoIds.has(event.todoId)) return;
    if (event.description !== TODO_DUE_MARKER && event.description !== TODO_REMINDER_MARKER) return;
    plan.delete.push(event.id);
  });

  return plan;
}
