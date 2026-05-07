import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Check, Clock, Trash2, Play, Edit, Calendar, GripVertical } from 'lucide-react';
import type { Todo, TodoPriority } from '../../types';
import { useTodoStore, usePomodoroStore, useUIStore } from '../../stores';
import { formatDate, formatDuration } from '../../lib/date';
import { TodoBadge } from './TodoBadge';

const STICKY_COLORS: Record<string, string> = {
  high: '#e8a0a0',
  medium: '#e8d4a0',
  low: '#a0c4e8',
  green: '#a0d4a0',
};

const STATUS_ICONS = {
  pending: <div className="w-5 h-5 border-2 border-[#d1cdc6] rounded-full" />,
  in_progress: <div className="w-5 h-5 border-2 border-[#c87d2f] rounded-full bg-[#fef7ed]" />,
  completed: <Check size={20} className="text-[#16a34a]" />,
};

interface TodoItemProps {
  todo: Todo;
  onEdit: (todo: Todo) => void;
  onDragStart?: (id: string) => void;
  onDragOver?: (id: string) => void;
  onDrop?: (id: string) => void;
  onDragEnd?: () => void;
  isDragging?: boolean;
  isDropTarget?: boolean;
}

export const TodoItem: React.FC<TodoItemProps> = React.memo(({ todo, onEdit, onDragStart, onDragOver, onDrop, onDragEnd, isDragging, isDropTarget }) => {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const editRef = useRef<HTMLInputElement>(null);
  const toggleTodoStatus = useTodoStore((s) => s.toggleTodoStatus);
  const deleteTodo = useTodoStore((s) => s.deleteTodo);
  const updateTodo = useTodoStore((s) => s.updateTodo);
  const startTimer = usePomodoroStore((s) => s.startTimer);
  const linkToTodo = usePomodoroStore((s) => s.linkToTodo);
  const config = usePomodoroStore((s) => s.config);
  const setActiveView = useUIStore((s) => s.setActiveView);

  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus();
      editRef.current.select();
    }
  }, [editing]);

  const startInlineEdit = useCallback(() => {
    setEditValue(todo.title);
    setEditing(true);
  }, [todo.title]);

  const commitEdit = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== todo.title) {
      updateTodo(todo.id, { title: trimmed });
    }
    setEditing(false);
  }, [editValue, todo.id, todo.title, updateTodo]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setEditValue('');
  }, []);

  const { plannedMinutes, completedMinutes } = useMemo(() => {
    const { workDuration, shortBreakDuration, longBreakDuration, longBreakInterval } = config;
    const N = longBreakInterval;

    const totalPomodoros = todo.pomodoroRounds;
    const workMin = totalPomodoros * (workDuration + shortBreakDuration) - shortBreakDuration;
    const rounds = Math.ceil(totalPomodoros / N);
    const longBreaks = Math.max(0, rounds - 1);
    const planned = workMin + longBreaks * longBreakDuration;

    const count = todo.pomodoroCount;
    let completed = 0;
    if (count > 0) {
      const cWorkMin = count * (workDuration + shortBreakDuration) - shortBreakDuration;
      const cLongBreaks = Math.floor(count / N);
      completed = cWorkMin + cLongBreaks * longBreakDuration;
    }

    return { plannedMinutes: planned, completedMinutes: completed };
  }, [config, todo.pomodoroRounds, todo.pomodoroCount]);

  const handleStartPomodoro = useCallback(() => {
    linkToTodo(todo.id);
    startTimer(todo.id);
    if (todo.status === 'pending') {
      updateTodo(todo.id, { status: 'in_progress' });
    }
    setActiveView('pomodoro');
  }, [todo.id, todo.status, linkToTodo, startTimer, updateTodo, setActiveView]);

  const stickyColor = STICKY_COLORS[todo.priority] || STICKY_COLORS.medium;

  const cardStyle = useMemo(() => ({
    background: `linear-gradient(160deg, ${stickyColor}30 0%, ${stickyColor}15 50%, ${stickyColor}08 100%)`,
    borderLeftWidth: '5px',
    borderLeftColor: stickyColor,
    borderColor: `${stickyColor}50`,
    boxShadow: `2px 2px 0px ${stickyColor}20, 0 1px 3px rgba(0,0,0,0.04)`,
  }), [stickyColor]);

  const progressBarStyle = useMemo(() => ({
    width: `${Math.min(100, (todo.pomodoroCount / todo.pomodoroRounds) * 100)}%`,
    backgroundColor: todo.pomodoroCount >= todo.pomodoroRounds ? '#16a34a' : '#c87d2f',
  }), [todo.pomodoroCount, todo.pomodoroRounds]);

  return (
    <>
      <div
        data-todo-card
        className={`group flex items-start gap-3 p-3 rounded-lg border transition-all cursor-default ${
          todo.status === 'completed' ? 'opacity-50' : ''
        } ${isDragging ? 'opacity-60 shadow-xl scale-[1.02] z-10' : 'hover:shadow-md'} ${isDropTarget ? 'ring-2 ring-[#c87d2f] ring-offset-1' : ''}`}
        style={cardStyle}
        onDoubleClick={startInlineEdit}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          onDragOver?.(todo.id);
        }}
        onDrop={(e) => {
          e.preventDefault();
          onDrop?.(todo.id);
        }}
      >
        <div
          className="flex-shrink-0 mt-0.5 cursor-grab text-[#d1cdc6] hover:text-[#9ca3af] transition-colors px-0.5 py-1 rounded"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', todo.id);
            const card = (e.target as HTMLElement).closest('[data-todo-card]') as HTMLElement;
            if (card) {
              const clone = card.cloneNode(true) as HTMLElement;
              clone.style.position = 'fixed';
              clone.style.top = '-9999px';
              clone.style.left = '-9999px';
              clone.style.width = `${card.offsetWidth}px`;
              clone.style.boxShadow = '0 12px 28px rgba(0,0,0,0.18), 0 4px 10px rgba(0,0,0,0.1)';
              clone.style.transform = 'rotate(2deg) scale(1.03)';
              clone.style.opacity = '0.92';
              clone.style.zIndex = '9999';
              clone.style.borderRadius = '12px';
              document.body.appendChild(clone);
              const gripRect = (e.target as HTMLElement).getBoundingClientRect();
              const offsetX = gripRect.left - card.getBoundingClientRect().left + gripRect.width / 2;
              e.dataTransfer.setDragImage(clone, offsetX, 24);
              requestAnimationFrame(() => document.body.removeChild(clone));
            }
            onDragStart?.(todo.id);
          }}
          onDragEnd={() => onDragEnd?.()}
        >
          <GripVertical size={14} />
        </div>
        <button
          onClick={() => toggleTodoStatus(todo.id)}
          className="mt-0.5 flex-shrink-0 hover:scale-110 transition-transform"
        >
          {STATUS_ICONS[todo.status]}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {editing ? (
              <input
                ref={editRef}
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
                  else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                }}
                className="flex-1 min-w-0 px-1 py-0.5 text-sm font-medium text-[#1a1a1a] bg-white border border-[#c87d2f] rounded outline-none"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <h3
                className={`font-medium text-[#1a1a1a] truncate ${
                  todo.status === 'completed' ? 'line-through text-[#9ca3af]' : ''
                }`}
              >
                {todo.title}
              </h3>
            )}
            <TodoBadge priority={todo.priority} />
          </div>

          {todo.description && (
            <p className="text-sm text-[#9ca3af] truncate mb-2">{todo.description}</p>
          )}

          <div className="flex items-center gap-4 text-xs text-[#9ca3af]">
            {todo.dueDate && (
              <span className="flex items-center gap-1">
                <Calendar size={12} />
                {formatDate(todo.dueDate, 'MM月dd日')}
              </span>
            )}
            {todo.pomodoroCount > 0 && (
              <span className="flex items-center gap-1 text-[#16a34a]">
                <Clock size={12} />
                {todo.pomodoroCount}个番茄 ({formatDuration(todo.totalFocusMinutes)})
              </span>
            )}
          </div>
          {todo.pomodoroRounds > 0 && (
            <div className="mt-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-[#e5e2dd] rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={progressBarStyle} />
                </div>
                <span className="text-[10px] text-[#9ca3af] flex-shrink-0">
                  {todo.pomodoroCount}/{todo.pomodoroRounds} 番茄
                </span>
              </div>
              <div className="text-[10px] text-[#b8b4ac] mt-0.5">
                预计 {formatDuration(plannedMinutes)}
                {todo.pomodoroCount > 0 && ` · 已用 ${formatDuration(completedMinutes)}`}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {todo.status !== 'completed' && (
            <button
              onClick={handleStartPomodoro}
              className="p-1.5 rounded-lg hover:bg-[#f0fdf4] text-[#9ca3af] hover:text-[#16a34a] transition-colors"
              title="开始专注"
            >
              <Play size={16} />
            </button>
          )}
          <button
            onClick={() => onEdit(todo)}
            className="p-1.5 rounded-lg hover:bg-[#fef7ed] text-[#9ca3af] hover:text-[#c87d2f] transition-colors"
            title="编辑"
          >
            <Edit size={16} />
          </button>
          <button
            onClick={() => deleteTodo(todo.id)}
            className="p-1.5 rounded-lg hover:bg-[#fef2f2] text-[#9ca3af] hover:text-[#dc3545] transition-colors"
            title="删除"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </>
  );
});
