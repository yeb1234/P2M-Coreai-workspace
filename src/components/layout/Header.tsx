import React, { useCallback, useState, useEffect } from 'react';
import { Bell, Settings, Clock } from 'lucide-react';
import { usePomodoroStore, useTodoStore, useUIStore, useNotificationStore } from '../../stores';
import { NotificationPanel } from './NotificationPanel';
import { toLocalDateString } from '../../lib/date';

function LiveClock() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const h = String(time.getHours()).padStart(2, '0');
  const m = String(time.getMinutes()).padStart(2, '0');
  const s = String(time.getSeconds()).padStart(2, '0');
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const month = time.getMonth() + 1;
  const day = time.getDate();

  return (
    <div className="flex items-center gap-2 text-[#6b7280] text-sm">
      <Clock size={14} className="text-[#c87d2f]" />
      <span className="font-mono font-medium text-[#1a1a1a]">{h}:{m}<span className="text-[#b8b4ac]">:{s}</span></span>
      <span className="text-[10px] text-[#b8b4ac]">{month}月{day}日 {weekdays[time.getDay()]}</span>
    </div>
  );
}

export const Header: React.FC = () => {
  const sessions = usePomodoroStore((s) => s.sessions);
  const todos = useTodoStore((s) => s.todos);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const notifications = useNotificationStore((s) => s.notifications);

  const [showNotifications, setShowNotifications] = useState(false);

  // Today stats
  const today = toLocalDateString(new Date());
  const todaySessions = Object.values(sessions || {}).filter(
    (s) => s.completed && toLocalDateString(s.startTime) === today
  );

  const pendingTodos = Object.values(todos).filter(
    (t) => t.status !== 'completed'
  ).length;

  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleOpenSettings = useCallback(() => {
    setActiveView('settings');
  }, [setActiveView]);

  return (
    <header className="bg-[#faf9f7]/80 backdrop-blur-sm border-b border-[#e5e2dd] px-4 md:px-6 py-3 rounded-t-2xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-[#1a1a1a]">
            <span className="text-[#c87d2f]">灵</span>
            <span className="text-[#7c3aed]">境</span>
          </h1>
          <span className="text-sm text-[#d1cdc6]">|</span>
          <span className="text-sm text-[#6b7280]">CoreAI</span>
        </div>

        <div className="flex items-center gap-4">
          <LiveClock />

          <div className="flex items-center gap-6 text-sm">
            <div className="flex items-center gap-2 text-[#6b7280]">
              <span className="text-[#c87d2f] font-medium">{pendingTodos}</span>
              <span>待办</span>
            </div>
            <div className="flex items-center gap-2 text-[#6b7280]">
              <span className="text-[#16a34a] font-medium">{todaySessions.length}</span>
              <span>今日番茄</span>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className="p-2 text-[#6b7280] hover:text-[#1a1a1a] hover:bg-[#f3f2ef] rounded-lg transition-colors relative"
            >
              <Bell size={18} />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-[#dc3545] text-white text-[9px] rounded-full flex items-center justify-center font-medium">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            <button
              onClick={handleOpenSettings}
              className="p-2 text-[#6b7280] hover:text-[#1a1a1a] hover:bg-[#f3f2ef] rounded-lg transition-colors"
            >
              <Settings size={18} />
            </button>
          </div>
        </div>
      </div>
      <NotificationPanel isOpen={showNotifications} onClose={() => setShowNotifications(false)} />
    </header>
  );
};
