import { describe, it, expect, beforeEach } from 'vitest';
import { useTodoStore } from '../stores/todoStore';

describe('todoStore', () => {
  beforeEach(() => {
    useTodoStore.setState({
      todos: {},
      tags: {},
      todoOrder: [],
      trash: {},
      undoStack: [],
      redoStack: [],
      pendingTodoDate: null,
      pendingTodoPriority: null,
      filter: { priority: null, tags: [], status: 'all', searchQuery: '' },
    });
  });

  it('adds a todo', () => {
    const id = useTodoStore.getState().addTodo({ title: 'Test todo' });
    const todo = useTodoStore.getState().todos[id];
    expect(todo).toBeDefined();
    expect(todo.title).toBe('Test todo');
    expect(todo.status).toBe('pending');
  });

  it('deletes a todo and moves to trash', () => {
    const id = useTodoStore.getState().addTodo({ title: 'To delete' });
    useTodoStore.getState().deleteTodo(id);
    expect(useTodoStore.getState().todos[id]).toBeUndefined();
    expect(useTodoStore.getState().trash[id]).toBeDefined();
  });

  it('moves completed todos to trash', () => {
    const done = useTodoStore.getState().addTodo({ title: 'Done', status: 'completed' });
    const active = useTodoStore.getState().addTodo({ title: 'Active' });
    const moved = useTodoStore.getState().trashCompletedTodos();
    expect(moved).toBe(1);
    expect(useTodoStore.getState().todos[done]).toBeUndefined();
    expect(useTodoStore.getState().trash[done]).toBeDefined();
    expect(useTodoStore.getState().todos[active]).toBeDefined();
  });

  it('restores a todo from trash', () => {
    const id = useTodoStore.getState().addTodo({ title: 'To restore' });
    useTodoStore.getState().deleteTodo(id);
    useTodoStore.getState().restoreTodo(id);
    expect(useTodoStore.getState().todos[id]).toBeDefined();
    expect(useTodoStore.getState().trash[id]).toBeUndefined();
  });

  it('toggles todo status', () => {
    const id = useTodoStore.getState().addTodo({ title: 'Toggle me' });
    useTodoStore.getState().toggleTodoStatus(id);
    expect(useTodoStore.getState().todos[id].status).toBe('in_progress');
    useTodoStore.getState().toggleTodoStatus(id);
    expect(useTodoStore.getState().todos[id].status).toBe('completed');
    useTodoStore.getState().toggleTodoStatus(id);
    expect(useTodoStore.getState().todos[id].status).toBe('pending');
  });

  it('updates a todo', () => {
    const id = useTodoStore.getState().addTodo({ title: 'Original' });
    useTodoStore.getState().updateTodo(id, { title: 'Updated' });
    expect(useTodoStore.getState().todos[id].title).toBe('Updated');
  });

  it('undo create removes the todo', () => {
    const id = useTodoStore.getState().addTodo({ title: 'Undo me' });
    expect(useTodoStore.getState().todos[id]).toBeDefined();
    useTodoStore.getState().undo();
    expect(useTodoStore.getState().todos[id]).toBeUndefined();
  });

  it('redo create restores the todo', () => {
    const id = useTodoStore.getState().addTodo({ title: 'Redo me' });
    useTodoStore.getState().undo();
    useTodoStore.getState().redo();
    expect(useTodoStore.getState().todos[id]).toBeDefined();
  });

  it('limits undo stack to 50 entries', () => {
    for (let i = 0; i < 60; i++) {
      useTodoStore.getState().addTodo({ title: `Todo ${i}` });
    }
    expect(useTodoStore.getState().undoStack.length).toBeLessThanOrEqual(50);
  });

  it('getFilteredTodos returns all when no filter', () => {
    useTodoStore.getState().addTodo({ title: 'A' });
    useTodoStore.getState().addTodo({ title: 'B' });
    const filtered = useTodoStore.getState().getFilteredTodos();
    expect(filtered.length).toBe(2);
  });

  it('getFilteredTodos respects priority filter', () => {
    useTodoStore.getState().addTodo({ title: 'High', priority: 'high' });
    useTodoStore.getState().addTodo({ title: 'Low', priority: 'low' });
    useTodoStore.getState().setFilter({ priority: 'high' });
    const filtered = useTodoStore.getState().getFilteredTodos();
    expect(filtered.length).toBe(1);
    expect(filtered[0].title).toBe('High');
  });

  it('getTodosByDate returns todos for specific date', () => {
    useTodoStore.getState().addTodo({ title: 'Dated', dueDate: '2026-05-08' });
    useTodoStore.getState().addTodo({ title: 'Other', dueDate: '2026-05-09' });
    const result = useTodoStore.getState().getTodosByDate('2026-05-08');
    expect(result.length).toBe(1);
    expect(result[0].title).toBe('Dated');
  });
});
