import React from 'react';
import { ListTodo, Calendar, StickyNote, Timer, PlayCircle } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { VIEW_PATH } from '../../config/pageRegistry';
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
  { id: 'video', label: '视频站', icon: <PlayCircle size={24} /> },
];

export const MobileTabBar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const currentPath = location.hash.replace('#/', '').replace('#', '') || '';

  return (
    <nav className="flex items-center justify-around bg-white border-t border-[#e5e2dd] px-1 py-1.5 safe-area-pb">
      {TABS.map((tab) => {
        const tabPath = VIEW_PATH[tab.id];
        const isActive = currentPath === tabPath;
        return (
          <button
            key={tab.id}
            onClick={() => navigate(`/${tabPath}`)}
            className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg transition-colors min-w-0 flex-1 ${
              isActive
                ? 'text-[#c87d2f]'
                : 'text-[#9ca3af] active:text-[#c87d2f]/60'
            }`}
          >
            {tab.icon}
            <span className="text-[11px] font-medium leading-tight">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
};
