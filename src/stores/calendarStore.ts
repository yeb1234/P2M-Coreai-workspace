import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { idbStorage } from '../lib/idbStorage';
import type { CalendarEvent, CalendarViewType, ID, ISODateString } from '../types';
import { generateId } from '../lib/id';
import { toISODateTimeString } from '../lib/date';

interface CalendarState {
  events: Record<ID, CalendarEvent>;
  currentMonth: Date;
  currentView: CalendarViewType;
  selectedDate: ISODateString | null;
  addEvent: (data: Omit<CalendarEvent, 'id' | 'createdAt'>) => ID;
  updateEvent: (id: ID, updates: Partial<CalendarEvent>) => void;
  deleteEvent: (id: ID) => void;
  setCurrentMonth: (date: Date) => void;
  setView: (view: CalendarViewType) => void;
  setSelectedDate: (date: ISODateString | null) => void;
  getEventsForDate: (date: ISODateString) => CalendarEvent[];
  getEventsForMonth: (year: number, month: number) => CalendarEvent[];
  getPomodoroHeatMap: (year: number, month: number) => Record<ISODateString, number>;
  getEventsByTodoId: (todoId: ID) => CalendarEvent[];
  deleteEventsByTodoId: (todoId: ID) => void;
}

export const useCalendarStore = create<CalendarState>()(
  persist(
    (set, get) => ({
      events: {},
      currentMonth: new Date(),
      currentView: 'month',
      selectedDate: null,

      addEvent: (data) => {
        const id = generateId();
        const event: CalendarEvent = {
          ...data,
          id,
          createdAt: toISODateTimeString(new Date()),
        };
        set((state) => ({
          events: { ...state.events, [id]: event },
        }));
        return id;
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

      deleteEvent: (id) => {
        set((state) => {
          const events = { ...state.events };
          delete events[id];
          return { events };
        });
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
    }),
    {
      name: 'p2m-calendar-storage',
      storage: createJSONStorage(() => idbStorage),
      partialize: (state) => ({
        events: state.events,
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<CalendarState>;
        return {
          ...current,
          ...saved,
          currentMonth: new Date(),
          currentView: current.currentView,
          selectedDate: null,
        };
      },
    }
  )
);
