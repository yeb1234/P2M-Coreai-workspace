import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { idbStorage } from '../lib/idbStorage';
import { generateId } from '../lib/id';

export type NotificationType = 'pomodoro' | 'todo' | 'system';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export interface NotificationSettings {
  enablePomodoroNotif: boolean;
  enableTodoNotif: boolean;
  enableSystemNotif: boolean;
  soundEnabled: boolean;
}

interface NotificationState {
  notifications: Notification[];
  settings: NotificationSettings;
  addNotification: (data: Omit<Notification, 'id' | 'read' | 'createdAt'>) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearAll: () => void;
  unreadCount: () => number;
  updateSettings: (patch: Partial<NotificationSettings>) => void;
}

const MAX_NOTIFICATIONS = 50;

const DEMO_NOTIFICATIONS: Notification[] = [
  {
    id: 'demo-1',
    type: 'pomodoro',
    title: '番茄钟完成',
    message: '恭喜完成第 4 个番茄钟！休息一下吧 ☕',
    read: false,
    createdAt: new Date(Date.now() - 5 * 60000).toISOString(),
  },
  {
    id: 'demo-2',
    type: 'todo',
    title: '待办即将到期',
    message: '「完成项目文档」将在明天到期',
    read: false,
    createdAt: new Date(Date.now() - 30 * 60000).toISOString(),
  },
  {
    id: 'demo-3',
    type: 'system',
    title: '欢迎使用 P2M',
    message: '你的个人效率工作台已准备就绪，开始高效的一天吧！',
    read: true,
    createdAt: new Date(Date.now() - 2 * 3600000).toISOString(),
  },
  {
    id: 'demo-4',
    type: 'pomodoro',
    title: '每日目标达成',
    message: '今日已完成 6 个番茄钟，超越了昨日记录！',
    read: true,
    createdAt: new Date(Date.now() - 8 * 3600000).toISOString(),
  },
];

const DEFAULT_SETTINGS: NotificationSettings = {
  enablePomodoroNotif: true,
  enableTodoNotif: true,
  enableSystemNotif: true,
  soundEnabled: true,
};

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set, get) => ({
      notifications: DEMO_NOTIFICATIONS,
      settings: DEFAULT_SETTINGS,

      addNotification: (data) => {
        const { settings } = get();
        if (data.type === 'pomodoro' && !settings.enablePomodoroNotif) return;
        if (data.type === 'todo' && !settings.enableTodoNotif) return;
        if (data.type === 'system' && !settings.enableSystemNotif) return;

        const notification: Notification = {
          id: generateId(),
          ...data,
          read: false,
          createdAt: new Date().toISOString(),
        };
        set((state) => ({
          notifications: [notification, ...state.notifications].slice(0, MAX_NOTIFICATIONS),
        }));
      },

      markAsRead: (id) => {
        set((state) => ({
          notifications: state.notifications.map((n) =>
            n.id === id ? { ...n, read: true } : n
          ),
        }));
      },

      markAllAsRead: () => {
        set((state) => ({
          notifications: state.notifications.map((n) => ({ ...n, read: true })),
        }));
      },

      clearAll: () => set({ notifications: [] }),

      unreadCount: () => get().notifications.filter((n) => !n.read).length,

      updateSettings: (patch) => {
        set((state) => ({
          settings: { ...state.settings, ...patch },
        }));
      },
    }),
    {
      name: 'p2m-notification-storage',
      storage: createJSONStorage(() => idbStorage),
      partialize: (state) => ({
        notifications: state.notifications,
        settings: state.settings,
      }),
    }
  )
);
