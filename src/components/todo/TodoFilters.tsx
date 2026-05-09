import React, { type ReactNode } from 'react';
import { Search, Filter, ChevronDown, ChevronRight, SlidersHorizontal } from 'lucide-react';
import type { TodoPriority, TodoStatus } from '../../types';
import { PRIORITY_COLORS, PRIORITY_LABELS } from '../../types';
import { useTodoStore } from '../../stores';

interface TodoFiltersProps {
  collapsed: boolean;
  onToggle: () => void;
  children?: ReactNode;
}

export const TodoFilters: React.FC<TodoFiltersProps> = ({ collapsed, onToggle, children }) => {
  const { filter, setFilter } = useTodoStore();

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

  const activeStatus = statuses.find((s) => s.value === filter.status)?.label || '全部';
  const activePriority = filter.priority ? PRIORITY_LABELS[filter.priority] : '全部';

  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 py-1 text-xs font-medium text-[#6b7280] hover:text-[#1a1a1a] transition-colors"
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        <SlidersHorizontal size={13} />
        <span>筛选设置</span>
        {collapsed && <span className="text-[#9ca3af] font-normal">状态: {activeStatus} / 便签: {activePriority}</span>}
      </button>
      {!collapsed && (
        <div className="space-y-3 mt-1">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
            <input
              type="text"
              value={filter.searchQuery}
              onChange={(e) => setFilter({ searchQuery: e.target.value })}
              className="w-full pl-9 pr-3 py-2 border border-[#e5e2dd] rounded-lg focus:ring-2 focus:ring-[#c87d2f] focus:border-transparent outline-none transition-all text-sm bg-[#faf9f7]"
              placeholder="搜索待办事项..."
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="flex items-center gap-1.5">
              <Filter size={14} className="text-[#9ca3af]" />
              <span className="text-xs text-[#6b7280]">状态:</span>
            </div>
            {statuses.map((s) => (
              <button
                key={s.value}
                onClick={() => setFilter({ status: s.value })}
                className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                  filter.status === s.value
                    ? 'bg-[#c87d2f] text-white'
                    : 'bg-[#f3f2ef] text-[#6b7280] hover:bg-[#e5e2dd]'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="flex items-center gap-1.5">
              <Filter size={14} className="text-[#9ca3af]" />
              <span className="text-xs text-[#6b7280]">便签:</span>
            </div>
            {priorities.map((p) => (
              <button
                key={p.value || 'all'}
                onClick={() => setFilter({ priority: p.value })}
                className={`px-2.5 py-1 text-xs rounded-full transition-colors flex items-center gap-1.5 ${
                  filter.priority === p.value
                    ? 'text-white'
                    : 'bg-[#f3f2ef] text-[#6b7280] hover:bg-[#e5e2dd]'
                }`}
                style={{
                  backgroundColor: filter.priority === p.value ? (p.value ? PRIORITY_COLORS[p.value] : '#c87d2f') : undefined,
                }}
              >
                {p.color && (
                  <span
                    className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: p.color }}
                  />
                )}
                {p.label}
              </button>
            ))}
          </div>
          {children}
        </div>
      )}
    </div>
  );
};
