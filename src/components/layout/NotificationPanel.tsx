import React, { useCallback, useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, CheckCheck, Trash2, Timer, ListTodo, Info, X, GripHorizontal } from 'lucide-react';
import { useNotificationStore } from '../../stores';
import type { Notification, NotificationType } from '../../stores/notificationStore';

const TYPE_ICON: Record<NotificationType, React.ReactNode> = {
  pomodoro: <Timer size={14} className="text-[#16a34a]" />,
  todo: <ListTodo size={14} className="text-[#2563eb]" />,
  system: <Info size={14} className="text-[#6b7280]" />,
};

const TYPE_BG: Record<NotificationType, string> = {
  pomodoro: 'bg-[#f0fdf4]',
  todo: 'bg-[#eff6ff]',
  system: 'bg-[#f3f2ef]',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}

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
      const main = document.querySelector('main');
      const rect = main?.getBoundingClientRect();
      const rightEdge = rect ? rect.right : window.innerWidth - 60;
      setPosition({
        x: Math.max(16, rightEdge - 400),
        y: 64,
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
      // Clamp to viewport
      const maxX = window.innerWidth - 384; // w-96 = 384px
      const maxY = window.innerHeight - 100;
      setPosition({
        x: Math.max(0, Math.min(newX, maxX)),
        y: Math.max(0, Math.min(newY, maxY)),
      });
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
      className="w-96 bg-[#faf9f7] border border-[#e5e2dd] rounded-xl shadow-2xl overflow-hidden select-none"
      style={panelStyle}
    >
      {/* Draggable header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-[#e5e2dd] cursor-grab active:cursor-grabbing"
        onMouseDown={handleDragStart}
      >
        <div className="flex items-center gap-2">
          <GripHorizontal size={14} className="text-[#d1cdc6]" />
          <Bell size={16} className="text-[#c87d2f]" />
          <h3 className="text-sm font-semibold text-[#1a1a1a]">通知</h3>
        </div>
        <div className="flex items-center gap-1">
          {notifications.length > 0 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); markAllAsRead(); }}
                className="p-1.5 text-[#9ca3af] hover:text-[#16a34a] rounded transition-colors"
                title="全部已读"
              >
                <CheckCheck size={14} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); clearAll(); }}
                className="p-1.5 text-[#9ca3af] hover:text-[#dc3545] rounded transition-colors"
                title="清空"
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="p-1.5 text-[#9ca3af] hover:text-[#1a1a1a] rounded transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="max-h-80 overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="text-center py-8 text-[#9ca3af]">
            <Bell size={24} className="mx-auto mb-2 opacity-40" />
            <p className="text-xs">暂无通知</p>
          </div>
        ) : (
          notifications.map((n) => (
            <div
              key={n.id}
              onClick={() => handleClick(n)}
              className={`flex items-start gap-3 px-4 py-3 border-b border-[#e5e2dd]/50 cursor-pointer hover:bg-[#f3f2ef] transition-colors ${
                n.read ? 'opacity-60' : ''
              }`}
            >
              <div className={`flex-shrink-0 w-7 h-7 rounded-full ${TYPE_BG[n.type]} flex items-center justify-center mt-0.5`}>
                {TYPE_ICON[n.type]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#1a1a1a]">{n.title}</p>
                <p className="text-xs text-[#6b7280] mt-0.5">{n.message}</p>
                <p className="text-[10px] text-[#b8b4ac] mt-1">{timeAgo(n.createdAt)}</p>
              </div>
              {!n.read && (
                <div className="w-2 h-2 bg-[#c87d2f] rounded-full flex-shrink-0 mt-2" />
              )}
            </div>
          ))
        )}
      </div>
    </div>,
    document.body
  );
};
