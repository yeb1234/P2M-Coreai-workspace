import React, { useEffect, useMemo, useState } from 'react';
import { Check, ListTodo, X } from 'lucide-react';
import { useNotificationStore } from '../../stores';
import type { Notification } from '../../stores/notificationStore';

const TODO_REMINDER_POPUP_WINDOW_MS = 5 * 60 * 1000;

export const TodoReminderPopup: React.FC = () => {
  const notifications = useNotificationStore((s) => s.notifications);
  const markAsRead = useNotificationStore((s) => s.markAsRead);
  const latestTodoReminder = useMemo(
    () => notifications.find((item) => {
      if (!(item.type === 'todo' && item.title === '待办提醒' && !item.read)) return false;
      const createdAt = new Date(item.createdAt).getTime();
      return Number.isFinite(createdAt) && Date.now() - createdAt <= TODO_REMINDER_POPUP_WINDOW_MS;
    }) ?? null,
    [notifications],
  );
  const [activeReminder, setActiveReminder] = useState<Notification | null>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!latestTodoReminder || dismissedIds.has(latestTodoReminder.id)) return;
    setActiveReminder(latestTodoReminder);
  }, [dismissedIds, latestTodoReminder]);

  if (!activeReminder || dismissedIds.has(activeReminder.id)) return null;

  const close = (markRead: boolean) => {
    setDismissedIds((prev) => new Set(prev).add(activeReminder.id));
    if (markRead) markAsRead(activeReminder.id);
    setActiveReminder(null);
  };

  return (
    <div className="pointer-events-none fixed inset-x-3 top-3 z-[100000] mx-auto w-[calc(100vw-1.5rem)] max-w-[24rem] md:inset-x-auto md:right-6 md:top-[4.25rem]">
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto animate-fade-in overflow-hidden rounded-xl border border-[var(--border-light)] bg-[var(--bg-card)] shadow-2xl backdrop-blur"
      >
        <div className="flex items-start gap-3 px-4 py-3">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent-bg)] text-[var(--accent)]">
            <ListTodo size={14} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium text-[var(--text-primary)]">待办提醒</p>
              <button
                type="button"
                onClick={() => close(false)}
                className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                title="关闭"
              >
                <X size={14} />
              </button>
            </div>
            <p className="mt-0.5 break-words text-xs leading-5 text-[var(--text-secondary)]">{activeReminder.message}</p>
            <button
              type="button"
              onClick={() => close(true)}
              className="mt-2.5 inline-flex h-7 items-center gap-1.5 rounded-md bg-[var(--accent)] px-2.5 text-xs font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
            >
              <Check size={12} />
              知道了
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
