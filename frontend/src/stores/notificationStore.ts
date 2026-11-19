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
  sourceKey?: string;
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
  addNotification: (data: Omit<Notification, 'id' | 'read' | 'createdAt'>) => boolean;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearAll: () => void;
  unreadCount: () => number;
  updateSettings: (patch: Partial<NotificationSettings>) => void;
}

const MAX_NOTIFICATIONS = 50;

const DEFAULT_SETTINGS: NotificationSettings = {
  enablePomodoroNotif: true,
  enableTodoNotif: true,
  enableSystemNotif: true,
  soundEnabled: true,
};

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set, get) => ({
      notifications: [],
      settings: DEFAULT_SETTINGS,

      addNotification: (data) => {
        const { settings } = get();
        if (data.type === 'pomodoro' && !settings.enablePomodoroNotif) return false;
        if (data.type === 'todo' && !settings.enableTodoNotif) return false;
        if (data.type === 'system' && !settings.enableSystemNotif) return false;
        if (data.sourceKey && get().notifications.some((notification) => notification.sourceKey === data.sourceKey)) {
          return false;
        }

        const notification: Notification = {
          id: generateId(),
          ...data,
          read: false,
          createdAt: new Date().toISOString(),
        };
        set((state) => ({
          notifications: [notification, ...state.notifications].slice(0, MAX_NOTIFICATIONS),
        }));
        return true;
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
