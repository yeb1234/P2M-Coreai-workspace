import React from 'react';
import {
  LayoutDashboard,
  LayoutGrid,
  ListTodo,
  MessageSquare,
  PlayCircle,
  Sparkles,
  Timer,
} from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { VIEW_PATH, preloadPage } from '../../config/pageRegistry';
import { IS_LITE } from '../../config/appProfile';
import type { ActiveView } from '../../stores/uiStore';

interface RouteTab {
  id: Extract<ActiveView, 'dashboard' | 'todo' | 'pomodoro' | 'video' | 'interview'>;
  label: string;
  icon: React.ReactNode;
}

interface MobileTabBarProps {
  allOpen: boolean;
  chatOpen: boolean;
  onOpenAll: () => void;
  onToggleAI: () => void;
}

// 手机上的主入口只留最高频的四个页面，其余 25 个页面走「全部」。
// 日历、便签和笔记没有消失，它们在「全部」的常用区第一屏。
const ROUTE_TABS: RouteTab[] = [
  { id: 'dashboard', label: '工作台', icon: <LayoutDashboard size={20} /> },
  { id: 'todo', label: '待办', icon: <ListTodo size={20} /> },
  { id: 'pomodoro', label: '番茄', icon: <Timer size={20} /> },
  IS_LITE
    ? { id: 'interview', label: '面试', icon: <MessageSquare size={20} /> }
    : { id: 'video', label: '视频', icon: <PlayCircle size={20} /> },
];

const itemClass = (active: boolean) =>
  `flex min-h-[48px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 transition-colors ${
    active
      ? 'bg-[var(--accent-bg)] text-[var(--accent)]'
      : 'text-[var(--text-muted)] active:text-[var(--accent)]/60'
  }`;

export const MobileTabBar: React.FC<MobileTabBarProps> = ({
  allOpen,
  chatOpen,
  onOpenAll,
  onToggleAI,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = location.pathname === '/' ? '' : location.pathname.replace(/^\//, '');
  const routeIds = ROUTE_TABS.map((tab) => VIEW_PATH[tab.id]);
  const onOtherPage = !routeIds.includes(currentPath);

  return (
    <nav
      className="mobile-tabbar safe-area-pb border-t border-[var(--border-light)] bg-[color-mix(in_srgb,var(--bg-card)_94%,transparent)] px-1.5 pt-1.5 shadow-[0_-8px_24px_rgba(0,0,0,0.04)] backdrop-blur"
      aria-label="移动端主导航"
    >
      <div className="mobile-tabbar-inner mx-auto flex max-w-md items-center gap-0.5">
        {ROUTE_TABS.map((tab) => {
          const tabPath = VIEW_PATH[tab.id];
          const isActive = !allOpen && !chatOpen && currentPath === tabPath;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => navigate(tabPath === '' ? '/' : `/${tabPath}`)}
              onTouchStart={() => preloadPage(tab.id)}
              onFocus={() => preloadPage(tab.id)}
              className={itemClass(isActive)}
              aria-current={isActive ? 'page' : undefined}
              aria-label={tab.label}
            >
              <span className="[&_svg]:h-[20px] [&_svg]:w-[20px]">{tab.icon}</span>
              <span className="max-w-full truncate text-[11px] font-medium leading-tight">
                {tab.label}
              </span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={onToggleAI}
          className={itemClass(chatOpen)}
          aria-pressed={chatOpen}
          aria-label="AI 问答"
        >
          <Sparkles size={20} />
          <span className="max-w-full truncate text-[11px] font-medium leading-tight">AI问</span>
        </button>

        <button
          type="button"
          onClick={onOpenAll}
          className={itemClass(allOpen || (onOtherPage && !chatOpen))}
          aria-expanded={allOpen}
          aria-label="全部功能"
        >
          <LayoutGrid size={20} />
          <span className="max-w-full truncate text-[11px] font-medium leading-tight">全部</span>
        </button>
      </div>
    </nav>
  );
};
