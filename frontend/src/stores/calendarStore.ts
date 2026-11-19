import { create } from 'zustand';
import type { CalendarEvent, CalendarViewType, ID, ISODateString } from '../types';
import { createCalendarEvent, fetchCalendarEvents } from '../lib/calendarApi';

/**
 * 日历的 UI 状态 + 只读事件缓存。
 *
 * ## 这个 store 现在只管两件事
 *
 *   1. 视图状态：当前月、当前视图、选中日期（CalendarGrid / Toolbar / WeekView 在用）
 *   2. 一份事件缓存：给 StatsPage 和 PrivacyDataSettings 做「有多少条」的统计
 *
 * ## 为什么删掉了 7 个 action
 *
 * 2026-11 清理时删了 updateEvent / deleteEvent / getEventsForDate /
 * getEventsForMonth / getPomodoroHeatMap / getEventsByTodoId /
 * deleteEventsByTodoId —— 全项目零调用。
 *
 * 原因是这个项目里存在**两套并行的日历数据模型**：
 *   - 这个 store + CalendarEvent（后端 /api/calendar-events）
 *   - useScheduleStore + ScheduleItem（后端 /api/schedule-items）
 * 实际的新建/编辑/删除都走 scheduleStore，CalendarEventForm 也是。
 * 这个 store 只剩 addEvent 一处真实用途：番茄钟完成时补一条日历记录
 * （useCrossModuleSync.ts），只写不读改删。
 *
 * 所以 addEvent 必须留着，其余写操作是历史残留。
 * 真要彻底合并两套模型是另一件事，不在这次清理范围。
 */
interface CalendarState {
  events: Record<ID, CalendarEvent>;
  currentMonth: Date;
  currentView: CalendarViewType;
  selectedDate: ISODateString | null;
  loading: boolean;
  error: string | null;
  addEvent: (data: Omit<CalendarEvent, 'id' | 'createdAt'> & { id?: string }) => Promise<ID>;
  loadEvents: () => Promise<void>;
  setCurrentMonth: (date: Date) => void;
  setView: (view: CalendarViewType) => void;
  setSelectedDate: (date: ISODateString | null) => void;
}

export const useCalendarStore = create<CalendarState>()((set) => ({
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
}));
