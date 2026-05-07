import React from 'react';
import { Timer, Target } from 'lucide-react';
import { usePomodoroStore } from '../../../stores';
import { PHASE_LABELS } from '../../../types';
import { formatDuration } from '../../../lib/date';

export const PomodoroSummary: React.FC = () => {
  const { timer, getTodayStats, config } = usePomodoroStore();
  const todayStats = getTodayStats();
  const progress = Math.min((todayStats.totalPomodoros / config.dailyGoal) * 100, 100);

  return (
    <div className="space-y-3">
      {/* Goal progress */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium text-[#6b7280]">
          <Target size={12} />
          <span>今日目标</span>
        </div>
        <span className="text-xs font-semibold text-[#c87d2f]">
          {todayStats.totalPomodoros}/{config.dailyGoal}
        </span>
      </div>
      <div className="w-full bg-[#e5e2dd] rounded-full h-1.5">
        <div
          className="bg-gradient-to-r from-[#c87d2f] to-[#e0973f] h-1.5 rounded-full transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-[#fef7ed] rounded-lg p-2.5 text-center">
          <p className="text-xl font-bold text-[#c87d2f]">{todayStats.totalPomodoros}</p>
          <p className="text-[10px] font-medium text-[#92400e]">番茄数</p>
        </div>
        <div className="bg-[#fef7ed] rounded-lg p-2.5 text-center">
          <p className="text-xl font-bold text-[#b06d20]">{formatDuration(todayStats.totalMinutes)}</p>
          <p className="text-[10px] font-medium text-[#92400e]">专注时长</p>
        </div>
      </div>

      {/* Running timer */}
      {timer.status === 'running' && (
        <div className="flex items-center gap-2 text-xs font-medium text-[#c87d2f] bg-[#fef7ed] rounded-lg p-2 border border-[#e5e2dd]">
          <Timer size={14} className="animate-pulse" />
          <span>{PHASE_LABELS[timer.phase]}</span>
          <span className="ml-auto font-mono text-sm font-bold">
            {Math.floor(timer.timeRemaining / 60).toString().padStart(2, '0')}:
            {(timer.timeRemaining % 60).toString().padStart(2, '0')}
          </span>
        </div>
      )}

      {/* No sessions today */}
      {todayStats.totalPomodoros === 0 && timer.status !== 'running' && (
        <p className="text-xs text-[#b8b4ac] text-center py-1">今天还没有专注记录</p>
      )}
    </div>
  );
};
