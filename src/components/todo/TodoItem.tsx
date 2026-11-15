import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { Check, Clock, Trash2, Play, Edit, Calendar, GripVertical } from 'lucide-react';
import type { ScheduleItem } from '../../types';
import { usePomodoroStore, useScheduleStore } from '../../stores';
import { POMODORO_VIRTUAL_TODO_ID } from '../../stores/pomodoroStore';
import { formatDate, formatDuration } from '../../lib/date';
import { dateTimeParts, hasScheduleTime } from '../../lib/scheduleTime';
import { getSchedulePomodoroPlan, getPlannedMinutesForRounds } from '../../lib/pomodoroPlanning';
import { playInteractionSound, playNotificationSound } from '../../lib/sounds';
import { resetAmbientSoundSelection } from '../../hooks/useAmbientSoundController';
import { TodoBadge } from './TodoBadge';
import { ConfirmDialog } from '../shared';

const STICKY_COLORS: Record<string, string> = {
  high: '#e8a0a0',
  medium: '#e8d4a0',
  low: '#a0c4e8',
  green: '#a0d4a0',
};

interface TodoItemProps {
  todo: ScheduleItem;
  onEdit: (todo: ScheduleItem) => void;
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
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showOverrideConfirm, setShowOverrideConfirm] = useState(false);
  const [toggleHover, setToggleHover] = useState(false);
  const editRef = useRef<HTMLInputElement>(null);
  const toggleStatus = useScheduleStore((s) => s.toggleStatus);
  const deleteItem = useScheduleStore((s) => s.deleteItem);
  const updateItem = useScheduleStore((s) => s.updateItem);
  const startTimer = usePomodoroStore((s) => s.startTimer);
  const linkToTodo = usePomodoroStore((s) => s.linkToTodo);
  const resetTimer = usePomodoroStore((s) => s.resetTimer);
  const updateAmbientSound = usePomodoroStore((s) => s.updateAmbientSound);
  const config = usePomodoroStore((s) => s.config);
  const timerStatus = usePomodoroStore((s) => s.timer.status);
  const linkedTodoId = usePomodoroStore((s) => s.timer.linkedTodoId);
  const linkedTodoTitle = useScheduleStore((s) => linkedTodoId ? s.items[linkedTodoId]?.title : undefined);
  const hasTimeRange = hasScheduleTime(todo);
  const startParts = todo.startAt ? dateTimeParts(todo.startAt) : null;
  const dueParts = todo.dueAt ? dateTimeParts(todo.dueAt) : null;
  const pomodoroPlan = useMemo(() => getSchedulePomodoroPlan(todo, config), [config, todo]);
  const plannedRounds = pomodoroPlan.rounds;

  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus();
      editRef.current.select();
    }
  }, [editing]);

  const commitEdit = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== todo.title) {
      updateItem(todo.id, { title: trimmed });
      playInteractionSound('save');
    }
    setEditing(false);
  }, [editValue, todo.id, todo.title, updateItem]);

  // 有排期时才显示预计信息；未排期 todo 不显示预计，但点运行时走 1 轮
  const effectiveRounds = hasTimeRange
    ? Math.max(1, todo.pomodoroRounds > 0 ? todo.pomodoroRounds : plannedRounds)
    : 0;
  const totalPomodoros = effectiveRounds;
  const { plannedMinutes, completedMinutes } = useMemo(() => {
    const planned = getPlannedMinutesForRounds(effectiveRounds, config);
    const completedPomodoros = Math.max(0, Math.min(todo.pomodoroCount, effectiveRounds));
    const completed = getPlannedMinutesForRounds(completedPomodoros, config);
    return { plannedMinutes: planned, completedMinutes: completed };
  }, [config, effectiveRounds, todo.pomodoroCount]);

  const doStartPomodoro = useCallback(() => {
    updateItem(todo.id, {
      status: todo.status === 'pending' ? 'in_progress' : todo.status,
    });
    linkToTodo(todo.id);
    startTimer(todo.id);
    playNotificationSound();
  }, [todo.id, todo.status, linkToTodo, startTimer, updateItem]);

  const resetTimerForTodoStart = useCallback(() => {
    resetAmbientSoundSelection();
    updateAmbientSound('none');
    resetTimer();
  }, [resetTimer, updateAmbientSound]);

  const handleStartPomodoro = useCallback(() => {
    const hasRealTask = timerStatus === 'running' && linkedTodoId && linkedTodoId !== POMODORO_VIRTUAL_TODO_ID;
    const isRunningOnDifferentTodo = hasRealTask && linkedTodoId !== todo.id;

    if (isRunningOnDifferentTodo) {
      setShowOverrideConfirm(true);
    } else if (timerStatus === 'running' && linkedTodoId === todo.id) {
      // 正在专注当前任务，不重复操作
      return;
    } else if (timerStatus === 'running' && (!linkedTodoId || linkedTodoId === POMODORO_VIRTUAL_TODO_ID)) {
      // 当前是虚拟任务或无任务，直接重置并开始
      resetTimerForTodoStart();
      doStartPomodoro();
    } else if (todo.pomodoroCount > 0) {
      setShowResetConfirm(true);
    } else {
      doStartPomodoro();
    }
  }, [todo.pomodoroCount, todo.id, timerStatus, linkedTodoId, doStartPomodoro, resetTimerForTodoStart]);

  const stickyColor = STICKY_COLORS[todo.priority] || STICKY_COLORS.medium;
  const cardStyle = useMemo(() => ({
    background: `linear-gradient(160deg, ${stickyColor}30 0%, ${stickyColor}15 50%, ${stickyColor}08 100%)`,
    borderLeftWidth: '5px',
    borderLeftColor: stickyColor,
    borderColor: `${stickyColor}50`,
    boxShadow: `2px 2px 0px ${stickyColor}20, 0 1px 3px rgba(0,0,0,0.04)`,
  }), [stickyColor]);

  return (
    <>
      <div
        data-todo-card
        className={`group relative flex items-center gap-2 md:gap-3 px-2.5 py-1.5 md:px-3 md:py-3 rounded-lg border transition-all cursor-default ${
          todo.status === 'completed' ? 'opacity-50' : ''
        } ${isDragging ? 'opacity-60 shadow-xl scale-[1.02] z-10' : 'hover:shadow-md'} ${isDropTarget ? 'border-[var(--accent)] bg-[var(--accent-bg)]' : ''}`}
        style={cardStyle}
        onDoubleClick={() => {
          setEditValue(todo.title);
          setEditing(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          onDragOver?.(todo.id);
        }}
        onDrop={(event) => {
          event.preventDefault();
          onDrop?.(todo.id);
        }}
      >
        <div
          className="flex-shrink-0 mt-0.5 cursor-grab text-[var(--border-medium)] hover:text-[var(--text-muted)] transition-colors px-0.5 py-1 rounded"
          draggable
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', todo.id);
            onDragStart?.(todo.id);
          }}
          onDragEnd={() => onDragEnd?.()}
        >
          <GripVertical size={14} />
        </div>

        <button
          onClick={() => {
            toggleStatus(todo.id);
            playInteractionSound(todo.status === 'completed' ? 'restore' : 'complete');
          }}
          onMouseEnter={() => setToggleHover(true)}
          onMouseLeave={() => setToggleHover(false)}
          className="mt-0.5 flex-shrink-0 hover:scale-110 transition-transform"
        >
          {todo.status === 'pending' && <div className={`w-4 h-4 md:w-5 md:h-5 border-2 rounded-full transition-colors ${toggleHover ? 'border-[var(--accent)]' : 'border-[var(--border-medium)]'}`} />}
          {todo.status === 'in_progress' && <div className="w-4 h-4 md:w-5 md:h-5 border-2 border-[var(--accent)] rounded-full bg-[var(--bg-accent)]" />}
          {todo.status === 'completed' && (
            <div className="w-4 h-4 md:w-5 md:h-5 bg-[var(--success)] rounded-full flex items-center justify-center">
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
                onChange={(event) => setEditValue(event.target.value)}
                onBlur={commitEdit}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commitEdit();
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    setEditing(false);
                  }
                }}
                className="flex-1 min-w-0 px-1 py-0.5 text-sm font-medium text-[var(--text-primary)] bg-white border border-[var(--accent)] rounded outline-none"
              />
            ) : (
              <h3 className={`font-medium text-[var(--text-primary)] truncate text-[16px] md:text-sm ${todo.status === 'completed' ? 'line-through text-[var(--text-muted)]' : ''}`}>
                {todo.title}
              </h3>
            )}
            <TodoBadge priority={todo.priority} />
          </div>

          {todo.description && <p className="text-[13px] md:text-sm text-[var(--text-muted)] truncate mb-0.5 md:mb-2">{todo.description}</p>}

          <div className="flex items-center gap-3 md:gap-4 text-[12px] md:text-xs text-[var(--text-muted)]">
            {hasTimeRange ? (
              <>
                <span className="flex items-center gap-1">
                  <Calendar size={12} />
                  {formatDate(todo.startAt, 'MM月dd日')}
                </span>
                <span className="flex items-center gap-1">
                  <Clock size={12} />
                  {startParts?.time} - {dueParts?.time}
                </span>
              </>
            ) : null}
            {effectiveRounds > 0 && (
              <span className="flex items-center gap-1 text-[var(--success)]">
                <Clock size={12} />
                {effectiveRounds - todo.pomodoroCount > 0 ? `预计${effectiveRounds}个番茄钟` : '已完成'}
              </span>
            )}
          </div>

          {effectiveRounds > 0 && (
            <div className="hidden md:block mt-1 md:mt-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1 md:h-1.5 bg-[var(--border-light)] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${totalPomodoros > 0 ? Math.min(100, (todo.pomodoroCount / totalPomodoros) * 100) : 0}%`,
                      backgroundColor: totalPomodoros > 0 && todo.pomodoroCount >= totalPomodoros ? '#16a34a' : '#c87d2f',
                    }}
                  />
                </div>
                <span className="text-[9px] md:text-[10px] text-[var(--text-muted)] flex-shrink-0">{todo.pomodoroCount}/{totalPomodoros}</span>
              </div>
              <div className="text-[9px] md:text-[10px] text-[var(--text-muted)] mt-0.5">
                预计 {formatDuration(plannedMinutes)}
                {todo.pomodoroCount > 0 && ` · 已用 ${formatDuration(completedMinutes)}`}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          {todo.status !== 'completed' && (
            <button onClick={handleStartPomodoro} className="p-1.5 rounded-lg bg-[var(--success-bg)] text-[var(--success)] hover:bg-[#dcfce7] transition-colors" title="开始专注">
              <Play size={16} />
            </button>
          )}
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button onClick={() => { playInteractionSound('tap'); onEdit(todo); }} className="p-1.5 rounded-lg hover:bg-[var(--bg-accent)] text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors" title="编辑">
              <Edit size={16} />
            </button>
            <button onClick={() => { deleteItem(todo.id); playInteractionSound('delete'); }} className="p-1.5 rounded-lg hover:bg-[var(--danger-bg)] text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors" title="删除">
              <Trash2 size={16} />
            </button>
          </div>
        </div>

      </div>

      <ConfirmDialog
        isOpen={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        onConfirm={() => {
          resetTimerForTodoStart();
          updateItem(todo.id, { pomodoroCount: 0, totalFocusMinutes: 0 });
          doStartPomodoro();
        }}
        title="重新开始番茄"
        message={`该待办已完成 ${todo.pomodoroCount} 个番茄，确认重置并重新开始？`}
        confirmText="重置并开始"
        variant="warning"
      />
      <ConfirmDialog
        isOpen={showOverrideConfirm}
        onClose={() => setShowOverrideConfirm(false)}
        onConfirm={() => {
          resetTimerForTodoStart();
          doStartPomodoro();
        }}
        title="替换当前番茄钟"
        message={`当前正在「${linkedTodoId ? linkedTodoTitle || '其他待办' : '未关联待办'}」上专注，确认替换为「${todo.title}」？`}
        confirmText="替换并开始"
        variant="warning"
      />
    </>
  );
});
