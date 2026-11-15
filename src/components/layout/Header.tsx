import React, { useCallback, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Settings, Clock, LogOut, Bot, Palette } from 'lucide-react';
import { usePomodoroStore, useScheduleStore, useUIStore, useNotificationStore, useAuthStore, useAIStore } from '../../stores';
import { BUILT_IN_THEME_IDS, THEME_PRESETS, applyTheme } from '../../lib/themes';
import { NotificationPanel } from './NotificationPanel';
import { toLocalDateString } from '../../lib/date';
import { useClockNow } from '../../hooks/useClockNow';

function LiveClock({ active, onClick }: { active: boolean; onClick: () => void }) {
  const time = useClockNow();

  const h = String(time.getHours()).padStart(2, '0');
  const m = String(time.getMinutes()).padStart(2, '0');
  const s = String(time.getSeconds()).padStart(2, '0');
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const month = time.getMonth() + 1;
  const day = time.getDate();

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors ${
        active
          ? 'bg-[var(--accent-bg)] text-[var(--accent)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-accent)] hover:text-[var(--text-primary)]'
      }`}
      title="打开时间中心"
    >
      <Clock size={14} className="text-[var(--accent)]" />
      <span className="font-mono font-medium text-[var(--text-primary)]">{h}:{m}<span className="text-[var(--text-muted)]">:{s}</span></span>
      <span className="text-xs text-[var(--text-muted)]">{month}月{day}日 {weekdays[time.getDay()]}</span>
    </button>
  );
}

export const Header: React.FC = () => {
  const sessions = usePomodoroStore((s) => s.sessions);
  const items = useScheduleStore((s) => s.items);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const activeView = useUIStore((s) => s.activeView);
  const toggleSettingsView = useUIStore((s) => s.toggleSettingsView);
  const notifications = useNotificationStore((s) => s.notifications);
  const currentUser = useAuthStore((s) => s.currentUser);
  const logout = useAuthStore((s) => s.logout);
  const chatOpen = useAIStore((s) => s.chatOpen);
  const toggleChat = useAIStore((s) => s.toggleChat);
  const themeId = useUIStore((s) => s.themeId);

  const [showNotifications, setShowNotifications] = useState(false);
  const [showThemePicker, setShowThemePicker] = useState(false);
  const themePickerRef = useRef<HTMLDivElement>(null);
  const themeButtonRef = useRef<HTMLButtonElement>(null);

  // 点击外部关闭主题选择器
  useEffect(() => {
    if (!showThemePicker) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        themePickerRef.current &&
        !themePickerRef.current.contains(target) &&
        themeButtonRef.current &&
        !themeButtonRef.current.contains(target)
      ) {
        setShowThemePicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showThemePicker]);

  // Today stats
  const today = toLocalDateString(new Date());
  const todaySessions = Object.values(sessions || {}).filter(
    (s) => s.completed && toLocalDateString(s.startTime) === today
  );

  const pendingTodos = Object.values(items).filter(
    (item) => item.type === 'todo' && !item.deletedAt && item.status !== 'completed'
  ).length;

  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleToggleSettings = useCallback(() => {
    toggleSettingsView();
  }, [toggleSettingsView]);

  return (
    <header className="rounded-t-2xl border-b border-[var(--border-light)] px-4 py-3 backdrop-blur-sm md:px-6" style={{ background: 'var(--header-bg)' }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-[var(--text-primary)]">
            <span className="text-[var(--accent)]">灵</span>
            <span className="text-[color-mix(in_srgb,var(--accent)_62%,#7c3aed)]">境</span>
          </h1>
          <span className="text-sm text-[var(--border-medium)]">|</span>
          <span className="text-sm text-[var(--text-secondary)]">CoreAI</span>
        </div>

        <div className="flex items-center gap-4">
          <LiveClock active={activeView === 'timecenter'} onClick={() => setActiveView('timecenter')} />

          <div className="flex items-center gap-6 text-sm">
            <button
              onClick={() => setActiveView('todo')}
              className="flex items-center gap-2 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
            >
              <span className="font-medium text-[var(--accent)]">{pendingTodos}</span>
              <span>待办</span>
            </button>
            <button
              onClick={() => setActiveView('pomodoro')}
              className="flex items-center gap-2 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
            >
              <span className="font-medium text-[var(--success)]">{todaySessions.length}</span>
              <span>今日番茄</span>
            </button>
          </div>

          <div className="relative flex items-center gap-1">
            <button
              ref={themeButtonRef}
              onClick={() => setShowThemePicker((v) => !v)}
              className={`rounded-lg p-2 transition-colors ${showThemePicker ? 'bg-[var(--accent-bg)] text-[var(--accent)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-accent)] hover:text-[var(--text-primary)]'}`}
              title="切换主题"
            >
              <Palette size={18} />
            </button>

            {showThemePicker &&
              createPortal(
                <div
                  ref={themePickerRef}
                  className="fixed z-[9999] mt-2 w-64 rounded-xl border border-[var(--border-light)] bg-[var(--bg-card)] p-3 shadow-lg"
                  style={{
                    top: (themeButtonRef.current?.getBoundingClientRect().bottom ?? 0) + 8,
                    right: window.innerWidth - (themeButtonRef.current?.getBoundingClientRect().right ?? 0),
                  }}
                >
                  <p className="mb-2 text-xs font-medium text-[var(--text-secondary)]">主题风格</p>
                  <div className="grid grid-cols-5 gap-2">
                    {THEME_PRESETS.filter((t) => BUILT_IN_THEME_IDS.has(t.id)).map((t) => (
                      <button
                        key={t.id}
                        onClick={() => {
                          useUIStore.getState().setTheme(t.id);
                          applyTheme(t.id, t.vars);
                        }}
                        title={t.name}
                        className={`relative h-9 w-9 overflow-hidden rounded-lg shadow-sm transition-all hover:scale-110 ${
                          themeId === t.id ? 'ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg-card)]' : ''
                        }`}
                        style={{
                          background: `linear-gradient(to right, ${t.vars['--bg-base']} 33.33%, ${t.vars['--accent']} 33.33%, ${t.vars['--accent']} 66.66%, ${t.vars['--text-primary']} 66.66%)`,
                        }}
                      />
                    ))}
                  </div>

                  <p className="mb-2 mt-3 text-xs font-medium text-[var(--text-secondary)]">自定义风格</p>
                  <div className="grid grid-cols-5 gap-2">
                    {THEME_PRESETS.filter((t) => !BUILT_IN_THEME_IDS.has(t.id)).map((t) => (
                      <button
                        key={t.id}
                        onClick={() => {
                          useUIStore.getState().setTheme(t.id);
                          applyTheme(t.id, t.vars);
                        }}
                        title={t.name}
                        className={`relative h-9 w-9 overflow-hidden rounded-lg shadow-sm transition-all hover:scale-110 ${
                          themeId === t.id ? 'ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg-card)]' : ''
                        }`}
                        style={{
                          background: `linear-gradient(to right, ${t.vars['--bg-base']} 33.33%, ${t.vars['--accent']} 33.33%, ${t.vars['--accent']} 66.66%, ${t.vars['--text-primary']} 66.66%)`,
                        }}
                      />
                    ))}
                  </div>
                </div>,
                document.body
              )}
            <button
              onClick={toggleChat}
              className={`p-2 rounded-lg transition-colors relative ${
                chatOpen
                  ? 'bg-[var(--accent-bg)] text-[var(--accent)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-accent)] hover:text-[var(--text-primary)]'
              }`}
              title={chatOpen ? '关闭灵境小助手' : '打开灵境小助手'}
            >
              <Bot size={18} />
            </button>
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className="relative rounded-lg p-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-accent)] hover:text-[var(--text-primary)]"
            >
              <Bell size={18} />
              {unreadCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--danger)] text-xs font-medium text-white">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            <button
              onClick={handleToggleSettings}
              className={`p-2 rounded-lg transition-colors ${
                activeView === 'settings'
                  ? 'bg-[var(--accent-bg)] text-[var(--accent)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-accent)] hover:text-[var(--text-primary)]'
              }`}
              title={activeView === 'settings' ? '返回上一页' : '打开设置'}
            >
              <Settings size={18} />
            </button>
          </div>

          {currentUser && (
            <div className="flex items-center gap-2 border-l border-[var(--border-light)] pl-2">
              <span className="text-xs font-medium text-[var(--text-secondary)]">{currentUser}</span>
              <button
                onClick={logout}
                className="rounded-lg p-1.5 text-[var(--text-muted)] transition-colors hover:text-[var(--danger)]"
                title="退出登录"
              >
                <LogOut size={14} />
              </button>
            </div>
          )}
        </div>
      </div>
      <NotificationPanel isOpen={showNotifications} onClose={() => setShowNotifications(false)} />
    </header>
  );
};
