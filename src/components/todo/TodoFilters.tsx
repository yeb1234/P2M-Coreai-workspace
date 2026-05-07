import React from 'react';
import { Search, Filter } from 'lucide-react';
import type { TodoPriority, TodoStatus } from '../../types';
import { PRIORITY_COLORS, PRIORITY_LABELS } from '../../types';
import { useTodoStore } from '../../stores';

export const TodoFilters: React.FC = () => {
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

  return (
    <div className="space-y-3">
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
    </div>
  );
};
