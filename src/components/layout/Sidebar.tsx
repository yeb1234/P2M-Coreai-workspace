import React, { useState, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight, RotateCcw, Eye, RefreshCw, X, GripVertical } from 'lucide-react';
import { useUIStore, usePomodoroStore } from '../../stores';
import { PAGE_MAP } from '../../config/pageRegistry';
import type { ActiveView } from '../../stores/uiStore';

const HEADER_STYLE = { height: '56px' };
const COLLAPSED_WIDTH = 64;

export const Sidebar: React.FC = () => {
  const activeView = useUIStore((s) => s.activeView);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const navOrder = useUIStore((s) => s.navOrder);
  const reorderNav = useUIStore((s) => s.reorderNav);
  const resetNavOrder = useUIStore((s) => s.resetNavOrder);
  const hiddenNavItems = useUIStore((s) => s.hiddenNavItems);
  const hideNav = useUIStore((s) => s.hideNav);
  const showNav = useUIStore((s) => s.showNav);
  const showAllNav = useUIStore((s) => s.showAllNav);
  const timerStatus = usePomodoroStore((s) => s.timer.status);
  const timerTimeRemaining = usePomodoroStore((s) => s.timer.timeRemaining);

  const [dragId, setDragId] = useState<ActiveView | null>(null);
  const [overId, setOverId] = useState<ActiveView | null>(null);
  const [showRestorePanel, setShowRestorePanel] = useState(false);
  const dragRef = useRef<HTMLDivElement>(null);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    if (!sidebarOpen) return;
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const handleMove = (event: MouseEvent) => {
      setSidebarWidth(startWidth + event.clientX - startX);
    };
    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [setSidebarWidth, sidebarOpen, sidebarWidth]);

  const handleDragStart = useCallback((e: React.DragEvent, id: ActiveView) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    setDragId(id);

    const el = e.currentTarget as HTMLElement;
    const clone = el.cloneNode(true) as HTMLElement;
    clone.style.width = `${el.offsetWidth}px`;
    clone.style.boxShadow = '0 12px 28px rgba(0,0,0,0.18), 0 4px 10px rgba(0,0,0,0.1)';
    clone.style.transform = 'rotate(2deg) scale(1.03)';
    clone.style.opacity = '0.9';
    clone.style.position = 'absolute';
    clone.style.top = '-9999px';
    clone.style.borderRadius = '8px';
    clone.style.background = 'var(--bg-card)';
    document.body.appendChild(clone);

    const rect = el.getBoundingClientRect();
    e.dataTransfer.setDragImage(clone, e.clientX - rect.left, e.clientY - rect.top);

    requestAnimationFrame(() => {
      document.body.removeChild(clone);
    });
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, id: ActiveView) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragId && dragId !== id) setOverId(id);
  }, [dragId]);

  const handleDrop = useCallback((e: React.DragEvent, id: ActiveView) => {
    e.preventDefault();
    if (dragId && dragId !== id) reorderNav(dragId, id);
    setDragId(null);
    setOverId(null);
  }, [dragId, reorderNav]);

  const handleDragEnd = useCallback(() => {
    setDragId(null);
    setOverId(null);
  }, []);

  const handleClick = useCallback((id: ActiveView) => {
    if (!dragId) setActiveView(id);
  }, [dragId, setActiveView]);

  return (
    <aside
      className="theme-sidebar border-r transition-[width] duration-200 relative shrink-0"
      style={{ width: sidebarOpen ? sidebarWidth : COLLAPSED_WIDTH }}
    >
      <div className="flex flex-col h-full">
        <div className="px-2 pb-1 flex items-center gap-1" style={HEADER_STYLE}>
          <button
            onClick={toggleSidebar}
            className="flex-1 flex items-center justify-center gap-2 py-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-bg)] transition-all"
            title={sidebarOpen ? '收起左侧栏' : '展开左侧栏'}
          >
            {sidebarOpen ? (
              <>
                <span className="text-sm font-bold text-[var(--accent)] tracking-wider">灵境</span>
                <ChevronLeft size={16} />
              </>
            ) : (
              <ChevronRight size={16} />
            )}
          </button>
          {sidebarOpen && (
            <>
              <button
                onClick={resetNavOrder}
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-bg)] transition-all"
                title="重置顺序"
              >
                <RotateCcw size={14} />
              </button>
              <button
                onClick={() => setShowRestorePanel((v) => !v)}
                className={`p-1.5 rounded-lg transition-all ${
                  showRestorePanel
                    ? 'text-[var(--accent)] bg-[var(--accent-bg)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-bg)]'
                }`}
                title="恢复隐藏插件"
              >
                <Eye size={14} />
              </button>
            </>
          )}
        </div>

        <nav className="flex-1 p-2 space-y-1 overflow-y-auto min-h-0">
          {navOrder.filter((id) => !hiddenNavItems.includes(id)).map((id) => {
            const meta = PAGE_MAP[id];
            if (!meta) return null;
            const isDragging = dragId === id;
            const isDropTarget = overId === id && dragId !== id;

            return (
              <div
                key={id}
                ref={dragRef}
                draggable
                onDragStart={(e) => handleDragStart(e, id)}
                onDragOver={(e) => handleDragOver(e, id)}
                onDrop={(e) => handleDrop(e, id)}
                onDragEnd={handleDragEnd}
                onClick={() => handleClick(id)}
                className={`group w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all cursor-pointer select-none ${
                  isDragging ? 'opacity-30' : ''
                } ${isDropTarget ? 'ring-2 ring-[var(--accent)] ring-offset-1' : ''} ${
                  activeView === id
                    ? 'bg-[var(--accent-bg)] text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'
                }`}
              >
                <span className={activeView === id ? meta.color : ''}>
                  {meta.icon}
                </span>
                {sidebarOpen && (
                  <span className="text-sm font-medium truncate">
                    {meta.label}
                    {meta.dev && <span className="ml-1 text-[10px] text-[var(--accent)] opacity-70">开发中</span>}
                  </span>
                )}
                {id === 'pomodoro' && timerStatus === 'running' && (
                  <span className="ml-auto w-2 h-2 bg-[var(--success)] rounded-full animate-pulse" />
                )}
                {sidebarOpen && (
                  <button
                    onClick={(e) => { e.stopPropagation(); hideNav(id); }}
                    className="ml-auto p-0.5 rounded opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] transition-all"
                    title="隐藏"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </nav>

        {sidebarOpen && showRestorePanel && hiddenNavItems.length > 0 && (
          <div className="px-3 py-2 border-t border-[var(--border-light)]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-[var(--text-muted)]">已隐藏插件</span>
              <button
                onClick={showAllNav}
                className="text-xs text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors flex items-center gap-1"
              >
                <RefreshCw size={10} />
                全部恢复
              </button>
            </div>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {hiddenNavItems.map((id) => {
                const meta = PAGE_MAP[id];
                if (!meta) return null;
                return (
                  <div key={id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--bg-elevated)] transition-colors">
                    <span className="text-[var(--text-muted)]">{meta.icon}</span>
                    <span className="text-xs text-[var(--text-secondary)] flex-1 truncate">
                      {meta.label}
                      {meta.dev && <span className="ml-1 text-[10px] opacity-70">开发中</span>}
                    </span>
                    <button
                      onClick={() => showNav(id)}
                      className="text-xs text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors"
                      title="恢复"
                    >
                      <Eye size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {sidebarOpen && timerStatus === 'running' && (
          <div className="p-3 border-t border-[var(--border-light)]">
            <div className="px-3 py-2 rounded-lg bg-[color-mix(in_srgb,var(--success)_12%,var(--bg-card))]">
              <p className="text-xs text-[var(--success)] font-medium">专注进行中</p>
              <p className="text-lg font-bold text-[var(--success)] font-mono">
                {Math.floor(timerTimeRemaining / 60).toString().padStart(2, '0')}:
                {(timerTimeRemaining % 60).toString().padStart(2, '0')}
              </p>
            </div>
          </div>
        )}
      </div>

      {sidebarOpen && (
        <button
          type="button"
          onMouseDown={handleResizeStart}
          className="absolute top-0 right-[-5px] h-full w-2 cursor-col-resize text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-bg)]/60 transition-colors"
          title="拖动调整左侧栏宽度"
        >
          <GripVertical size={12} className="absolute top-1/2 -translate-y-1/2 right-[-2px]" />
        </button>
      )}
    </aside>
  );
};
