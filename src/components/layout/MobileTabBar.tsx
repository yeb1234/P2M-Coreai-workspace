import React from 'react';
import { ListTodo, Calendar, StickyNote, Timer, PlayCircle } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { VIEW_PATH, preloadPage } from '../../config/pageRegistry';
import type { ActiveView } from '../../stores/uiStore';

interface Tab {
  id: ActiveView;
  label: string;
  icon: React.ReactNode;
}

const TABS: Tab[] = [
  { id: 'todo', label: '待办', icon: <ListTodo size={24} /> },
  { id: 'calendar', label: '日历', icon: <Calendar size={24} /> },
  { id: 'notes', label: '笔记', icon: <StickyNote size={24} /> },
  { id: 'pomodoro', label: '番茄钟', icon: <Timer size={24} /> },
  { id: 'video', label: 'IT视频站', icon: <PlayCircle size={24} /> },
];

export const MobileTabBar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const currentPath = location.hash.replace('#/', '').replace('#', '') || '';

  return (
    <nav className="safe-area-pb border-t border-[var(--border-light)] bg-[color-mix(in_srgb,var(--bg-card)_94%,transparent)] px-2 pt-1.5 shadow-[0_-8px_24px_rgba(0,0,0,0.04)] backdrop-blur">
      <div className="mx-auto flex max-w-md items-center justify-around gap-1">
      {TABS.map((tab) => {
        const tabPath = VIEW_PATH[tab.id];
        const isActive = currentPath === tabPath;
        return (
          <button
            key={tab.id}
            onClick={() => navigate(`/${tabPath}`)}
            onTouchStart={() => preloadPage(tab.id)}
            onFocus={() => preloadPage(tab.id)}
            className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 transition-colors ${
              isActive
                ? 'bg-[var(--accent-bg)] text-[var(--accent)]'
                : 'text-[var(--text-muted)] active:text-[var(--accent)]/60'
            }`}
          >
            <span className="[&_svg]:h-[21px] [&_svg]:w-[21px]">{tab.icon}</span>
            <span className="text-[10px] font-medium leading-tight">{tab.label}</span>
          </button>
        );
      })}
      </div>
    </nav>
  );
};
