import React, { useEffect, useMemo, useState } from 'react';
import { BellRing, Check, X } from 'lucide-react';
import { useNotificationStore } from '../../stores';
import type { Notification } from '../../stores/notificationStore';

export const TodoReminderPopup: React.FC = () => {
  const notifications = useNotificationStore((s) => s.notifications);
  const markAsRead = useNotificationStore((s) => s.markAsRead);
  const latestTodoReminder = useMemo(
    () => notifications.find((item) => item.type === 'todo' && item.title === '待办提醒' && !item.read) ?? null,
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
    <div className="fixed inset-x-3 top-4 z-[100000] mx-auto max-w-sm md:inset-x-auto md:right-6 md:top-6">
      <div className="rounded-xl border border-[#fde68a] bg-[#fffbeb] p-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f59e0b] text-white">
            <BellRing size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-[#92400e]">待办提醒</p>
              <button
                type="button"
                onClick={() => close(false)}
                className="rounded-md p-1 text-[#b45309] transition-colors hover:bg-[#fef3c7]"
                title="关闭"
              >
                <X size={15} />
              </button>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-[#1f2937]">{activeReminder.message}</p>
            <button
              type="button"
              onClick={() => close(true)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[#f59e0b] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#d97706]"
            >
              <Check size={13} />
              知道了
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

