import { create } from 'zustand';
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

interface NotificationState {
  notifications: Notification[];
  addNotification: (data: Omit<Notification, 'id' | 'read' | 'createdAt'>) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearAll: () => void;
  unreadCount: () => number;
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

export const useNotificationStore = create<NotificationState>()((set, get) => ({
  notifications: DEMO_NOTIFICATIONS,

  addNotification: (data) => {
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
}));
