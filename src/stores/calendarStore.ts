import { create } from 'zustand';
import type { CalendarEvent, CalendarViewType, ID, ISODateString } from '../types';
import { createCalendarEvent, deleteCalendarEvent, fetchCalendarEvents } from '../lib/calendarApi';

interface CalendarState {
  events: Record<ID, CalendarEvent>;
  currentMonth: Date;
  currentView: CalendarViewType;
  selectedDate: ISODateString | null;
  loading: boolean;
  error: string | null;
  addEvent: (data: Omit<CalendarEvent, 'id' | 'createdAt'> & { id?: string }) => Promise<ID>;
  updateEvent: (id: ID, updates: Partial<CalendarEvent>) => void;
  deleteEvent: (id: ID) => void;
  loadEvents: () => Promise<void>;
  setCurrentMonth: (date: Date) => void;
  setView: (view: CalendarViewType) => void;
  setSelectedDate: (date: ISODateString | null) => void;
  getEventsForDate: (date: ISODateString) => CalendarEvent[];
  getEventsForMonth: (year: number, month: number) => CalendarEvent[];
  getPomodoroHeatMap: (year: number, month: number) => Record<ISODateString, number>;
  getEventsByTodoId: (todoId: ID) => CalendarEvent[];
  deleteEventsByTodoId: (todoId: ID) => void;
}

export const useCalendarStore = create<CalendarState>()((set, get) => ({
  events: {},
  currentMonth: new Date(),
  currentView: 'month',
  selectedDate: null,
  loading: false,
  error: null,

  addEvent: async (data) => {
    const event = await createCalendarEvent(data);
    set((state) => ({
      events: { ...state.events, [event.id]: event },
    }));
    return event.id;
  },

  updateEvent: (id, updates) => {
    set((state) => {
      const event = state.events[id];
      if (!event) return state;
      return {
        events: {
          ...state.events,
          [id]: { ...event, ...updates },
        },
      };
    });
  },

  deleteEvent: async (id) => {
    await deleteCalendarEvent(id).catch(() => null);
    set((state) => {
      const events = { ...state.events };
      delete events[id];
      return { events };
    });
  },

  loadEvents: async () => {
    set({ loading: true, error: null });
    try {
      const items = await fetchCalendarEvents();
      const nextEvents = Object.fromEntries(items.map((item) => [item.id, item]));
      set({ events: nextEvents, loading: false });
    } catch {
      set({ loading: false, error: '日历数据暂时无法连接数据库' });
    }
  },

  setCurrentMonth: (date) => set({ currentMonth: date }),
  setView: (view) => set({ currentView: view }),
  setSelectedDate: (date) => set({ selectedDate: date }),

  getEventsForDate: (date) => {
    return Object.values(get().events).filter((event) => event.date === date);
  },

  getEventsForMonth: (year, month) => {
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    return Object.values(get().events).filter((event) =>
      event.date.startsWith(monthStr)
    );
  },

  getPomodoroHeatMap: (year, month) => {
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    const heatMap: Record<ISODateString, number> = {};
    Object.values(get().events)
      .filter((event) => event.type === 'pomodoro' && event.date.startsWith(monthStr))
      .forEach((event) => {
        heatMap[event.date] = (heatMap[event.date] || 0) + 1;
      });
    return heatMap;
  },

  getEventsByTodoId: (todoId) => {
    return Object.values(get().events).filter((event) => event.todoId === todoId);
  },

  deleteEventsByTodoId: (todoId) => {
    set((state) => {
      const events: Record<ID, CalendarEvent> = {};
      Object.entries(state.events).forEach(([id, event]) => {
        if (event.todoId !== todoId) {
          events[id] = event;
        }
      });
      return { events };
    });
  },
}));
