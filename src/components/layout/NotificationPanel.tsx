import React, { useCallback, useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, CheckCheck, Trash2, Timer, ListTodo, Info, X, GripHorizontal } from 'lucide-react';
import { useNotificationStore } from '../../stores';
import type { Notification, NotificationType } from '../../stores/notificationStore';
import { clampPanelPosition, getPanelOpenPosition } from './notificationPanelPosition';
import { formatNotificationTimeAgo } from './notificationTime';

const TYPE_ICON: Record<NotificationType, React.ReactNode> = {
  pomodoro: <Timer size={14} className="text-[var(--success)]" />,
  todo: <ListTodo size={14} className="text-[var(--info)]" />,
  system: <Info size={14} className="text-[var(--text-secondary)]" />,
};

const TYPE_BG: Record<NotificationType, string> = {
  pomodoro: 'bg-[var(--success-bg)]',
  todo: 'bg-[var(--info-bg)]',
  system: 'bg-[var(--bg-base)]',
};

interface NotificationPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NotificationPanel: React.FC<NotificationPanelProps> = ({ isOpen, onClose }) => {
  const notifications = useNotificationStore((s) => s.notifications);
  const markAsRead = useNotificationStore((s) => s.markAsRead);
  const markAllAsRead = useNotificationStore((s) => s.markAllAsRead);
  const clearAll = useNotificationStore((s) => s.clearAll);
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 64 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  // Reset position near content area right edge each time panel opens
  useEffect(() => {
    if (isOpen) {
      queueMicrotask(() => {
        const main = document.querySelector('main');
        const rect = main?.getBoundingClientRect();
        setPosition(getPanelOpenPosition(rect, window.innerWidth));
      });
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as HTMLElement)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  // Drag handlers
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (!panelRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      const newX = e.clientX - dragOffset.current.x;
      const newY = e.clientY - dragOffset.current.y;
      setPosition(clampPanelPosition({ x: newX, y: newY }, window.innerWidth, window.innerHeight));
    };
    const handleMouseUp = () => setIsDragging(false);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const handleClick = useCallback((n: Notification) => {
    if (!n.read) markAsRead(n.id);
  }, [markAsRead]);

  if (!isOpen) return null;

  const panelStyle: React.CSSProperties = {
    position: 'fixed',
    zIndex: 99999,
    left: position.x,
    top: position.y,
    cursor: isDragging ? 'grabbing' : undefined,
  };

  return createPortal(
    <div
      ref={panelRef}
      className="w-96 bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl shadow-2xl overflow-hidden select-none"
      style={panelStyle}
    >
      {/* Draggable header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-light)] cursor-grab active:cursor-grabbing"
        onMouseDown={handleDragStart}
      >
        <div className="flex items-center gap-2">
          <GripHorizontal size={14} className="text-[var(--border-medium)]" />
          <Bell size={16} className="text-[var(--accent)]" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">通知</h3>
        </div>
        <div className="flex items-center gap-1">
          {notifications.length > 0 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); markAllAsRead(); }}
                className="p-1.5 text-[var(--text-muted)] hover:text-[var(--success)] rounded transition-colors"
                title="全部已读"
              >
                <CheckCheck size={14} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); clearAll(); }}
                className="p-1.5 text-[var(--text-muted)] hover:text-[var(--danger)] rounded transition-colors"
                title="清空"
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="max-h-80 overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="text-center py-8 text-[var(--text-muted)]">
            <Bell size={24} className="mx-auto mb-2 opacity-40" />
            <p className="text-xs">暂无通知</p>
          </div>
        ) : (
          notifications.map((n) => (
            <div
              key={n.id}
              onClick={() => handleClick(n)}
              className={`flex items-start gap-3 px-4 py-3 border-b border-[var(--border-light)]/50 cursor-pointer hover:bg-[var(--bg-base)] transition-colors ${
                n.read ? 'opacity-60' : ''
              }`}
            >
              <div className={`flex-shrink-0 w-7 h-7 rounded-full ${TYPE_BG[n.type]} flex items-center justify-center mt-0.5`}>
                {TYPE_ICON[n.type]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)]">{n.title}</p>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">{n.message}</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">{formatNotificationTimeAgo(n.createdAt)}</p>
              </div>
              {!n.read && (
                <div className="w-2 h-2 bg-[var(--accent)] rounded-full flex-shrink-0 mt-2" />
              )}
            </div>
          ))
        )}
      </div>
    </div>,
    document.body
  );
};
