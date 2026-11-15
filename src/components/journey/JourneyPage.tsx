import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Sparkles, Flame, Trophy, Clock, BookOpen, Timer, Target, Compass,
  Calendar, Check, Sprout, Moon, Pen, Lock, TrendingUp, TrendingDown,
} from 'lucide-react';
import { apiFetch } from '../../lib/videoApi';

/**
 * 学习轨迹。
 *
 * 这个页面不回答「我该学什么」（那是学习路径的活），只回答「我走到哪了」。
 * 数据来自五个地方：观看、完成、笔记、日程、番茄钟 —— 之前它们各在各的地方，
 * 没人把它们放在一起看，所以用户感觉不到自己在进步。
 */

interface Milestone {
  id: string;
  title: string;
  desc: string;
  icon: string;
  unlocked: boolean;
  current: number;
  target: number;
  progress: number;
}

interface JourneyData {
  level: {
    index: number;
    title: string;
    desc: string;
    exp: number;
    next_title: string | null;
    next_exp: number | null;
    to_next: number;
    progress: number;
  };
  sources: {
    watch_minutes: number;
    focus_minutes: number;
    notes: number;
    videos_started: number;
    videos_completed: number;
    streak_days: number;
    active_days_30d: number;
    pomodoro_done: number;
    pomodoro_total: number;
    categories: number;
  };
  this_week: { minutes: number; prev_week_minutes: number; delta: number };
  milestones: Milestone[];
  heatmap: { date: string; minutes: number }[];
  unlocked: number;
  total_milestones: number;
}

const ICONS: Record<string, React.ReactNode> = {
  sprout: <Sprout size={20} />,
  clock: <Clock size={20} />,
  flame: <Flame size={20} />,
  calendar: <Calendar size={20} />,
  moon: <Moon size={20} />,
  trophy: <Trophy size={20} />,
  check: <Check size={20} />,
  target: <Target size={20} />,
  pen: <Pen size={20} />,
  book: <BookOpen size={20} />,
  timer: <Timer size={20} />,
  compass: <Compass size={20} />,
};

function fmtMinutes(min: number): string {
  if (min < 60) return `${Math.round(min)} 分钟`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`;
}

/** 热力图配色：按当天分钟数分档。5 档足够看出节奏，不需要精确。 */
function heatClass(minutes: number): string {
  if (minutes <= 0) return 'bg-[#efece8]';
  if (minutes < 15) return 'bg-[#d9e8d4]';
  if (minutes < 40) return 'bg-[#a8d3a0]';
  if (minutes < 90) return 'bg-[#6fb865]';
  return 'bg-[#3f8f3a]';
}

export const JourneyPage: React.FC = () => {
  const [data, setData] = useState<JourneyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch<JourneyData>('/api/learning/journey');
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 热力图按周分列：91 天 = 13 周 × 7 天，最后补到整周
  const heatWeeks = useMemo(() => {
    if (!data) return [] as { date: string; minutes: number }[][];
    const cells = [...data.heatmap];
    const first = new Date(cells[0]?.date ?? Date.now());
    const pad = first.getDay(); // 周日=0，前面补空格
    const padded: ({ date: string; minutes: number } | null)[] = [
      ...Array.from({ length: pad }, () => null),
      ...cells,
    ];
    const weeks: { date: string; minutes: number }[][] = [];
    for (let i = 0; i < padded.length; i += 7) {
      const chunk = padded.slice(i, i + 7);
      while (chunk.length < 7) chunk.push(null);
      weeks.push(chunk as { date: string; minutes: number }[]);
    }
    return weeks;
  }, [data]);

  if (loading) {
    return (
      <div className="p-8 text-sm text-[var(--text-muted)]">正在汇总五个数据源…</div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8">
        <div className="rounded-xl border border-[var(--border-light)] bg-[var(--bg-elevated)] p-8 text-center">
          <div className="text-sm text-[var(--text-secondary)]">{error || '没有数据'}</div>
          <button
            onClick={() => void load()}
            className="mt-3 rounded-lg border border-[var(--border-light)] bg-white px-3 py-1.5 text-sm hover:bg-[var(--bg-elevated)]"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  const { level, sources, this_week, milestones, unlocked, total_milestones } = data;
  const weekUp = this_week.delta >= 0;

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">学习轨迹</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            把观看、专注、笔记、日历里的记录合在一起，看你走到了哪
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="shrink-0 whitespace-nowrap rounded-lg border border-[var(--border-light)] bg-white px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
        >
          刷新
        </button>
      </div>

      {/* 等级 */}
      <div className="mb-4 rounded-xl border border-[var(--border-light)] bg-gradient-to-br from-[#faf9f7] to-[#f2efe9] p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="rounded-lg bg-[var(--text-primary)] px-2.5 py-1 text-xs font-medium text-white">
                Lv.{level.index}
              </span>
              <span className="text-lg font-semibold text-[var(--text-primary)]">{level.title}</span>
            </div>
            <p className="mt-1.5 text-sm text-[var(--text-secondary)]">{level.desc}</p>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-2xl font-semibold tabular-nums text-[var(--text-primary)]">{level.exp}</div>
            <div className="text-xs text-[var(--text-muted)]">经验</div>
          </div>
        </div>

        <div className="mt-4">
          <div className="h-2 overflow-hidden rounded-full bg-[var(--border-light)]">
            <div
              className="h-full rounded-full bg-[var(--text-primary)] transition-all"
              style={{ width: `${Math.max(level.progress * 100, 2)}%` }}
            />
          </div>
          <div className="mt-1.5 flex justify-between text-xs text-[var(--text-muted)]">
            <span>
              {level.next_title
                ? `距「${level.next_title}」还差 ${level.to_next} 点`
                : '已到最高等级'}
            </span>
            <span>{Math.round(level.progress * 100)}%</span>
          </div>
        </div>
      </div>

      {/* 本周 + 连续 + 成就 */}
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
        <div className="rounded-xl border border-[var(--border-light)] bg-white p-4">
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <Clock size={14} /> 本周学习
          </div>
          <div className="mt-1.5 text-lg font-semibold text-[var(--text-primary)] sm:text-xl">
            {fmtMinutes(this_week.minutes)}
          </div>
          <div className={`mt-1 flex items-center gap-1 text-xs ${weekUp ? 'text-[#3f8f3a]' : 'text-[#c0392b]'}`}>
            {weekUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {weekUp ? '比上周多 ' : '比上周少 '}
            {fmtMinutes(Math.abs(this_week.delta))}
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border-light)] bg-white p-4">
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <Flame size={14} /> 连续学习
          </div>
          <div className="mt-1.5 text-lg font-semibold text-[var(--text-primary)] sm:text-xl">
            {sources.streak_days} <span className="text-sm font-normal text-[var(--text-muted)]">天</span>
          </div>
          <div className="mt-1 text-xs text-[var(--text-muted)]">
            近 30 天活跃 {sources.active_days_30d} 天
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border-light)] bg-white p-4">
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <Trophy size={14} /> 成就
          </div>
          <div className="mt-1.5 text-lg font-semibold text-[var(--text-primary)] sm:text-xl">
            {unlocked} <span className="text-sm font-normal text-[var(--text-muted)]">/ {total_milestones}</span>
          </div>
          <div className="mt-1 text-xs text-[var(--text-muted)]">
            {unlocked === total_milestones ? '全部解锁' : `还差 ${total_milestones - unlocked} 个`}
          </div>
        </div>
      </div>

      {/* 五源明细 */}
      <div className="mb-4 rounded-xl border border-[var(--border-light)] bg-[var(--bg-elevated)] p-4">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
          <Sparkles size={13} /> 这份轨迹串了五个数据源
        </div>
        <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-5">
          {[
            { label: '观看', value: fmtMinutes(sources.watch_minutes) },
            { label: '专注', value: sources.focus_minutes > 0 ? fmtMinutes(sources.focus_minutes) : '—' },
            { label: '手写笔记', value: sources.notes > 0 ? `${sources.notes} 篇` : '—' },
            { label: '看完视频', value: `${sources.videos_completed} 个` },
            { label: '涉猎领域', value: `${sources.categories} 个` },
          ].map((s) => (
            <div key={s.label}>
              <div className="text-sm font-medium text-[var(--text-primary)]">{s.value}</div>
              <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">{s.label}</div>
            </div>
          ))}
        </div>
        {sources.pomodoro_total > 0 && (
          <div className="mt-2 text-[11px] text-[var(--text-muted)]">
            番茄钟记录 {sources.pomodoro_total} 次，完成 {sources.pomodoro_done} 次
          </div>
        )}
      </div>

      {/* 成就墙 */}
      <div className="mb-4">
        <h2 className="mb-2 text-sm font-medium text-[var(--text-secondary)]">成就墙</h2>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {milestones.map((m) => (
            <div
              key={m.id}
              title={`${m.title} — ${m.desc}`}
              className={`rounded-xl border p-3 text-center transition-colors ${
                m.unlocked
                  ? 'border-[#c8b88a] bg-[#fdf9ed]'
                  : 'border-[var(--border-light)] bg-white'
              }`}
            >
              <div
                className={`mx-auto flex h-9 w-9 items-center justify-center rounded-full ${
                  m.unlocked ? 'bg-[var(--text-primary)] text-[#fdf9ed]' : 'bg-[#f2efe9] text-[#c4c0b9]'
                }`}
              >
                {m.unlocked ? ICONS[m.icon] ?? <Trophy size={18} /> : <Lock size={16} />}
              </div>
              <div className={`mt-1.5 text-[11px] font-medium ${m.unlocked ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>
                {m.title}
              </div>
              {!m.unlocked && (
                <div className="mt-1">
                  <div className="h-1 overflow-hidden rounded-full bg-[#efece8]">
                    <div className="h-full bg-[#c4c0b9]" style={{ width: `${m.progress * 100}%` }} />
                  </div>
                  <div className="mt-0.5 text-[10px] text-[#b8b4ad]">
                    {m.current} / {m.target}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 热力图 */}
      <div className="rounded-xl border border-[var(--border-light)] bg-white p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-[var(--text-secondary)]">近 90 天</h2>
          <div className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
            少
            {['bg-[#efece8]', 'bg-[#d9e8d4]', 'bg-[#a8d3a0]', 'bg-[#6fb865]', 'bg-[#3f8f3a]'].map((c) => (
              <span key={c} className={`h-3 w-3 rounded-sm ${c}`} />
            ))}
            多
          </div>
        </div>
        <div className="flex gap-1 overflow-x-auto pb-1">
          {heatWeeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-1">
              {week.map((day, di) =>
                day ? (
                  <div
                    key={day.date}
                    title={`${day.date}：${day.minutes} 分钟`}
                    className={`h-3 w-3 rounded-sm ${heatClass(day.minutes)}`}
                  />
                ) : (
                  <div key={`e-${wi}-${di}`} className="h-3 w-3 rounded-sm bg-transparent" />
                )
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default JourneyPage;
