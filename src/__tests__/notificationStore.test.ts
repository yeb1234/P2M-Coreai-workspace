import { describe, it, expect, beforeEach } from 'vitest';
import { useNotificationStore } from '../stores/notificationStore';

describe('notificationStore', () => {
  beforeEach(() => {
    useNotificationStore.setState({ notifications: [] });
  });

  it('adds a notification', () => {
    useNotificationStore.getState().addNotification({
      type: 'pomodoro',
      title: 'Test',
      message: 'Hello',
    });
    expect(useNotificationStore.getState().notifications.length).toBe(1);
    expect(useNotificationStore.getState().notifications[0].title).toBe('Test');
  });

  it('marks notification as read', () => {
    useNotificationStore.getState().addNotification({
      type: 'system',
      title: 'Unread',
      message: 'msg',
    });
    const id = useNotificationStore.getState().notifications[0].id;
    expect(useNotificationStore.getState().notifications[0].read).toBe(false);
    useNotificationStore.getState().markAsRead(id);
    expect(useNotificationStore.getState().notifications[0].read).toBe(true);
  });

  it('marks all as read', () => {
    useNotificationStore.getState().addNotification({ type: 'pomodoro', title: 'A', message: '' });
    useNotificationStore.getState().addNotification({ type: 'todo', title: 'B', message: '' });
    useNotificationStore.getState().markAllAsRead();
    expect(useNotificationStore.getState().notifications.every((n) => n.read)).toBe(true);
  });

  it('clears all notifications', () => {
    useNotificationStore.getState().addNotification({ type: 'system', title: 'A', message: '' });
    useNotificationStore.getState().clearAll();
    expect(useNotificationStore.getState().notifications.length).toBe(0);
  });

  it('counts unread notifications', () => {
    useNotificationStore.getState().addNotification({ type: 'pomodoro', title: 'A', message: '' });
    useNotificationStore.getState().addNotification({ type: 'todo', title: 'B', message: '' });
    expect(useNotificationStore.getState().unreadCount()).toBe(2);
    const id = useNotificationStore.getState().notifications[0].id;
    useNotificationStore.getState().markAsRead(id);
    expect(useNotificationStore.getState().unreadCount()).toBe(1);
  });

  it('limits to 50 notifications', () => {
    for (let i = 0; i < 60; i++) {
      useNotificationStore.getState().addNotification({ type: 'system', title: `N${i}`, message: '' });
    }
    expect(useNotificationStore.getState().notifications.length).toBe(50);
  });
});
