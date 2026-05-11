import { describe, expect, it } from 'vitest';
import { buildTodoCalendarSyncPlan, TODO_DUE_MARKER, TODO_REMINDER_MARKER } from '../hooks/todoCalendarSyncPlan';
import type { CalendarEvent, Todo } from '../types';

function makeTodo(patch: Partial<Todo> = {}): Todo {
  return {
    id: 'todo-1',
    title: '写文档',
    description: '',
    priority: 'medium',
    tags: [],
    dueDate: null,
    reminderAt: null,
    status: 'pending',
    pomodoroCount: 0,
    pomodoroRounds: 0,
    totalFocusMinutes: 0,
    createdAt: '2026-05-11T08:00:00.000Z',
    updatedAt: '2026-05-11T08:00:00.000Z',
    calendarEventId: null,
    ...patch,
  };
}

function makeEvent(patch: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'event-1',
    title: '旧标题',
    date: '2026-05-10',
    type: 'todo',
    color: '#e8d4a0',
    todoId: 'todo-1',
    pomodoroSessionId: null,
    description: TODO_DUE_MARKER,
    createdAt: '2026-05-10T08:00:00.000Z',
    ...patch,
  };
}

describe('todo calendar sync plan', () => {
  it('adds due and reminder events for a todo', () => {
    const todo = makeTodo({
      dueDate: '2026-05-12',
      reminderAt: '2026-05-12T09:30:00.000Z',
    });
    const plan = buildTodoCalendarSyncPlan({ [todo.id]: todo }, {});

    expect(plan.add).toHaveLength(2);
    expect(plan.add.map((event) => event.description)).toEqual([TODO_DUE_MARKER, TODO_REMINDER_MARKER]);
    expect(plan.update).toHaveLength(0);
    expect(plan.delete).toHaveLength(0);
  });

  it('updates existing mapped calendar events', () => {
    const todo = makeTodo({ title: '更新后的待办', dueDate: '2026-05-13' });
    const event = makeEvent();
    const plan = buildTodoCalendarSyncPlan({ [todo.id]: todo }, { [event.id]: event });

    expect(plan.add).toHaveLength(0);
    expect(plan.update).toEqual([
      expect.objectContaining({
        id: event.id,
        data: expect.objectContaining({ title: '更新后的待办', date: '2026-05-13' }),
      }),
    ]);
  });

  it('removes stale todo calendar events', () => {
    const dueEvent = makeEvent();
    const reminderEvent = makeEvent({ id: 'event-2', description: TODO_REMINDER_MARKER, type: 'reminder' });
    const plan = buildTodoCalendarSyncPlan({}, { [dueEvent.id]: dueEvent, [reminderEvent.id]: reminderEvent });

    expect(plan.delete).toEqual(['event-1', 'event-2']);
  });
});
