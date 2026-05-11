import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Check, Clock, Trash2, Play, Edit, Calendar, GripVertical } from 'lucide-react';
import type { Todo } from '../../types';
import { useTodoStore, usePomodoroStore } from '../../stores';
import { formatDate, formatDuration } from '../../lib/date';
import { playInteractionSound, playNotificationSound } from '../../lib/sounds';
import { TodoBadge } from './TodoBadge';
import { ConfirmDialog } from '../shared';

const STICKY_COLORS: Record<string, string> = {
  high: '#e8a0a0',
  medium: '#e8d4a0',
  low: '#a0c4e8',
  green: '#a0d4a0',
};


interface TodoItemProps {
  todo: Todo;
  onEdit: (todo: Todo) => void;
  onDragStart?: (id: string) => void;
  onDragOver?: (id: string, position: 'top' | 'bottom') => void;
  onDrop?: (id: string) => void;
  onDragEnd?: () => void;
  isDragging?: boolean;
  isDropTarget?: boolean;
  dropPosition?: 'top' | 'bottom';
}

export const TodoItem: React.FC<TodoItemProps> = React.memo(({ todo, onEdit, onDragStart, onDragOver, onDrop, onDragEnd, isDragging, isDropTarget, dropPosition }) => {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showOverrideConfirm, setShowOverrideConfirm] = useState(false);
  const [toggleHover, setToggleHover] = useState(false);
  const editRef = useRef<HTMLInputElement>(null);
  const toggleTodoStatus = useTodoStore((s) => s.toggleTodoStatus);
  const deleteTodo = useTodoStore((s) => s.deleteTodo);
  const updateTodo = useTodoStore((s) => s.updateTodo);
  const startTimer = usePomodoroStore((s) => s.startTimer);
  const linkToTodo = usePomodoroStore((s) => s.linkToTodo);
  const resetTimer = usePomodoroStore((s) => s.resetTimer);
  const config = usePomodoroStore((s) => s.config);
  const timer = usePomodoroStore((s) => s.timer);
  const todos = useTodoStore((s) => s.todos);


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
      playInteractionSound('save');
    }
    setEditing(false);
  }, [editValue, todo.id, todo.title, updateTodo]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setEditValue('');
  }, []);

  const totalPomodoros = Math.max(0, todo.pomodoroRounds || 0);

  const { plannedMinutes, completedMinutes } = useMemo(() => {
    const { workDuration, shortBreakDuration, longBreakDuration, longBreakInterval } = config;
    const plannedPomodoros = Math.max(0, todo.pomodoroRounds || 0);
    const plannedShortBreaks = Math.max(0, plannedPomodoros - 1);
    const plannedLongBreaks = Math.max(0, Math.floor((plannedPomodoros - 1) / longBreakInterval));
    const planned = plannedPomodoros * workDuration
      + plannedShortBreaks * shortBreakDuration
      + plannedLongBreaks * longBreakDuration;

    const completedPomodoros = Math.max(0, Math.min(todo.pomodoroCount, plannedPomodoros));
    const completedShortBreaks = Math.max(0, completedPomodoros - 1);
    const completedLongBreaks = Math.max(0, Math.floor((completedPomodoros - 1) / longBreakInterval));
    const completed = completedPomodoros * workDuration
      + completedShortBreaks * shortBreakDuration
      + completedLongBreaks * longBreakDuration;

    return { plannedMinutes: planned, completedMinutes: completed };
  }, [config, todo.pomodoroRounds, todo.pomodoroCount]);

  const doStartPomodoro = useCallback(() => {
    linkToTodo(todo.id);
    startTimer(todo.id);
    playNotificationSound();
    if (todo.status === 'pending') {
      updateTodo(todo.id, { status: 'in_progress' });
    }
  }, [todo.id, todo.status, linkToTodo, startTimer, updateTodo]);

  const handleStartPomodoro = useCallback(() => {
    const isRunning = timer.status === 'running';
    const linkedTodoId = timer.linkedTodoId;
    const isRunningOnDifferentTodo = isRunning && linkedTodoId && linkedTodoId !== todo.id;

    if (isRunningOnDifferentTodo) {
      setShowOverrideConfirm(true);
    } else if (todo.pomodoroCount > 0) {
      setShowResetConfirm(true);
    } else {
      doStartPomodoro();
    }
  }, [todo.pomodoroCount, todo.id, timer.status, timer.linkedTodoId, doStartPomodoro]);

  const handleConfirmReset = useCallback(() => {
    resetTimer();
    updateTodo(todo.id, { pomodoroCount: 0, totalFocusMinutes: 0 });
    doStartPomodoro();
  }, [todo.id, resetTimer, updateTodo, doStartPomodoro]);

  const handleConfirmOverride = useCallback(() => {
    resetTimer();
    doStartPomodoro();
  }, [resetTimer, doStartPomodoro]);

  const stickyColor = STICKY_COLORS[todo.priority] || STICKY_COLORS.medium;

  const cardStyle = useMemo(() => ({
    background: `linear-gradient(160deg, ${stickyColor}30 0%, ${stickyColor}15 50%, ${stickyColor}08 100%)`,
    borderLeftWidth: '5px',
    borderLeftColor: stickyColor,
    borderColor: `${stickyColor}50`,
    boxShadow: `2px 2px 0px ${stickyColor}20, 0 1px 3px rgba(0,0,0,0.04)`,
  }), [stickyColor]);

  const progressBarStyle = useMemo(() => ({
    width: `${totalPomodoros > 0 ? Math.min(100, (todo.pomodoroCount / totalPomodoros) * 100) : 0}%`,
    backgroundColor: totalPomodoros > 0 && todo.pomodoroCount >= totalPomodoros ? '#16a34a' : '#c87d2f',
  }), [todo.pomodoroCount, totalPomodoros]);

  return (
    <>
      <div
        data-todo-card
        className={`group relative flex items-center gap-2 md:gap-3 px-2.5 py-1.5 md:px-3 md:py-3 rounded-lg border transition-all cursor-default ${
          todo.status === 'completed' ? 'opacity-50' : ''
        } ${isDragging ? 'opacity-60 shadow-xl scale-[1.02] z-10' : 'hover:shadow-md'}`}
        style={cardStyle}
        onDoubleClick={startInlineEdit}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          const rect = e.currentTarget.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          const position = e.clientY < midY ? 'top' : 'bottom';
          onDragOver?.(todo.id, position);
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
              const gripRect = (e.target as HTMLElement).getBoundingClientRect();
              const cardRect = card.getBoundingClientRect();
              e.dataTransfer.setDragImage(card, gripRect.left - cardRect.left + gripRect.width / 2, gripRect.top - cardRect.top + gripRect.height / 2);
            }
            onDragStart?.(todo.id);
          }}
          onDragEnd={() => onDragEnd?.()}
        >
          <GripVertical size={14} />
        </div>
        <button
          onClick={() => {
            toggleTodoStatus(todo.id);
            playInteractionSound(todo.status === 'completed' ? 'restore' : 'complete');
          }}
          onMouseEnter={() => setToggleHover(true)}
          onMouseLeave={() => setToggleHover(false)}
          className="mt-0.5 flex-shrink-0 hover:scale-110 transition-transform"
        >
          {todo.status === 'pending' && (
            <div className={`w-4 h-4 md:w-5 md:h-5 border-2 rounded-full transition-colors ${toggleHover ? 'border-[#c87d2f]' : 'border-[#d1cdc6]'}`} />
          )}
          {todo.status === 'in_progress' && (
            <div className="w-4 h-4 md:w-5 md:h-5 border-2 border-[#c87d2f] rounded-full bg-[#fef7ed]" />
          )}
          {todo.status === 'completed' && (
            <div className="w-4 h-4 md:w-5 md:h-5 bg-[#16a34a] rounded-full flex items-center justify-center">
              <Check size={11} className="text-white" strokeWidth={3} />
            </div>
          )}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 md:gap-2 mb-0 md:mb-1">
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
                className={`font-medium text-[#1a1a1a] truncate text-[16px] md:text-sm ${
                  todo.status === 'completed' ? 'line-through text-[#9ca3af]' : ''
                }`}
              >
                {todo.title}
              </h3>
            )}
            <TodoBadge priority={todo.priority} />
          </div>

          {todo.description && (
            <p className="text-[13px] md:text-sm text-[#9ca3af] truncate mb-0.5 md:mb-2">{todo.description}</p>
          )}

          <div className="flex items-center gap-3 md:gap-4 text-[12px] md:text-xs text-[#9ca3af]">
            {todo.dueDate && (
              <span className="flex items-center gap-1">
                <Calendar size={12} />
                {formatDate(todo.dueDate, 'MM月dd日')}
              </span>
            )}
            {todo.reminderAt && (
              <span className="flex items-center gap-1">
                <Clock size={12} />
                提醒 {new Date(todo.reminderAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            {todo.pomodoroRounds > 0 && (
              <span className="flex items-center gap-1 text-[#16a34a]">
                <Clock size={12} />
                {todo.pomodoroRounds - todo.pomodoroCount > 0
                  ? `剩余${todo.pomodoroRounds - todo.pomodoroCount}个番茄`
                  : '已完成'}
              </span>
            )}
          </div>
          {todo.pomodoroRounds > 0 && (
            <div className="hidden md:block mt-1 md:mt-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1 md:h-1.5 bg-[#e5e2dd] rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={progressBarStyle} />
                </div>
                <span className="text-[9px] md:text-[10px] text-[#9ca3af] flex-shrink-0">
                  {todo.pomodoroCount}/{totalPomodoros}
                </span>
              </div>
              <div className="text-[9px] md:text-[10px] text-[#b8b4ac] mt-0.5">
                预计 {formatDuration(plannedMinutes)}
                {todo.pomodoroCount > 0 && ` · 已用 ${formatDuration(completedMinutes)}`}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {todo.status !== 'completed' && todo.pomodoroRounds > 0 && (
            <button
              onClick={handleStartPomodoro}
              className="p-1.5 rounded-lg hover:bg-[#f0fdf4] text-[#9ca3af] hover:text-[#16a34a] transition-colors"
              title="开始专注"
            >
              <Play size={16} />
            </button>
          )}
          <button
            onClick={() => {
              playInteractionSound('tap');
              onEdit(todo);
            }}
            className="p-1.5 rounded-lg hover:bg-[#fef7ed] text-[#9ca3af] hover:text-[#c87d2f] transition-colors"
            title="编辑"
          >
            <Edit size={16} />
          </button>
          <button
            onClick={() => {
              deleteTodo(todo.id);
              playInteractionSound('delete');
            }}
            className="p-1.5 rounded-lg hover:bg-[#fef2f2] text-[#9ca3af] hover:text-[#dc3545] transition-colors"
            title="删除"
          >
            <Trash2 size={16} />
          </button>
        </div>
        {isDropTarget && (
          <div
            className={`absolute left-2 right-2 h-0.5 bg-[#b8b4ac] rounded-full pointer-events-none ${
              dropPosition === 'top' ? '-top-px' : '-bottom-px'
            }`}
            style={{ boxShadow: '0 0 4px rgba(184,180,172,0.4)' }}
          />
        )}
      </div>
      <ConfirmDialog
        isOpen={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        onConfirm={handleConfirmReset}
        title="重新开始番茄"
        message={`该待办已完成 ${todo.pomodoroCount} 个番茄，确认重置并重新开始？`}
        confirmText="重置并开始"
        variant="warning"
      />
      <ConfirmDialog
        isOpen={showOverrideConfirm}
        onClose={() => setShowOverrideConfirm(false)}
        onConfirm={handleConfirmOverride}
        title="替换当前番茄钟"
        message={`当前正在「${timer.linkedTodoId ? todos[timer.linkedTodoId]?.title || '其他待办' : '未关联待办'}」上专注，确认替换为「${todo.title}」？`}
        confirmText="替换并开始"
        variant="warning"
      />
    </>
  );
});
