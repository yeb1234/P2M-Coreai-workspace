import React, { useMemo } from 'react';
import { TrendingUp, Clock, Target } from 'lucide-react';
import { usePomodoroStore } from '../../stores';
import { formatDuration, toLocalDateString } from '../../lib/date';
import type { PomodoroSession } from '../../types';

const TIMELINE_START = 6;
const TIMELINE_END = 24;
const TIMELINE_HOURS = TIMELINE_END - TIMELINE_START;

function timeToPercent(isoStr: string): number {
  const d = new Date(isoStr);
  const hours = d.getHours() + d.getMinutes() / 60;
  return Math.max(0, Math.min(100, ((hours - TIMELINE_START) / TIMELINE_HOURS) * 100));
}

function sessionColor(phase: PomodoroSession['phase']): string {
  if (phase === 'work') return 'var(--accent)';
  return 'var(--warning)';
}

export const PomodoroStats: React.FC = () => {
  const getTodayStats = usePomodoroStore((s) => s.getTodayStats);
  const getWeekSessions = usePomodoroStore((s) => s.getWeekSessions);
  const todayStats = getTodayStats();
  const weekSessions = getWeekSessions();

  const allDays = useMemo(() => {
    const days: { date: string; sessions: PomodoroSession[] }[] = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = toLocalDateString(d);
      days.push({ date: dateStr, sessions: weekSessions[dateStr] || [] });
    }
    return days;
  }, [weekSessions]);

  const hasAnySessions = useMemo(() => allDays.some((d) => d.sessions.length > 0), [allDays]);

  return (
    <div className="min-w-0 space-y-4">
      <h3 className="font-medium text-[var(--text-primary)]">专注统计</h3>

      <div className="auto-grid-compact">
        <div className="p-3 bg-[color-mix(in_srgb,var(--accent)_12%,var(--bg-card))] rounded-lg border border-[color-mix(in_srgb,var(--accent)_18%,var(--border-light))]">
          <div className="flex items-center gap-2 text-[var(--accent)] mb-1">
            <Target size={14} />
            <span className="text-xs font-medium">今日番茄</span>
          </div>
          <p className="text-2xl font-bold text-[var(--accent)]">{todayStats.totalPomodoros}</p>
        </div>
        <div className="p-3 bg-[var(--bg-elevated)] rounded-lg border border-[var(--border-light)]">
          <div className="flex items-center gap-2 text-[var(--text-secondary)] mb-1">
            <Clock size={14} />
            <span className="text-xs font-medium">今日专注</span>
          </div>
          <p className="text-2xl font-bold text-[var(--text-primary)]">
            {formatDuration(todayStats.totalMinutes)}
          </p>
        </div>
      </div>

      {hasAnySessions && (
        <div className="min-w-0 overflow-x-auto pb-1 pr-1">
          <div className="min-w-[300px] pr-2">
          <div className="flex items-center gap-2 text-[var(--text-secondary)] mb-3">
            <TrendingUp size={14} />
            <span className="text-xs font-medium">本周趋势</span>
            <div className="ml-auto flex items-center gap-3 pr-1 text-[10px]">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: 'var(--accent)' }} />
                专注
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: 'var(--warning)' }} />
                休息
              </span>
            </div>
          </div>

          <div className="flex mb-1 pl-8 pr-2">
            <div className="flex-1 relative h-3">
              {[0, 6, 12, 18].map((h) => {
                const pct = ((h + 6 - TIMELINE_START) / TIMELINE_HOURS) * 100;
                if (pct < 0 || pct > 100) return null;
                return (
                  <span key={h} className="absolute text-[8px] text-[var(--text-muted)]" style={{ left: `${pct}%`, transform: 'translateX(-50%)' }}>
                    {String(h + 6).padStart(2, '0')}:00
                  </span>
                );
              })}
            </div>
          </div>

          <div className="space-y-1">
            {allDays.map(({ date, sessions }) => {
              const dayName = new Date(date + 'T12:00:00').toLocaleDateString('zh-CN', { weekday: 'narrow' });
              const dayNum = new Date(date + 'T12:00:00').getDate();
              const isToday = date === toLocalDateString(new Date());

              return (
                <div key={date} className="flex items-center gap-2 pr-2">
                  <div className={`w-8 text-right flex-shrink-0 ${isToday ? 'text-[var(--accent)] font-bold' : 'text-[var(--text-muted)]'}`}>
                    <div className="text-[10px] leading-tight">{dayName}</div>
                    <div className="text-[9px] leading-tight">{dayNum}</div>
                  </div>
                  <div className="flex-1 h-5 rounded-md relative overflow-hidden bg-[var(--bg-elevated)]">
                    {sessions.map((session) => {
                      const left = timeToPercent(session.startTime);
                      const endPct = session.endTime ? timeToPercent(session.endTime) : left + 2;
                      const width = Math.max(endPct - left, 1.5);
                      return (
                        <div
                          key={session.id}
                          className="absolute top-0.5 bottom-0.5 rounded-sm"
                          style={{
                            left: `${left}%`,
                            width: `${width}%`,
                            backgroundColor: sessionColor(session.phase),
                            opacity: session.phase === 'work' ? 0.85 : 0.65,
                          }}
                          title={`${session.phase === 'work' ? '专注' : '休息'} ${session.actualDuration}分钟`}
                        />
                      );
                    })}
                    {sessions.length === 0 && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-[8px] text-[var(--text-muted)]">-</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          </div>
        </div>
      )}
    </div>
  );
};
