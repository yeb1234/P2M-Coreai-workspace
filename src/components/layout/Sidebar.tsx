import React, { useState, useRef, useCallback } from 'react';
import { ListTodo, Calendar, Timer, ChevronLeft, ChevronRight, LayoutDashboard, PlayCircle, StickyNote, BarChart3, RotateCcw, BookOpen, Code2, Target, Layers, Bookmark, Heart, GitCompare, ShoppingCart, Trophy, Coins, MessageSquare, Compass, Bot, Package, Workflow } from 'lucide-react';
import { useUIStore, usePomodoroStore } from '../../stores';
import type { ActiveView } from '../../stores/uiStore';

const NAV_META: Record<ActiveView, { label: string; icon: React.ReactNode; color: string }> = {
  dashboard: { label: '工作台', icon: <LayoutDashboard size={20} />, color: 'text-[#c87d2f]' },
  todo: { label: '待办事项', icon: <ListTodo size={20} />, color: 'text-[#2563eb]' },
  calendar: { label: '日历', icon: <Calendar size={20} />, color: 'text-[#7c3aed]' },
  notes: { label: '笔记', icon: <StickyNote size={20} />, color: 'text-[#f59e0b]' },
  pomodoro: { label: '番茄钟', icon: <Timer size={20} />, color: 'text-[#16a34a]' },
  video: { label: '视频站', icon: <PlayCircle size={20} />, color: 'text-[#ec4899]' },
  stats: { label: '数据中心', icon: <BarChart3 size={20} />, color: 'text-[#06b6d4]' },
  reader: { label: '阅读器', icon: <BookOpen size={20} />, color: 'text-[#2563eb]' },
  snippets: { label: '代码片段', icon: <Code2 size={20} />, color: 'text-[#8b5cf6]' },
  habits: { label: '习惯追踪', icon: <Target size={20} />, color: 'text-[#16a34a]' },
  flashcards: { label: '闪卡记忆', icon: <Layers size={20} />, color: 'text-[#f59e0b]' },
  bookmarks: { label: '书签收藏', icon: <Bookmark size={20} />, color: 'text-[#06b6d4]' },
  health: { label: '健康助手', icon: <Heart size={20} />, color: 'text-[#ec4899]' },
  compare: { label: '产品对比', icon: <GitCompare size={20} />, color: 'text-[#06b6d4]' },
  shop: { label: '电商中心', icon: <ShoppingCart size={20} />, color: 'text-[#f59e0b]' },
  esports: { label: '赛事数据', icon: <Trophy size={20} />, color: 'text-[#f59e0b]' },
  tokens: { label: 'Token 用量', icon: <Coins size={20} />, color: 'text-[#c87d2f]' },
  leetcode: { label: 'LeetCode', icon: <Code2 size={20} />, color: 'text-[#f59e0b]' },
  interview: { label: '面试鸭', icon: <MessageSquare size={20} />, color: 'text-[#ec4899]' },
  codenav: { label: '编程导航', icon: <Compass size={20} />, color: 'text-[#2563eb]' },
  aiagent: { label: 'AI 智能体', icon: <Bot size={20} />, color: 'text-[#8b5cf6]' },
  openclaw: { label: 'OpenClaw', icon: <Package size={20} />, color: 'text-[#dc3545]' },
  hermes: { label: 'Hermes', icon: <Workflow size={20} />, color: 'text-[#c87d2f]' },
};

const HEADER_STYLE = { height: '56px' };

export const Sidebar: React.FC = () => {
  const activeView = useUIStore((s) => s.activeView);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const navOrder = useUIStore((s) => s.navOrder);
  const reorderNav = useUIStore((s) => s.reorderNav);
  const resetNavOrder = useUIStore((s) => s.resetNavOrder);
  const timerStatus = usePomodoroStore((s) => s.timer.status);
  const timerTimeRemaining = usePomodoroStore((s) => s.timer.timeRemaining);

  const [dragId, setDragId] = useState<ActiveView | null>(null);
  const [overId, setOverId] = useState<ActiveView | null>(null);
  const dragRef = useRef<HTMLDivElement>(null);

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
    clone.style.background = '#faf9f7';
    document.body.appendChild(clone);

    const rect = el.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    e.dataTransfer.setDragImage(clone, offsetX, offsetY);

    requestAnimationFrame(() => {
      document.body.removeChild(clone);
    });
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, id: ActiveView) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragId && dragId !== id) {
      setOverId(id);
    }
  }, [dragId]);

  const handleDrop = useCallback((e: React.DragEvent, id: ActiveView) => {
    e.preventDefault();
    if (dragId && dragId !== id) {
      reorderNav(dragId, id);
    }
    setDragId(null);
    setOverId(null);
  }, [dragId, reorderNav]);

  const handleDragEnd = useCallback(() => {
    setDragId(null);
    setOverId(null);
  }, []);

  const handleClick = useCallback((id: ActiveView) => {
    if (!dragId) {
      setActiveView(id);
    }
  }, [dragId, setActiveView]);

  return (
    <aside
      className={`bg-gradient-to-b from-[#faf9f7] to-[#f5f3ef] border-r border-[#e5e2dd] transition-all duration-300 relative ${
        sidebarOpen ? 'w-52' : 'w-16'
      }`}
    >
      <div className="flex flex-col h-full">
        <div className="px-2 pb-1 flex items-center gap-1" style={HEADER_STYLE}>
          <button
            onClick={toggleSidebar}
            className="flex-1 flex items-center justify-center gap-2 py-1.5 rounded-lg text-[#9ca3af] hover:text-[#c87d2f] hover:bg-[#fef7ed] transition-all"
          >
            {sidebarOpen ? (
              <>
                <span className="text-sm font-bold text-[#c87d2f] tracking-wider">灵境</span>
                <ChevronLeft size={16} />
              </>
            ) : (
              <ChevronRight size={16} />
            )}
          </button>
          {sidebarOpen && (
            <button
              onClick={resetNavOrder}
              className="p-1.5 rounded-lg text-[#b8b4ac] hover:text-[#c87d2f] hover:bg-[#fef7ed] transition-all"
              title="重置顺序"
            >
              <RotateCcw size={14} />
            </button>
          )}
        </div>

        <nav className="flex-1 p-2 space-y-1 overflow-y-auto min-h-0">
          {navOrder.map((id) => {
            const meta = NAV_META[id];
            if (!meta) return null;
            const isDragging = dragId === id;
            const isDropTarget = overId === id && dragId !== id;

            return (
              <div
                key={id}
                draggable
                onDragStart={(e) => handleDragStart(e, id)}
                onDragOver={(e) => handleDragOver(e, id)}
                onDrop={(e) => handleDrop(e, id)}
                onDragEnd={handleDragEnd}
                onClick={() => handleClick(id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all cursor-pointer select-none ${
                  isDragging ? 'opacity-30' : ''
                } ${isDropTarget ? 'ring-2 ring-[#c87d2f] ring-offset-1' : ''} ${
                  activeView === id
                    ? 'bg-[#fef7ed] text-[#1a1a1a]'
                    : 'text-[#6b7280] hover:bg-[#f3f2ef] hover:text-[#1a1a1a]'
                }`}
              >
                <span className={activeView === id ? meta.color : ''}>
                  {meta.icon}
                </span>
                {sidebarOpen && (
                  <span className="text-sm font-medium">{meta.label}</span>
                )}
                {id === 'pomodoro' && timerStatus === 'running' && (
                  <span className="ml-auto w-2 h-2 bg-[#16a34a] rounded-full animate-pulse" />
                )}
              </div>
            );
          })}
        </nav>

        {sidebarOpen && timerStatus === 'running' && (
          <div className="p-3 border-t border-[#e5e2dd]">
            <div className="px-3 py-2 bg-[#f0fdf4] rounded-lg">
              <p className="text-xs text-[#16a34a] font-medium">专注进行中</p>
              <p className="text-lg font-bold text-[#15803d] font-mono">
                {Math.floor(timerTimeRemaining / 60).toString().padStart(2, '0')}:
                {(timerTimeRemaining % 60).toString().padStart(2, '0')}
              </p>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
