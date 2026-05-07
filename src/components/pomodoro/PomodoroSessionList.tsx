import React, { useState, useMemo, useCallback } from 'react';
import { Clock, CheckCircle, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { usePomodoroStore, useTodoStore } from '../../stores';
import { formatDate, formatDuration } from '../../lib/date';
import { PHASE_LABELS } from '../../types';

const INITIAL_LIMIT = 5;

export const PomodoroSessionList: React.FC = () => {
  const sessions = usePomodoroStore((s) => s.sessions);
  const clearHistory = usePomodoroStore((s) => s.clearHistory);
  const todos = useTodoStore((s) => s.todos);
  const [expanded, setExpanded] = useState(false);

  const completedSessions = useMemo(() =>
    Object.values(sessions || {})
      .filter((s) => s.completed)
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()),
    [sessions]);

  const toggleExpanded = useCallback(() => setExpanded((e) => !e), []);

  if (completedSessions.length === 0) {
    return (
      <div className="text-center py-8 text-[#9ca3af]">
        <Clock size={32} className="mx-auto mb-2" />
        <p>暂无专注记录</p>
      </div>
    );
  }

  const visibleSessions = expanded ? completedSessions : completedSessions.slice(0, INITIAL_LIMIT);
  const hasMore = completedSessions.length > INITIAL_LIMIT;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-[#1a1a1a]">专注记录</h3>
        <button
          onClick={clearHistory}
          className="flex items-center gap-1 text-xs text-[#9ca3af] hover:text-[#dc3545] transition-colors"
        >
          <Trash2 size={12} />
          清空
        </button>
      </div>

      <div className="space-y-2">
        {visibleSessions.map((session) => {
          const todo = session.todoId ? todos[session.todoId] : null;
          return (
            <div key={session.id} className="flex items-center gap-3 p-3 bg-[#f3f2ef] rounded-lg">
              <CheckCircle size={16} className="text-[#16a34a] flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[#1a1a1a]">
                    {PHASE_LABELS[session.phase]}
                  </span>
                  <span className="text-xs text-[#9ca3af]">
                    {formatDuration(session.actualDuration)}
                  </span>
                </div>
                {todo && (
                  <p className="text-xs text-[#6b7280] truncate">{todo.title}</p>
                )}
              </div>
              <span className="text-xs text-[#9ca3af] flex-shrink-0">
                {formatDate(session.startTime, 'HH:mm')}
              </span>
            </div>
          );
        })}
      </div>

      {hasMore && (
        <button
          onClick={toggleExpanded}
          className="w-full flex items-center justify-center gap-1 py-2 text-xs text-[#9ca3af] hover:text-[#c87d2f] transition-colors"
        >
          {expanded ? (
            <>收起 <ChevronUp size={14} /></>
          ) : (
            <>展开剩余 {completedSessions.length - INITIAL_LIMIT} 条 <ChevronDown size={14} /></>
          )}
        </button>
      )}
    </div>
  );
};
