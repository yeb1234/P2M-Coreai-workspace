import React, { useState, useEffect, type ReactNode } from 'react';
import { Filter, Search } from 'lucide-react';
import type { TodoPriority, TodoStatus } from '../../types';
import { PRIORITY_COLORS, PRIORITY_LABELS } from '../../types';
import { useTodoStore } from '../../stores';

interface TodoFiltersProps {
  collapsed: boolean;
  onToggle: () => void;
  children?: ReactNode;
}

export const TodoFilters: React.FC<TodoFiltersProps> = ({ collapsed, children }) => {
  const { filter, setFilter } = useTodoStore();
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const statuses: { value: TodoStatus | 'all'; label: string }[] = [
    { value: 'all', label: '全部' },
    { value: 'pending', label: '待处理' },
    { value: 'in_progress', label: '进行中' },
    { value: 'completed', label: '已完成' },
  ];
  const priorities: { value: TodoPriority | null; label: string; color?: string }[] = [
    { value: null, label: '全部' },
    { value: 'high', label: PRIORITY_LABELS.high, color: PRIORITY_COLORS.high },
    { value: 'medium', label: PRIORITY_LABELS.medium, color: PRIORITY_COLORS.medium },
    { value: 'low', label: PRIORITY_LABELS.low, color: PRIORITY_COLORS.low },
    { value: 'green', label: PRIORITY_LABELS.green, color: PRIORITY_COLORS.green },
  ];

  // Mobile: show filters directly when expanded
  if (isMobile && !collapsed) {
    return (
      <div className="space-y-1.5">
        <div className="flex flex-wrap gap-1.5">
          {statuses.map((item) => (
            <button
              key={item.value}
              onClick={() => setFilter({ status: item.value })}
              className={`px-2 py-0.5 text-[10px] rounded-full transition-colors ${
                filter.status === item.value ? 'bg-[#c87d2f] text-white' : 'bg-[#f3f2ef] text-[#6b7280]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {priorities.map((item) => (
            <button
              key={item.value || 'all'}
              onClick={() => setFilter({ priority: item.value })}
              className={`px-2 py-0.5 text-[10px] rounded-full transition-colors flex items-center gap-1 ${
                filter.priority === item.value ? 'text-white' : 'bg-[#f3f2ef] text-[#6b7280]'
              }`}
              style={{ backgroundColor: filter.priority === item.value ? (item.value ? PRIORITY_COLORS[item.value] : '#c87d2f') : undefined }}
            >
              {item.color && <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: item.color }} />}
              {item.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Desktop: show directly when expanded, no header row
  if (!collapsed) {
    return (
      <div className="hidden md:block space-y-2">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
          <input
            type="text"
            value={filter.searchQuery}
            onChange={(event) => setFilter({ searchQuery: event.target.value })}
            className="w-full pl-9 pr-3 py-2 border border-[#e5e2dd] rounded-lg focus:ring-2 focus:ring-[#c87d2f] focus:border-transparent outline-none transition-all text-sm bg-[#faf9f7]"
            placeholder="搜索待办事项..."
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-1.5">
            <Filter size={14} className="text-[#9ca3af]" />
            <span className="text-xs text-[#6b7280]">状态</span>
          </div>
          {statuses.map((item) => (
            <button
              key={item.value}
              onClick={() => setFilter({ status: item.value })}
              className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                filter.status === item.value ? 'bg-[#c87d2f] text-white' : 'bg-[#f3f2ef] text-[#6b7280] hover:bg-[#e5e2dd]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-1.5">
            <Filter size={14} className="text-[#9ca3af]" />
            <span className="text-xs text-[#6b7280]">便签</span>
          </div>
          {priorities.map((item) => (
            <button
              key={item.value || 'all'}
              onClick={() => setFilter({ priority: item.value })}
              className={`px-2.5 py-1 text-xs rounded-full transition-colors flex items-center gap-1.5 ${
                filter.priority === item.value ? 'text-white' : 'bg-[#f3f2ef] text-[#6b7280] hover:bg-[#e5e2dd]'
              }`}
              style={{ backgroundColor: filter.priority === item.value ? (item.value ? PRIORITY_COLORS[item.value] : '#c87d2f') : undefined }}
            >
              {item.color && <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: item.color }} />}
              {item.label}
            </button>
          ))}
        </div>
        {children}
      </div>
    );
  }

  // Collapsed state: render nothing, the header toggle button controls visibility
  return null;
};
