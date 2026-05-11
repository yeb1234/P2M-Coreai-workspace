import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { idbStorage } from '../lib/idbStorage';
import { generateId } from '../lib/id';
import type { CountdownPreset, TimeAlarm, TimeReminder, WorldClock, ID } from '../types';

const nowIso = () => new Date().toISOString();

interface TimeCenterState {
  worldClocks: WorldClock[];
  alarms: TimeAlarm[];
  reminders: TimeReminder[];
  countdownPresets: CountdownPreset[];
  addWorldClock: (data: Omit<WorldClock, 'id'>) => void;
  updateWorldClock: (id: ID, updates: Partial<Omit<WorldClock, 'id'>>) => void;
  removeWorldClock: (id: ID) => void;
  addAlarm: (data: Pick<TimeAlarm, 'label' | 'time'>) => void;
  toggleAlarm: (id: ID) => void;
  removeAlarm: (id: ID) => void;
  markAlarmTriggered: (id: ID, date: string) => void;
  addReminder: (data: Pick<TimeReminder, 'title' | 'remindAt'> & Partial<Pick<TimeReminder, 'source' | 'todoId'>>) => void;
  upsertTodoReminder: (todoId: ID, title: string, remindAt: string | null) => void;
  toggleReminder: (id: ID) => void;
  removeReminder: (id: ID) => void;
  markReminderTriggered: (id: ID, triggeredAt: string) => void;
  addCountdownPreset: (data: Omit<CountdownPreset, 'id'>) => void;
  removeCountdownPreset: (id: ID) => void;
}

const DEFAULT_WORLD_CLOCKS: WorldClock[] = [
  { id: 'local', label: '本地', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai' },
  { id: 'tokyo', label: '东京', timeZone: 'Asia/Tokyo' },
  { id: 'london', label: '伦敦', timeZone: 'Europe/London' },
  { id: 'new-york', label: '纽约', timeZone: 'America/New_York' },
];

const DEFAULT_COUNTDOWNS: CountdownPreset[] = [
  { id: 'tea', label: '泡茶', seconds: 3 * 60 },
  { id: 'rest', label: '休息', seconds: 5 * 60 },
  { id: 'focus', label: '短专注', seconds: 15 * 60 },
];

export const useTimeCenterStore = create<TimeCenterState>()(
  persist(
    (set) => ({
      worldClocks: DEFAULT_WORLD_CLOCKS,
      alarms: [],
      reminders: [],
      countdownPresets: DEFAULT_COUNTDOWNS,

      addWorldClock: (data) => set((state) => ({
        worldClocks: [...state.worldClocks, { id: generateId(), ...data }],
      })),
      updateWorldClock: (id, updates) => set((state) => ({
        worldClocks: state.worldClocks.map((item) => item.id === id ? { ...item, ...updates } : item),
      })),
      removeWorldClock: (id) => set((state) => ({
        worldClocks: state.worldClocks.filter((item) => item.id !== id),
      })),

      addAlarm: (data) => set((state) => ({
        alarms: [...state.alarms, { id: generateId(), ...data, enabled: true, lastTriggeredDate: null, createdAt: nowIso() }],
      })),
      toggleAlarm: (id) => set((state) => ({
        alarms: state.alarms.map((alarm) => alarm.id === id ? { ...alarm, enabled: !alarm.enabled } : alarm),
      })),
      removeAlarm: (id) => set((state) => ({
        alarms: state.alarms.filter((alarm) => alarm.id !== id),
      })),
      markAlarmTriggered: (id, date) => set((state) => ({
        alarms: state.alarms.map((alarm) => alarm.id === id ? { ...alarm, lastTriggeredDate: date } : alarm),
      })),

      addReminder: (data) => set((state) => ({
        reminders: [
          ...state.reminders,
          {
            id: generateId(),
            title: data.title,
            remindAt: data.remindAt,
            enabled: true,
            triggeredAt: null,
            source: data.source ?? 'manual',
            todoId: data.todoId ?? null,
            createdAt: nowIso(),
          },
        ],
      })),
      upsertTodoReminder: (todoId, title, remindAt) => set((state) => {
        const existing = state.reminders.find((item) => item.source === 'todo' && item.todoId === todoId);
        if (!remindAt) {
          return { reminders: state.reminders.filter((item) => item.id !== existing?.id) };
        }
        if (existing) {
          return {
            reminders: state.reminders.map((item) => item.id === existing.id ? { ...item, title, remindAt, enabled: true, triggeredAt: null } : item),
          };
        }
        return {
          reminders: [
            ...state.reminders,
            { id: generateId(), title, remindAt, enabled: true, triggeredAt: null, source: 'todo', todoId, createdAt: nowIso() },
          ],
        };
      }),
      toggleReminder: (id) => set((state) => ({
        reminders: state.reminders.map((item) => item.id === id ? { ...item, enabled: !item.enabled } : item),
      })),
      removeReminder: (id) => set((state) => ({
        reminders: state.reminders.filter((item) => item.id !== id),
      })),
      markReminderTriggered: (id, triggeredAt) => set((state) => ({
        reminders: state.reminders.map((item) => item.id === id ? { ...item, triggeredAt } : item),
      })),

      addCountdownPreset: (data) => set((state) => ({
        countdownPresets: [...state.countdownPresets, { id: generateId(), ...data }],
      })),
      removeCountdownPreset: (id) => set((state) => ({
        countdownPresets: state.countdownPresets.filter((item) => item.id !== id),
      })),
    }),
    {
      name: 'p2m-time-center-storage',
      storage: createJSONStorage(() => idbStorage),
      partialize: (state) => ({
        worldClocks: state.worldClocks,
        alarms: state.alarms,
        reminders: state.reminders,
        countdownPresets: state.countdownPresets,
      }),
    }
  )
);
