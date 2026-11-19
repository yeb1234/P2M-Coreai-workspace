import React from 'react';
import { AlertCircle, ListTodo } from 'lucide-react';
import { useScheduleStore, useUIStore } from '../../../stores';
import { PRIORITY_COLORS } from '../../../types';
import { selectTodoProjection } from '../../../lib/projections/todo';
import { SummaryEmpty } from './SummaryEmpty';

/**
 * 待办卡片 = 待办页（TodoList）同一份投影的渲染。
 * 数字和列表都来自 selectTodoProjection，卡片这边不再自己过滤/排序。
 */
export const TodoSummary: React.FC = () => {
  const items = useScheduleStore((s) => s.items);
  // 拖拽顺序也参与排序，卡片和待办页看到的是同一条"第一条"
  const itemOrder = useScheduleStore((s) => s.itemOrder);
  const { setActiveView } = useUIStore();

  // 不 memo：投影是几十条量级的纯计算，memorize 反而容易漏依赖变成陈旧值
  const projection = selectTodoProjection(items, undefined, itemOrder);
  const { counts, priorityQueue, overdue, completionRate, total } = projection;

  const displayTodos = priorityQueue.slice(0, 3);
  const hasMore = priorityQueue.length > 3;

  return (
    <div className="flex flex-1 flex-col gap-2">
      <div className="auto-grid-compact todo-summary-stats text-center">
        <div className="rounded-lg bg-[var(--bg-base)] px-2 py-1.5">
          <p className="text-xl font-bold tabular-nums text-[var(--accent)]">{counts.pending}</p>
          <p className="text-xs font-medium text-[var(--text-muted)]">待处理</p>
        </div>
        <div className="rounded-lg bg-[var(--bg-base)] px-2 py-1.5">
          <p className="text-xl font-bold tabular-nums text-[var(--info)]">{counts.inProgress}</p>
          <p className="text-xs font-medium text-[var(--text-muted)]">进行中</p>
        </div>
        <div className="rounded-lg bg-[var(--bg-base)] px-2 py-1.5">
          <p className="text-xl font-bold tabular-nums text-[var(--success)]">{counts.completed}</p>
          <p className="text-xs font-medium text-[var(--text-muted)]">已完成</p>
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
                {isLast ? `...还有 ${priorityQueue.length - 2} 项` : todo.title}
              </span>
            </div>
          );
        })}
        {priorityQueue.length === 0 && (
          <SummaryEmpty
            icon={<ListTodo size={16} />}
            title="暂无待办"
            hint="在待办页回车即可添加"
            onClick={() => setActiveView('todo')}
          />
        )}
      </div>

      {overdue.length > 0 && (
        <div className="flex items-center gap-2 text-[var(--danger)] text-xs bg-[var(--danger-bg)] rounded-lg p-2 font-medium">
          <AlertCircle size={14} />
          <span>{overdue.length} 项已过期</span>
        </div>
      )}
    </div>
  );
};
