import React, { useState } from 'react';
import { Timer, ListTodo, Flame } from 'lucide-react';
import { usePomodoroStore, useScheduleStore } from '../../../stores';
import { PHASE_LABELS } from '../../../types';
import { formatDuration } from '../../../lib/date';
import { selectPomodoroProjection } from '../../../lib/projections/pomodoro';
import { SummaryEmpty } from './SummaryEmpty';

type StatsMode = 'pomodoro' | 'todo';

/**
 * 番茄钟卡片 = 番茄统计页同一份投影的渲染。
 * 番茄数 / 专注时长来自 getTodayStats()（与 PomodoroStats 页同源），
 * 今日待办来自 selectTodoProjection 派生的投影；卡片这边不再写 dueAt 过滤和轮次计算。
 */
export const PomodoroSummary: React.FC = () => {
  const sessions = usePomodoroStore((s) => s.sessions);
  const timer = usePomodoroStore((s) => s.timer);
  const config = usePomodoroStore((s) => s.config);
  const getTodayStats = usePomodoroStore((s) => s.getTodayStats);
  const items = useScheduleStore((s) => s.items);

  // 默认番茄视图，切换按钮保留；首发视图固定，不再随机跳转
  const [mode, setMode] = useState<StatsMode>('pomodoro');

  const todayStats = getTodayStats();
  const projection = selectPomodoroProjection({ todayStats, sessions, items, config, timer });

  const toggleMode = () => setMode((m) => (m === 'pomodoro' ? 'todo' : 'pomodoro'));

  return (
    <div className="space-y-3">
      {/* Goal progress */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
          <span>🍅</span>
          <span>今日番茄</span>
          <span className="font-semibold text-[var(--accent)]">
            {projection.totalPomodoros}
          </span>
        </div>
      </div>
      {projection.hasTodoGoal && (
        <div className="w-full bg-[var(--border-light)] rounded-full h-1.5">
          <div
            className="bg-gradient-to-r from-[var(--accent)] to-[var(--accent)] h-1.5 rounded-full transition-all duration-500"
            style={{ width: `${projection.progress}%` }}
          />
        </div>
      )}

      {/* Stats — togglable */}
      <div className="grid grid-cols-2 gap-2">
        {mode === 'pomodoro' ? (
          <>
            <div className="rounded-lg bg-[var(--bg-base)] px-2 py-1.5 text-center">
              <p className="text-xl font-bold tabular-nums text-[var(--accent)]">{projection.totalPomodoros}</p>
              <p className="text-xs font-medium text-[var(--text-muted)]">番茄数</p>
            </div>
            <div className="rounded-lg bg-[var(--bg-base)] px-2 py-1.5 text-center">
              <p className="text-xl font-bold tabular-nums text-[var(--accent)]">{formatDuration(projection.totalMinutes)}</p>
              <p className="text-xs font-medium text-[var(--text-muted)]">专注时长</p>
            </div>
          </>
        ) : (
          <>
            <div className="rounded-lg bg-[var(--bg-base)] px-2 py-1.5 text-center">
              <p className="text-xl font-bold tabular-nums text-[var(--success)]">{projection.todayDone}/{projection.todayTotal}</p>
              <p className="text-xs font-medium text-[var(--text-muted)]">已完成</p>
            </div>
            <div className="rounded-lg bg-[var(--bg-base)] px-2 py-1.5 text-center">
              <p className="text-xl font-bold tabular-nums text-[var(--accent)]">{projection.todayInProgress}</p>
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
      {projection.isRunning && (
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
      {projection.totalPomodoros === 0 && !projection.isRunning && mode === 'pomodoro' && (
        <SummaryEmpty
          icon={<Timer size={16} />}
          title="今天还没有专注记录"
          hint="在番茄钟页点开始"
        />
      )}
    </div>
  );
};
