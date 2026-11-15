import React, { useState } from 'react';
import { Settings, Bell, LogOut } from 'lucide-react';
import { useUIStore, useNotificationStore, useAuthStore } from '../../stores';
import { NotificationPanel } from './NotificationPanel';

export const MobileHeader: React.FC = () => {
  const activeView = useUIStore((s) => s.activeView);
  const toggleSettingsView = useUIStore((s) => s.toggleSettingsView);
  const notifications = useNotificationStore((s) => s.notifications);
  const currentUser = useAuthStore((s) => s.currentUser);
  const logout = useAuthStore((s) => s.logout);
  const [showNotifications, setShowNotifications] = useState(false);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <header className="flex items-center justify-between border-b border-[var(--border-light)] px-4 py-2.5" style={{ background: 'var(--header-bg)' }}>
      <h1 className="text-base font-bold text-[var(--text-primary)]">
        <span className="text-[var(--accent)]">灵</span>
        <span className="text-[color-mix(in_srgb,var(--accent)_62%,#7c3aed)]">境</span>
      </h1>

      <div className="flex items-center gap-1">
        <button
          onClick={() => setShowNotifications(!showNotifications)}
          className="relative rounded-lg p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          <Bell size={18} />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--danger)] text-xs font-medium text-white">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
        <button
          onClick={toggleSettingsView}
          className={`p-2 rounded-lg ${
            activeView === 'settings'
              ? 'bg-[var(--accent-bg)] text-[var(--accent)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
          title={activeView === 'settings' ? '返回上一页' : '打开设置'}
        >
          <Settings size={18} />
        </button>
        {currentUser && (
          <button
            onClick={logout}
            className="rounded-lg p-2 text-[var(--text-muted)] hover:text-[var(--danger)]"
          >
            <LogOut size={14} />
          </button>
        )}
      </div>

      <NotificationPanel isOpen={showNotifications} onClose={() => setShowNotifications(false)} />
    </header>
  );
};
