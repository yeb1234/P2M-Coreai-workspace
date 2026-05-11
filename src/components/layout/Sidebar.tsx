import React, { useState, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight, RotateCcw, Eye, RefreshCw, X, GripVertical } from 'lucide-react';
import { useUIStore, usePomodoroStore } from '../../stores';
import { PAGE_MAP } from '../../config/pageRegistry';
import type { ActiveView } from '../../stores/uiStore';
import { useDragResize } from '../../hooks/useDragResize';

const HEADER_STYLE = { height: '56px' };
const COLLAPSED_WIDTH = 56;
const AUTO_COLLAPSE_WIDTH = 132;

export const Sidebar: React.FC = () => {
  const activeView = useUIStore((s) => s.activeView);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
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
  const { width: liveSidebarWidth, startResize: startSidebarResize } = useDragResize({
    initialWidth: sidebarWidth,
    minWidth: 148,
    maxWidth: 240,
    side: 'right',
    onWidthChange: setSidebarWidth,
    onResizeEnd: (width) => {
      if (width < AUTO_COLLAPSE_WIDTH) setSidebarOpen(false);
    },
  });

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
      className="theme-sidebar border-r relative shrink-0"
      style={{ width: sidebarOpen ? liveSidebarWidth : COLLAPSED_WIDTH }}
    >
      <div className="flex flex-col h-full">
        <div className="flex items-center border-b border-[var(--border-light)] px-3" style={HEADER_STYLE}>
          {sidebarOpen ? (
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <span className="truncate text-sm font-bold tracking-wider text-[var(--accent)]">灵境</span>
              <button
                onClick={toggleSidebar}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[var(--text-muted)] transition-all hover:bg-[var(--accent-bg)] hover:text-[var(--accent)]"
                title="收起左侧栏"
              >
                <ChevronLeft size={14} />
              </button>
            </div>
          ) : (
            <button
              onClick={toggleSidebar}
              className="grid h-8 w-full place-items-center rounded-md text-[var(--text-muted)] transition-all hover:bg-[var(--accent-bg)] hover:text-[var(--accent)]"
              title="展开左侧栏"
            >
              <ChevronRight size={16} />
            </button>
          )}
          {sidebarOpen && (
            <div className="ml-2 flex shrink-0 items-center gap-0.5">
              <button
                onClick={resetNavOrder}
                className="grid h-7 w-7 place-items-center rounded-md text-[var(--text-muted)] transition-all hover:bg-[var(--accent-bg)] hover:text-[var(--accent)]"
                title="重置顺序"
              >
                <RotateCcw size={14} />
              </button>
              <button
                onClick={() => setShowRestorePanel((v) => !v)}
                className={`grid h-7 w-7 place-items-center rounded-md transition-all ${
                  showRestorePanel
                    ? 'text-[var(--accent)] bg-[var(--accent-bg)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-bg)]'
                }`}
                title="恢复隐藏插件"
              >
                <Eye size={14} />
              </button>
            </div>
          )}
        </div>

        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto min-h-0">
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
                className={`group w-full flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all cursor-pointer select-none ${
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
                  <span className="ml-auto w-2 h-2 bg-[var(--accent)] rounded-full animate-pulse" />
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
            <div className="px-3 py-2 rounded-lg border border-[color-mix(in_srgb,var(--accent)_22%,var(--border-light))] bg-[color-mix(in_srgb,var(--accent)_12%,var(--bg-card))]">
              <p className="text-xs text-[var(--accent)] font-medium">专注进行中</p>
              <p className="text-lg font-bold text-[var(--accent)] font-mono">
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
          onMouseDown={(e) => { e.preventDefault(); startSidebarResize(e.clientX); }}
          className="absolute top-0 right-[-5px] h-full w-2 cursor-col-resize text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-bg)]/60 transition-colors"
          title="拖动调整左侧栏宽度"
        >
          <GripVertical size={12} className="absolute top-1/2 -translate-y-1/2 right-[-2px]" />
        </button>
      )}
    </aside>
  );
};
