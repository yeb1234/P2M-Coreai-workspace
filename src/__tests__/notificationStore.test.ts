import { describe, it, expect, beforeEach } from 'vitest';
import { useNotificationStore } from '../stores/notificationStore';

describe('notificationStore', () => {
  beforeEach(() => {
    useNotificationStore.setState({ notifications: [] });
  });

  it('starts without demo notifications', () => {
    expect(useNotificationStore.getInitialState().notifications).toEqual([]);
  });

  it('adds a notification', () => {
    const added = useNotificationStore.getState().addNotification({
      type: 'pomodoro',
      title: 'Test',
      message: 'Hello',
    });
    expect(added).toBe(true);
    expect(useNotificationStore.getState().notifications.length).toBe(1);
    expect(useNotificationStore.getState().notifications[0].title).toBe('Test');
  });

  it('deduplicates notifications by source key', () => {
    const first = useNotificationStore.getState().addNotification({
      type: 'todo',
      title: '待办提醒',
      message: '写报告',
      sourceKey: 'todo-reminder:todo-1:2026-05-12T01:00:00.000Z',
    });
    const second = useNotificationStore.getState().addNotification({
      type: 'todo',
      title: '待办提醒',
      message: '写报告',
      sourceKey: 'todo-reminder:todo-1:2026-05-12T01:00:00.000Z',
    });

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(useNotificationStore.getState().notifications).toHaveLength(1);
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
