import { create } from 'zustand';
import type { ScheduleFilters, ScheduleItem, ScheduleItemInput, ScheduleItemUpdate, TodoPriority, TodoStatus } from '../types';
import {
  clearScheduleItems,
  createScheduleItem,
  deleteScheduleItem,
  fetchScheduleItems,
  patchScheduleItem,
  restoreScheduleItem,
} from '../lib/scheduleApi';
import { generateId } from '../lib/id';
import { toMinuteISOString } from '../lib/scheduleTime';

interface TrashedScheduleItem {
  item: ScheduleItem;
  deletedAt: string;
}

type UndoAction =
  | { type: 'create'; id: string }
  | { type: 'delete'; item: ScheduleItem }
  | { type: 'restore'; id: string };

interface ScheduleState {
  items: Record<string, ScheduleItem>;
  itemOrder: string[];
  filter: ScheduleFilters;
  pendingTodoDate: string | null;
  pendingTodoPriority: TodoPriority | null;
  loading: boolean;
  error: string | null;
  undoStack: UndoAction[];
  redoStack: UndoAction[];
  loadItems: () => Promise<void>;
  addItem: (data: ScheduleItemInput) => string;
  addTodo: (data: Omit<ScheduleItemInput, 'type'>) => string;
  addEvent: (data: Omit<ScheduleItemInput, 'type' | 'status' | 'priority'> & Partial<Pick<ScheduleItemInput, 'priority' | 'status'>>) => string;
  updateItem: (id: string, updates: ScheduleItemUpdate) => void;
  deleteItem: (id: string) => void;
  restoreItem: (id: string) => void;
  permanentDeleteItem: (id: string) => void;
  clearTrash: () => void;
  clearAllItems: () => void;
  toggleStatus: (id: string) => void;
  reorderItems: (fromId: string, toId: string) => void;
  setFilter: (filter: Partial<ScheduleFilters>) => void;
  setPendingTodoDate: (date: string | null) => void;
  setPendingTodoPriority: (priority: TodoPriority | null) => void;
  undo: () => void;
  redo: () => void;
}

const now = () => toMinuteISOString(new Date());

function normalizeInput(data: ScheduleItemInput, existing?: ScheduleItem): ScheduleItem {
  const timestamp = now();
  const status = data.status || existing?.status || 'pending';
  const completedAt = status === 'completed'
    ? data.completedAt ?? existing?.completedAt ?? timestamp
    : null;
  return {
    id: existing?.id || generateId(),
    type: data.type || existing?.type || 'todo',
    title: data.title.trim(),
    description: data.description ?? existing?.description ?? '',
    status,
    priority: data.priority || existing?.priority || 'green',
    startAt: data.startAt ?? existing?.startAt ?? null,
    dueAt: data.dueAt ?? existing?.dueAt ?? null,
    reminderAt: data.reminderAt ?? existing?.reminderAt ?? null,
    pomodoroCount: data.pomodoroCount ?? existing?.pomodoroCount ?? 0,
    pomodoroRounds: data.pomodoroRounds ?? existing?.pomodoroRounds ?? 0,
    totalFocusMinutes: data.totalFocusMinutes ?? existing?.totalFocusMinutes ?? 0,
    completedAt,
    deletedAt: data.deletedAt ?? existing?.deletedAt ?? null,
    sortOrder: data.sortOrder ?? existing?.sortOrder ?? 0,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
  };
}

function applyPatch(item: ScheduleItem, updates: ScheduleItemUpdate): ScheduleItem {
  const nextStatus = updates.status ?? item.status;
  const timestamp = now();
  return {
    ...item,
    ...updates,
    status: nextStatus,
    completedAt: nextStatus === 'completed'
      ? item.completedAt ?? updates.completedAt ?? timestamp
      : updates.completedAt ?? null,
    updatedAt: timestamp,
  };
}

function persistCreate(data: ScheduleItemInput, localId: string) {
  void createScheduleItem(data, localId).catch(() => null);
  return localId;
}

function persistUpdate(id: string, updates: ScheduleItemUpdate) {
  void patchScheduleItem(id, updates).catch(() => null);
}

export const useScheduleStore = create<ScheduleState>()((set, get) => ({
  items: {},
  itemOrder: [],
  filter: {
    priority: null,
    status: 'all',
    searchQuery: '',
  },
  pendingTodoDate: null,
  pendingTodoPriority: null,
  loading: false,
  error: null,
  undoStack: [],
  redoStack: [],

  loadItems: async () => {
    set({ loading: true, error: null });
    try {
      const items = await fetchScheduleItems(true);
      const nextItems = Object.fromEntries(items.map((item) => [item.id, item]));
      const itemOrder = items
        .filter((item) => item.type === 'todo')
        .sort((a, b) => a.sortOrder - b.sortOrder || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .map((item) => item.id);
      set({ items: nextItems, itemOrder, loading: false });
    } catch {
      set({ loading: false, error: '排程数据暂时无法连接数据库' });
    }
  },

  addItem: (data) => {
    const id = generateId();
    const item = normalizeInput({ ...data, sortOrder: data.sortOrder ?? get().itemOrder.length });
    item.id = id;
    set((state) => ({
      items: { ...state.items, [id]: item },
      itemOrder: item.type === 'todo' ? [...state.itemOrder, id] : state.itemOrder,
      undoStack: [...state.undoStack, { type: 'create' as const, id }].slice(-50),
      redoStack: [],
    }));
    persistCreate({
      type: item.type,
      title: item.title,
      description: item.description,
      status: item.status,
      priority: item.priority,
      startAt: item.startAt,
      dueAt: item.dueAt,
      reminderAt: item.reminderAt,
      pomodoroCount: item.pomodoroCount,
      pomodoroRounds: item.pomodoroRounds,
      totalFocusMinutes: item.totalFocusMinutes,
      completedAt: item.completedAt,
      deletedAt: item.deletedAt,
      sortOrder: item.sortOrder,
    }, id);
    return id;
  },

  addTodo: (data) => get().addItem({ ...data, type: 'todo' }),

  addEvent: (data) => get().addItem({
    ...data,
    type: 'event',
    status: data.status || 'pending',
    priority: data.priority || 'medium',
    pomodoroCount: 0,
    pomodoroRounds: 0,
    totalFocusMinutes: 0,
  }),

  updateItem: (id, updates) => {
    set((state) => {
      const item = state.items[id];
      if (!item) return state;
      return {
        items: {
          ...state.items,
          [id]: applyPatch(item, updates),
        },
      };
    });
    persistUpdate(id, updates);
  },

  deleteItem: (id) => {
    const item = get().items[id];
    if (!item) return;
    get().updateItem(id, { deletedAt: now() });
    set((state) => ({
      undoStack: [...state.undoStack, { type: 'delete' as const, item }].slice(-50),
      redoStack: [],
    }));
    void deleteScheduleItem(id, false).catch(() => null);
  },

  restoreItem: (id) => {
    get().updateItem(id, { deletedAt: null });
    set((state) => ({
      undoStack: [...state.undoStack, { type: 'restore' as const, id }].slice(-50),
      redoStack: [],
    }));
    void restoreScheduleItem(id).catch(() => null);
  },

  permanentDeleteItem: (id) => {
    set((state) => {
      const items = { ...state.items };
      delete items[id];
      return {
        items,
        itemOrder: state.itemOrder.filter((itemId) => itemId !== id),
      };
    });
    void deleteScheduleItem(id, true).catch(() => null);
  },

  clearTrash: () => {
    const trashedIds = Object.values(get().items).filter((item) => item.deletedAt).map((item) => item.id);
    set((state) => {
      const items = { ...state.items };
      trashedIds.forEach((id) => delete items[id]);
      return { items, itemOrder: state.itemOrder.filter((id) => !trashedIds.includes(id)) };
    });
    trashedIds.forEach((id) => void deleteScheduleItem(id, true).catch(() => null));
  },

  clearAllItems: () => {
    set({ items: {}, itemOrder: [], undoStack: [], redoStack: [] });
    void clearScheduleItems().catch(() => null);
  },

  toggleStatus: (id) => {
    const item = get().items[id];
    if (!item) return;
    const statusMap: Record<TodoStatus, TodoStatus> = {
      pending: 'in_progress',
      in_progress: 'completed',
      completed: 'pending',
    };
    get().updateItem(id, { status: statusMap[item.status] });
  },

  reorderItems: (fromId, toId) => {
    set((state) => {
      const order = [...state.itemOrder];
      const fromIdx = order.indexOf(fromId);
      const toIdx = order.indexOf(toId);
      if (fromIdx === -1 || toIdx === -1) return state;
      order.splice(fromIdx, 1);
      order.splice(toIdx, 0, fromId);
      order.forEach((id, index) => {
        if (state.items[id]) persistUpdate(id, { sortOrder: index });
      });
      return {
        itemOrder: order,
        items: Object.fromEntries(Object.entries(state.items).map(([id, item]) => [
          id,
          order.includes(id) ? { ...item, sortOrder: order.indexOf(id) } : item,
        ])),
      };
    });
  },

  setFilter: (filter) => set((state) => ({ filter: { ...state.filter, ...filter } })),
  setPendingTodoDate: (date) => set({ pendingTodoDate: date }),
  setPendingTodoPriority: (priority) => set({ pendingTodoPriority: priority }),

  undo: () => {
    const state = get();
    const action = state.undoStack[state.undoStack.length - 1];
    if (!action) return;
    set({ undoStack: state.undoStack.slice(0, -1), redoStack: [...state.redoStack, action] });
    if (action.type === 'create') {
      get().permanentDeleteItem(action.id);
    } else if (action.type === 'delete') {
      set((current) => ({ items: { ...current.items, [action.item.id]: action.item } }));
      persistUpdate(action.item.id, { deletedAt: action.item.deletedAt });
    } else {
      get().deleteItem(action.id);
    }
  },

  redo: () => {
    const state = get();
    const action = state.redoStack[state.redoStack.length - 1];
    if (!action) return;
    set({ redoStack: state.redoStack.slice(0, -1), undoStack: [...state.undoStack, action] });
    if (action.type === 'create') {
      return;
    }
    if (action.type === 'delete') {
      get().deleteItem(action.item.id);
    } else {
      get().restoreItem(action.id);
    }
  },
}));

export function getTrashedScheduleItems(items: Record<string, ScheduleItem>): TrashedScheduleItem[] {
  return Object.values(items)
    .filter((item) => item.deletedAt)
    .map((item) => ({ item, deletedAt: item.deletedAt! }))
    .sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime());
}
