import React, { useState } from 'react';
import { Settings, Bell, LogOut } from 'lucide-react';
import { useUIStore, useNotificationStore, useAuthStore } from '../../stores';
import { NotificationPanel } from './NotificationPanel';

export const MobileHeader: React.FC = () => {
  const setActiveView = useUIStore((s) => s.setActiveView);
  const notifications = useNotificationStore((s) => s.notifications);
  const currentUser = useAuthStore((s) => s.currentUser);
  const logout = useAuthStore((s) => s.logout);
  const [showNotifications, setShowNotifications] = useState(false);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <header className="flex items-center justify-between px-4 py-2.5 bg-white border-b border-[#e5e2dd]">
      <h1 className="text-base font-bold text-[#1a1a1a]">
        <span className="text-[#c87d2f]">灵</span>
        <span className="text-[#7c3aed]">境</span>
      </h1>

      <div className="flex items-center gap-1">
        <button
          onClick={() => setShowNotifications(!showNotifications)}
          className="p-2 text-[#6b7280] hover:text-[#1a1a1a] rounded-lg relative"
        >
          <Bell size={18} />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-[#dc3545] text-white text-[9px] rounded-full flex items-center justify-center font-medium">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveView('settings')}
          className="p-2 text-[#6b7280] hover:text-[#1a1a1a] rounded-lg"
        >
          <Settings size={18} />
        </button>
        {currentUser && (
          <button
            onClick={logout}
            className="p-2 text-[#b8b4ac] hover:text-[#dc3545] rounded-lg"
          >
            <LogOut size={14} />
          </button>
        )}
      </div>

      <NotificationPanel isOpen={showNotifications} onClose={() => setShowNotifications(false)} />
    </header>
  );
};
