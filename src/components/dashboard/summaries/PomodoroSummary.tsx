import React, { useMemo, useState } from 'react';
import { Timer, ListTodo, Flame } from 'lucide-react';
import { usePomodoroStore, useScheduleStore } from '../../../stores';
import { PHASE_LABELS } from '../../../types';
import { formatDuration, toLocalDateString } from '../../../lib/date';
import { datePart, hasScheduleTime } from '../../../lib/scheduleTime';
import { SummaryEmpty } from './SummaryEmpty';
import { calculateSchedulePomodoroRounds } from '../../../lib/pomodoroPlanning';

type StatsMode = 'pomodoro' | 'todo';

export const PomodoroSummary: React.FC = () => {
  const { timer, getTodayStats, config } = usePomodoroStore();
  const todos = useScheduleStore((s) => s.items);
  const todayStats = getTodayStats();

  // Random initial mode — refresh switches it
  const [mode, setMode] = useState<StatsMode>(() => Math.random() > 0.5 ? 'pomodoro' : 'todo');

  const { dailyGoal, hasTodoGoal } = useMemo(() => {
    const today = toLocalDateString(new Date());
    const todayTodoRounds = Object.values(todos)
      .filter((t) => t.type === 'todo' && hasScheduleTime(t) && datePart(t.dueAt) === today && t.status !== 'completed')
      .reduce((sum, t) => sum + calculateSchedulePomodoroRounds(t, config), 0);
    if (todayTodoRounds > 0) return { dailyGoal: todayTodoRounds, hasTodoGoal: true };
    return { dailyGoal: config.dailyGoal, hasTodoGoal: false };
  }, [todos, config]);

  const progress = hasTodoGoal ? Math.min((todayStats.totalPomodoros / dailyGoal) * 100, 100) : 0;

  // Todo stats for today
  const todoStats = useMemo(() => {
    const today = toLocalDateString(new Date());
    const allTodos = Object.values(todos).filter((t) => t.type === 'todo' && !t.deletedAt);
    const todayTodos = allTodos.filter((t) => hasScheduleTime(t) && datePart(t.dueAt) === today);
    const completed = todayTodos.filter((t) => t.status === 'completed').length;
    const total = todayTodos.length;
    // Also count in-progress
    const inProgress = todayTodos.filter((t) => t.status === 'in_progress').length;
    return { completed, total, inProgress };
  }, [todos]);

  const toggleMode = () => setMode((m) => (m === 'pomodoro' ? 'todo' : 'pomodoro'));

  return (
    <div className="space-y-3">
      {/* Goal progress */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
          <span>🍅</span>
          <span>今日番茄</span>
          <span className="font-semibold text-[var(--accent)]">
            {todayStats.totalPomodoros}
          </span>
        </div>
      </div>
      {hasTodoGoal && (
        <div className="w-full bg-[var(--border-light)] rounded-full h-1.5">
          <div
            className="bg-gradient-to-r from-[var(--accent)] to-[var(--accent)] h-1.5 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Stats — togglable */}
      <div className="grid grid-cols-2 gap-2">
        {mode === 'pomodoro' ? (
          <>
            <div className="rounded-lg bg-[var(--bg-base)] px-2 py-1.5 text-center">
              <p className="text-xl font-bold tabular-nums text-[var(--accent)]">{todayStats.totalPomodoros}</p>
              <p className="text-xs font-medium text-[var(--text-muted)]">番茄数</p>
            </div>
            <div className="rounded-lg bg-[var(--bg-base)] px-2 py-1.5 text-center">
              <p className="text-xl font-bold tabular-nums text-[var(--accent)]">{formatDuration(todayStats.totalMinutes)}</p>
              <p className="text-xs font-medium text-[var(--text-muted)]">专注时长</p>
            </div>
          </>
        ) : (
          <>
            <div className="rounded-lg bg-[var(--bg-base)] px-2 py-1.5 text-center">
              <p className="text-xl font-bold tabular-nums text-[var(--success)]">{todoStats.completed}/{todoStats.total}</p>
              <p className="text-xs font-medium text-[var(--text-muted)]">已完成</p>
            </div>
            <div className="rounded-lg bg-[var(--bg-base)] px-2 py-1.5 text-center">
              <p className="text-xl font-bold tabular-nums text-[var(--accent)]">{todoStats.inProgress}</p>
              <p className="text-xs font-medium text-[var(--text-muted)]">进行中</p>
            </div>
          </>
        )}
      </div>

      {/* Mode toggle */}
      <button
        onClick={toggleMode}
        className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-accent)] rounded-lg transition-colors"
      >
        {mode === 'pomodoro' ? (
          <><ListTodo size={10} /> 切换到待办视图</>
        ) : (
          <><Flame size={10} /> 切换到番茄视图</>
        )}
      </button>

      {/* Running timer */}
      {timer.status === 'running' && (
        <div className="flex items-center gap-2 text-xs font-medium text-[var(--accent)] bg-[var(--bg-accent)] rounded-lg p-2 border border-[var(--border-light)]">
          <Timer size={14} className="animate-pulse" />
          <span>{PHASE_LABELS[timer.phase]}</span>
          <span className="ml-auto font-mono text-sm font-bold">
            {Math.floor(timer.timeRemaining / 60).toString().padStart(2, '0')}:
            {(timer.timeRemaining % 60).toString().padStart(2, '0')}
          </span>
        </div>
      )}

      {/* No sessions today */}
      {todayStats.totalPomodoros === 0 && timer.status !== 'running' && mode === 'pomodoro' && (
        <SummaryEmpty
          icon={<Timer size={16} />}
          title="今天还没有专注记录"
          hint="在番茄钟页点开始"
        />
      )}
    </div>
  );
};
