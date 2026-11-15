import React from 'react';
import { AlertCircle, ListTodo } from 'lucide-react';
import { useScheduleStore, useUIStore } from '../../../stores';
import { PRIORITY_COLORS } from '../../../types';
import { toLocalDateString } from '../../../lib/date';
import { datePart, hasScheduleTime } from '../../../lib/scheduleTime';

export const TodoSummary: React.FC = () => {
  const items = useScheduleStore((s) => s.items);
  const { setActiveView } = useUIStore();
  const allTodos = Object.values(items).filter((item) => item.type === 'todo' && !item.deletedAt);
  const pending = allTodos.filter((t) => t.status === 'pending').length;
  const inProgress = allTodos.filter((t) => t.status === 'in_progress').length;
  const completed = allTodos.filter((t) => t.status === 'completed').length;
  const total = allTodos.length;
  const today = toLocalDateString(new Date());
  const overdue = allTodos.filter(
    (t) => hasScheduleTime(t) && datePart(t.dueAt) < today && t.status !== 'completed'
  ).length;

  const urgentTodos = allTodos
    .filter((t) => t.status !== 'completed')
    .sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2, green: 3 };
      return (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3);
    });

  const displayTodos = urgentTodos.slice(0, 3);
  const hasMore = urgentTodos.length > 3;
  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="space-y-3">
      <div className="auto-grid-compact text-center">
        <div className="bg-[var(--bg-accent)] rounded-lg p-2">
          <p className="text-xl font-bold text-[var(--accent)]">{pending}</p>
          <p className="text-[10px] font-medium text-[#92400e]">待处理</p>
        </div>
        <div className="bg-[var(--info-bg)] rounded-lg p-2">
          <p className="text-xl font-bold text-[var(--info)]">{inProgress}</p>
          <p className="text-[10px] font-medium text-[#1e40af]">进行中</p>
        </div>
        <div className="bg-[var(--success-bg)] rounded-lg p-2">
          <p className="text-xl font-bold text-[var(--success)]">{completed}</p>
          <p className="text-[10px] font-medium text-[#166534]">已完成</p>
        </div>
      </div>

      {total > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span>完成度</span>
            <span className="font-semibold text-[var(--text-primary)]">{completionRate}%</span>
          </div>
          <div className="w-full bg-[var(--border-light)] rounded-full h-1.5">
            <div
              className="bg-gradient-to-r from-[var(--accent)] to-[var(--accent)] h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${completionRate}%` }}
            />
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
          <ListTodo size={12} />
          <span>待办优先</span>
        </div>
        {displayTodos.map((todo, idx) => {
          const isLast = idx === 2 && hasMore;
          const color = PRIORITY_COLORS[todo.priority] || PRIORITY_COLORS.medium;
          return (
            <div
              key={todo.id}
              className={`flex items-center gap-2 text-xs p-2 rounded-lg cursor-pointer hover:shadow-sm transition-all ${
                isLast ? 'hover:bg-[var(--bg-accent)]' : ''
              }`}
              style={{
                background: `linear-gradient(135deg, ${color}20 0%, ${color}08 100%)`,
                borderLeft: `3px solid ${color}`,
              }}
              onClick={() => {
                if (isLast) setActiveView('todo');
              }}
            >
              <span className={`truncate ${isLast ? 'text-[var(--text-muted)]' : 'text-[var(--text-primary)]'} font-medium`}>
                {isLast ? `...还有 ${urgentTodos.length - 2} 项` : todo.title}
              </span>
            </div>
          );
        })}
        {urgentTodos.length === 0 && (
          <p className="text-xs text-[var(--text-muted)] text-center py-2">暂无待办</p>
        )}
      </div>

      {overdue > 0 && (
        <div className="flex items-center gap-2 text-[var(--danger)] text-xs bg-[var(--danger-bg)] rounded-lg p-2 font-medium">
          <AlertCircle size={14} />
          <span>{overdue} 项已过期</span>
        </div>
      )}
    </div>
  );
};
