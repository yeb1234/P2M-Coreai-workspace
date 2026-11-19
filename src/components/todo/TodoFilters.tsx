import React, { type ReactNode } from 'react';
import { Filter, Search } from 'lucide-react';
import type { TodoPriority, TodoStatus } from '../../types';
import { PRIORITY_COLORS, PRIORITY_LABELS } from '../../types';
import { useScheduleStore } from '../../stores';
import { useIsMobile } from '../../hooks/useMediaQuery';

interface TodoFiltersProps {
  collapsed: boolean;
  onToggle: () => void;
  children?: ReactNode;
}

export const TodoFilters: React.FC<TodoFiltersProps> = ({ collapsed, children }) => {
  const { filter, setFilter } = useScheduleStore();
  const isMobile = useIsMobile();

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
              className={`px-2 py-0.5 text-xs rounded-full transition-colors ${
                filter.status === item.value ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-base)] text-[var(--text-secondary)]'
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
              className={`px-2 py-0.5 text-xs rounded-full transition-colors flex items-center gap-1 ${
                filter.priority === item.value ? 'text-white' : 'bg-[var(--bg-base)] text-[var(--text-secondary)]'
              }`}
              style={{ backgroundColor: filter.priority === item.value ? (item.value ? PRIORITY_COLORS[item.value] : '#c87d2f') : undefined }}
            >
              {item.color && <span className="w-2 h-2 rounded-lg flex-shrink-0" style={{ backgroundColor: item.color }} />}
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
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={filter.searchQuery}
            onChange={(event) => setFilter({ searchQuery: event.target.value })}
            className="w-full pl-9 pr-3 py-2 border border-[var(--border-light)] rounded-lg focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent outline-none transition-all text-sm bg-[var(--bg-elevated)]"
            placeholder="搜索待办事项..."
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-1.5">
            <Filter size={14} className="text-[var(--text-muted)]" />
            <span className="text-xs text-[var(--text-secondary)]">状态</span>
          </div>
          {statuses.map((item) => (
            <button
              key={item.value}
              onClick={() => setFilter({ status: item.value })}
              className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                filter.status === item.value ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-base)] text-[var(--text-secondary)] hover:bg-[var(--border-light)]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-1.5">
            <Filter size={14} className="text-[var(--text-muted)]" />
            <span className="text-xs text-[var(--text-secondary)]">便签</span>
          </div>
          {priorities.map((item) => (
            <button
              key={item.value || 'all'}
              onClick={() => setFilter({ priority: item.value })}
              className={`px-2.5 py-1 text-xs rounded-full transition-colors flex items-center gap-1.5 ${
                filter.priority === item.value ? 'text-white' : 'bg-[var(--bg-base)] text-[var(--text-secondary)] hover:bg-[var(--border-light)]'
              }`}
              style={{ backgroundColor: filter.priority === item.value ? (item.value ? PRIORITY_COLORS[item.value] : '#c87d2f') : undefined }}
            >
              {item.color && <span className="w-2.5 h-2.5 rounded-lg flex-shrink-0" style={{ backgroundColor: item.color }} />}
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
