import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { idbStorage } from '../lib/idbStorage';
import type { Todo, TodoTag, TodoPriority, TodoStatus, ID, ISODateString } from '../types';
import { generateId } from '../lib/id';
import { toISODateTimeString } from '../lib/date';

interface TodoFilter {
  priority: TodoPriority | null;
  tags: ID[];
  status: TodoStatus | 'all';
  searchQuery: string;
}

interface TrashedTodo {
  todo: Todo;
  deletedAt: string;
}

type UndoAction =
  | { type: 'create'; id: ID }
  | { type: 'delete'; todo: Todo; orderIndex: number }
  | { type: 'restore'; id: ID };

interface TodoState {
  todos: Record<ID, Todo>;
  tags: Record<ID, TodoTag>;
  todoOrder: ID[];
  trash: Record<ID, TrashedTodo>;
  undoStack: UndoAction[];
  redoStack: UndoAction[];
  filter: TodoFilter;
  addTodo: (data: Partial<Todo> & { title: string }) => ID;
  updateTodo: (id: ID, updates: Partial<Todo>) => void;
  deleteTodo: (id: ID) => void;
  trashCompletedTodos: (ids?: ID[]) => number;
  restoreTodo: (id: ID) => void;
  permanentDeleteTodo: (id: ID) => void;
  clearTrash: () => void;
  undo: () => void;
  redo: () => void;
  toggleTodoStatus: (id: ID) => void;
  addTag: (data: Omit<TodoTag, 'id'>) => ID;
  removeTag: (id: ID) => void;
  setFilter: (filter: Partial<TodoFilter>) => void;
  incrementPomodoroCount: (todoId: ID, focusMinutes: number) => void;
  reorderTodos: (fromId: ID, toId: ID) => void;
  clearAllTodos: () => void;
  getFilteredTodos: () => Todo[];
  getTodoById: (id: ID) => Todo | undefined;
  getTodosByDate: (date: ISODateString) => Todo[];
  getTrashedTodos: () => TrashedTodo[];
  pendingTodoDate: ISODateString | null;
  pendingTodoPriority: TodoPriority | null;
  setPendingTodoDate: (date: ISODateString | null) => void;
  setPendingTodoPriority: (priority: TodoPriority | null) => void;
}

const now = () => toISODateTimeString(new Date());

export const useTodoStore = create<TodoState>()(
  persist(
    (set, get) => ({
      todos: {},
      tags: {},
      todoOrder: [],
      trash: {},
      undoStack: [],
      redoStack: [],
      pendingTodoDate: null,
      pendingTodoPriority: null,
      filter: {
        priority: null,
        tags: [],
        status: 'all',
        searchQuery: '',
      },

      addTodo: (data) => {
        const id = generateId();
        const timestamp = now();
        const todo: Todo = {
          id,
          title: data.title,
          description: data.description || '',
          priority: data.priority || 'medium',
          tags: data.tags || [],
          dueDate: data.dueDate || null,
          startDate: data.startDate || null,
          startTime: data.startTime || null,
          endTime: data.endTime || null,
          reminderAt: data.reminderAt || null,
          status: data.status || 'pending',
          pomodoroCount: data.pomodoroCount || 0,
          pomodoroRounds: data.pomodoroRounds || 0,
          totalFocusMinutes: data.totalFocusMinutes || 0,
          createdAt: timestamp,
          updatedAt: timestamp,
          completedAt: data.status === 'completed' ? timestamp : null,
          calendarEventId: data.calendarEventId || null,
        };
        set((state) => ({
          todos: { ...state.todos, [id]: todo },
          todoOrder: [...state.todoOrder, id],
          undoStack: [...state.undoStack, { type: 'create' as const, id }].slice(-50),
          redoStack: [],
        }));
        return id;
      },

      updateTodo: (id, updates) => {
        set((state) => {
          const todo = state.todos[id];
          if (!todo) return state;
          const timestamp = now();
          const nextStatus = updates.status ?? todo.status;
          const completedAt = nextStatus === 'completed'
            ? (todo.status === 'completed' ? todo.completedAt ?? timestamp : timestamp)
            : null;
          return {
            todos: {
              ...state.todos,
              [id]: { ...todo, ...updates, completedAt, updatedAt: timestamp },
            },
          };
        });
      },

      deleteTodo: (id) => {
        set((state) => {
          const todo = state.todos[id];
          if (!todo) return state;
          const todos = { ...state.todos };
          delete todos[id];
          const orderIndex = state.todoOrder.indexOf(id);
          return {
            todos,
            todoOrder: state.todoOrder.filter((oid) => oid !== id),
            trash: { ...state.trash, [id]: { todo, deletedAt: now() } },
            undoStack: [...state.undoStack, { type: 'delete' as const, todo, orderIndex }].slice(-50),
            redoStack: [],
          };
        });
      },

      trashCompletedTodos: (ids) => {
        const targetIds = new Set(ids);
        let moved = 0;
        set((state) => {
          const timestamp = now();
          const todos = { ...state.todos };
          const trash = { ...state.trash };
          const movedIds: ID[] = [];
          for (const todo of Object.values(state.todos)) {
            if (todo.status !== 'completed') continue;
            if (ids && !targetIds.has(todo.id)) continue;
            delete todos[todo.id];
            trash[todo.id] = { todo, deletedAt: timestamp };
            movedIds.push(todo.id);
          }
          moved = movedIds.length;
          if (movedIds.length === 0) return state;
          const movedSet = new Set(movedIds);
          return {
            todos,
            trash,
            todoOrder: state.todoOrder.filter((id) => !movedSet.has(id)),
          };
        });
        return moved;
      },

      restoreTodo: (id) => {
        set((state) => {
          const trashed = state.trash[id];
          if (!trashed) return state;
          const trash = { ...state.trash };
          delete trash[id];
          return {
            todos: { ...state.todos, [id]: trashed.todo },
            todoOrder: [...state.todoOrder, id],
            trash,
            undoStack: [...state.undoStack, { type: 'restore' as const, id }].slice(-50),
            redoStack: [],
          };
        });
      },

      permanentDeleteTodo: (id) => {
        set((state) => {
          const trash = { ...state.trash };
          delete trash[id];
          return { trash };
        });
      },

      clearTrash: () => {
        set({ trash: {} });
      },

      undo: () => {
        const state = get();
        const action = state.undoStack[state.undoStack.length - 1];
        if (!action) return;
        const undoStack = state.undoStack.slice(0, -1);
        const pushRedo = { undoStack, redoStack: [...state.redoStack, action] };
        if (action.type === 'create') {
          const todo = state.todos[action.id];
          if (!todo) return;
          const todos = { ...state.todos };
          delete todos[action.id];
          set({
            ...pushRedo,
            todos,
            todoOrder: state.todoOrder.filter((oid) => oid !== action.id),
            trash: { ...state.trash, [action.id]: { todo, deletedAt: now() } },
          });
        } else if (action.type === 'delete') {
          const { todo } = action;
          const todoOrder = [...state.todoOrder];
          todoOrder.splice(action.orderIndex, 0, todo.id);
          const trash = { ...state.trash };
          delete trash[todo.id];
          set({
            ...pushRedo,
            todos: { ...state.todos, [todo.id]: todo },
            todoOrder,
            trash,
          });
        } else if (action.type === 'restore') {
          const todo = state.todos[action.id];
          if (!todo) return;
          const todos = { ...state.todos };
          delete todos[action.id];
          set({
            ...pushRedo,
            todos,
            todoOrder: state.todoOrder.filter((oid) => oid !== action.id),
            trash: { ...state.trash, [action.id]: { todo, deletedAt: now() } },
          });
        }
      },

      redo: () => {
        const state = get();
        const action = state.redoStack[state.redoStack.length - 1];
        if (!action) return;
        const redoStack = state.redoStack.slice(0, -1);
        const pushUndo = { undoStack: [...state.undoStack, action], redoStack };
        if (action.type === 'create') {
          const trashed = state.trash[action.id];
          if (!trashed) return;
          const trash = { ...state.trash };
          delete trash[action.id];
          set({
            ...pushUndo,
            todos: { ...state.todos, [action.id]: trashed.todo },
            todoOrder: [...state.todoOrder, action.id],
            trash,
          });
        } else if (action.type === 'delete') {
          const { todo } = action;
          const todos = { ...state.todos };
          delete todos[todo.id];
          set({
            ...pushUndo,
            todos,
            todoOrder: state.todoOrder.filter((oid) => oid !== todo.id),
            trash: { ...state.trash, [todo.id]: { todo, deletedAt: now() } },
          });
        } else if (action.type === 'restore') {
          const trashed = state.trash[action.id];
          if (!trashed) return;
          const trash = { ...state.trash };
          delete trash[action.id];
          set({
            ...pushUndo,
            todos: { ...state.todos, [action.id]: trashed.todo },
            todoOrder: [...state.todoOrder, action.id],
            trash,
          });
        }
      },

      toggleTodoStatus: (id) => {
        set((state) => {
          const todo = state.todos[id];
          if (!todo) return state;
          const statusMap: Record<TodoStatus, TodoStatus> = {
            pending: 'in_progress',
            in_progress: 'completed',
            completed: 'pending',
          };
          const nextStatus = statusMap[todo.status];
          const timestamp = now();
          return {
            todos: {
              ...state.todos,
              [id]: {
                ...todo,
                status: nextStatus,
                completedAt: nextStatus === 'completed' ? timestamp : null,
                updatedAt: timestamp,
              },
            },
          };
        });
      },

      addTag: (data) => {
        const id = generateId();
        const tag: TodoTag = { id, ...data };
        set((state) => ({
          tags: { ...state.tags, [id]: tag },
        }));
        return id;
      },

      removeTag: (id) => {
        set((state) => {
          const tags = { ...state.tags };
          delete tags[id];
          return { tags };
        });
      },

      setFilter: (filter) => {
        set((state) => ({
          filter: { ...state.filter, ...filter },
        }));
      },

      setPendingTodoDate: (date) => {
        set({ pendingTodoDate: date });
      },

      setPendingTodoPriority: (priority) => {
        set({ pendingTodoPriority: priority });
      },

      incrementPomodoroCount: (todoId, focusMinutes) => {
        set((state) => {
          const todo = state.todos[todoId];
          if (!todo) return state;
          const nextCount = todo.pomodoroCount + 1;
          const targetCount = Math.max(0, todo.pomodoroRounds || 0);
          const reachedTarget = targetCount > 0 && nextCount >= targetCount;
          const timestamp = now();
          return {
            todos: {
              ...state.todos,
              [todoId]: {
                ...todo,
                pomodoroCount: nextCount,
                totalFocusMinutes: todo.totalFocusMinutes + focusMinutes,
                status: reachedTarget ? 'completed' : 'in_progress',
                completedAt: reachedTarget ? (todo.completedAt ?? timestamp) : null,
                updatedAt: timestamp,
              },
            },
          };
        });
      },

      reorderTodos: (fromId, toId) => {
        set((state) => {
          const order = [...state.todoOrder];
          const fromIdx = order.indexOf(fromId);
          const toIdx = order.indexOf(toId);
          if (fromIdx === -1 || toIdx === -1) return state;
          order.splice(fromIdx, 1);
          order.splice(toIdx, 0, fromId);
          return { todoOrder: order };
        });
      },

      clearAllTodos: () => {
        set({ todos: {}, todoOrder: [] });
      },

      getFilteredTodos: () => {
        const state = get();
        const todos = Object.values(state.todos);
        const { filter, todoOrder } = state;

        const filtered = todos.filter((todo) => {
          if (filter.priority && todo.priority !== filter.priority) return false;
          if (filter.status !== 'all' && todo.status !== filter.status) return false;
          if (filter.tags.length > 0 && !filter.tags.some((t) => todo.tags.includes(t))) return false;
          if (filter.searchQuery) {
            const query = filter.searchQuery.toLowerCase();
            return (
              todo.title.toLowerCase().includes(query) ||
              todo.description.toLowerCase().includes(query)
            );
          }
          return true;
        });

        // Sort: completed at bottom, then by custom order, then by priority
        const orderIndex = (id: ID) => {
          const idx = todoOrder.indexOf(id);
          return idx === -1 ? Infinity : idx;
        };

        return filtered.sort((a, b) => {
          if (a.status === 'completed' && b.status !== 'completed') return 1;
          if (a.status !== 'completed' && b.status === 'completed') return -1;
          const orderDiff = orderIndex(a.id) - orderIndex(b.id);
          if (orderDiff !== 0) return orderDiff;
          const priorityOrder: Record<TodoPriority, number> = { high: 0, medium: 1, low: 2, green: 3 };
          return priorityOrder[a.priority] - priorityOrder[b.priority];
        });
      },

      getTodoById: (id) => get().todos[id],

      getTodosByDate: (date) => {
        return Object.values(get().todos).filter((todo) => todo.dueDate === date);
      },

      getTrashedTodos: () => {
        return Object.values(get().trash).sort(
          (a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime()
        );
      },
    }),
    {
      name: 'p2m-todo-storage',
      storage: createJSONStorage(() => idbStorage),
      partialize: (state) => ({
        todos: state.todos,
        tags: state.tags,
        todoOrder: state.todoOrder,
        trash: state.trash,
      }),
    }
  )
);
