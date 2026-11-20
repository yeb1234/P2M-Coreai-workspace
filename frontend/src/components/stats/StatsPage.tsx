import React from 'react';
import { BarChart3, TrendingUp, Clock, Target, Calendar, Flame, StickyNote, ListTodo, Trophy } from 'lucide-react';
import { PageTitle } from '../shared';
import { usePomodoroStore, useCalendarStore, useNotesStore, useScheduleStore } from '../../stores';
import { toLocalDateString } from '../../lib/date';
import { selectTodoProjection } from '../../lib/projections/todo';
import { selectQuickStatsProjection } from '../../lib/projections/quickStats';

const DAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

function getLast7Days(): string[] {
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(toLocalDateString(d));
  }
  return days;
}

function getStreakDays(sessions: Record<string, { completed: boolean; startTime: string }>): number {
  const dates = new Set(
    Object.values(sessions)
      .filter((s) => s.completed)
      .map((s) => toLocalDateString(s.startTime))
  );
  let streak = 0;
  const d = new Date();
  while (true) {
    const key = toLocalDateString(d);
    if (dates.has(key)) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

export const StatsPage: React.FC = () => {
  // 统计口径对齐待办页：用 scheduleStore 而不是 todoStore，
  // 否则「统计里说 5 条待办」和「待办页显示 3 条」对不上。
  const scheduleItems = useScheduleStore((s) => s.items);
  const getTodayStats = usePomodoroStore((s) => s.getTodayStats);
  const getWeekStats = usePomodoroStore((s) => s.getWeekStats);
  const sessions = usePomodoroStore((s) => s.sessions);
  const notes = useNotesStore((s) => s.notes);
  const calendarEvents = useCalendarStore((s) => s.events);

  // 待办基础集合（type todo 且未删除）复用待办投影，和待办页 / 概览卡片同一份口径
  const todoProjection = selectTodoProjection(scheduleItems);
  const todoList = todoProjection.todos;
  const completedTodos = todoProjection.counts.completed;
  const pendingTodos = todoProjection.counts.pending;
  const inProgressTodos = todoProjection.counts.inProgress;

  const todayStats = getTodayStats();
  // 概览卡片同一份投影：今日番茄 / 便签 / 今日事件，两边数字必须一致
  const quick = selectQuickStatsProjection({ items: scheduleItems, todayStats, notes, calendarEvents });
  // 徽章「日程管理」也改成和日历页同源：数 schedule_items 里的 event，
  // 不再数 legacy calendar_events。聊天/笔记 AI 新建的日程都会进这个全集。
  const calendarEventTotal = Object.values(scheduleItems)
    .filter((item) => item.type === 'event' && !item.deletedAt).length;

  const weekStats = getWeekStats();
  const streak = getStreakDays(sessions);

  // Weekly breakdown
  const last7 = getLast7Days();
  const maxMinutes = Math.max(1, ...last7.map((d) => weekStats.dailyBreakdown[d]?.minutes || 0));

  // Total week stats
  const totalWeekPomodoros = last7.reduce(
    (sum, d) => sum + (weekStats.dailyBreakdown[d]?.pomodoros || 0), 0
  );
  const totalWeekMinutes = last7.reduce(
    (sum, d) => sum + (weekStats.dailyBreakdown[d]?.minutes || 0), 0
  );

  // Achievement badges
  const badges: { label: string; unlocked: boolean; icon: React.ReactNode }[] = [
    {
      label: '初学者',
      unlocked: totalWeekPomodoros >= 1,
      icon: <Target size={18} />,
    },
    {
      label: '专注达人',
      unlocked: totalWeekPomodoros >= 25,
      icon: <Clock size={18} />,
    },
    {
      label: '效率王者',
      unlocked: completedTodos >= 50,
      icon: <Trophy size={18} />,
    },
    {
      label: '坚持一周',
      unlocked: streak >= 7,
      icon: <Flame size={18} />,
    },
    {
      label: '便签大师',
      unlocked: notes.length >= 10,
      icon: <StickyNote size={18} />,
    },
    {
      label: '日程管理',
      unlocked: calendarEventTotal >= 20,
      icon: <Calendar size={18} />,
    },
  ];

  return (
    <div className="w-full pt-2 space-y-6">
      <PageTitle
        title="数据中心"
        subtitle="全局数据洞察，量化你的成长"
        icon={<BarChart3 size={22} />}
      />

      {/* Summary cards */}
      <div className="auto-grid-cards">
        <div className="bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl p-4">
          <div className="flex items-center gap-2 text-[var(--accent)] mb-2">
            <Target size={16} />
            <span className="text-xs font-medium">今日番茄</span>
          </div>
          <p className="text-2xl font-bold text-[var(--text-primary)]">{quick.pomodoros}</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            {todayStats.totalMinutes >= 60
              ? `${(todayStats.totalMinutes / 60).toFixed(1)}h`
              : `${todayStats.totalMinutes}分钟`}
          </p>
        </div>
        <div className="bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl p-4">
          <div className="flex items-center gap-2 text-[var(--info)] mb-2">
            <Clock size={16} />
            <span className="text-xs font-medium">本周专注</span>
          </div>
          <p className="text-2xl font-bold text-[var(--text-primary)]">
            {totalWeekMinutes >= 60
              ? `${(totalWeekMinutes / 60).toFixed(1)}h`
              : `${totalWeekMinutes}m`}
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-1">{totalWeekPomodoros} 个番茄</p>
        </div>
        <div className="bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl p-4">
          <div className="flex items-center gap-2 text-[var(--success)] mb-2">
            <ListTodo size={16} />
            <span className="text-xs font-medium">待办统计</span>
          </div>
          <p className="text-2xl font-bold text-[var(--text-primary)]">{completedTodos}</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            {inProgressTodos} 进行中 / {pendingTodos} 待处理
          </p>
        </div>
        <div className="bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl p-4">
          <div className="flex items-center gap-2 text-[#ec4899] mb-2">
            <Flame size={16} />
            <span className="text-xs font-medium">连续天数</span>
          </div>
          <p className="text-2xl font-bold text-[var(--text-primary)]">{streak}天</p>
          <p className="text-xs text-[var(--warn)] mt-1">
            {streak >= 7 ? '保持势头!' : streak > 0 ? '继续加油' : '从今天开始'}
          </p>
        </div>
      </div>

      {/* Extra stats row */}
      <div className="auto-grid-cards">
        <div className="bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl p-3 flex items-center gap-3">
          <StickyNote size={16} className="text-[var(--warn)]" />
          <div>
            <p className="text-lg font-bold text-[var(--text-primary)]">{quick.notesCount}</p>
            <p className="text-xs text-[var(--text-muted)]">便签</p>
          </div>
        </div>
        <div className="bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl p-3 flex items-center gap-3">
          <Calendar size={16} className="text-[#7c3aed]" />
          <div>
            <p className="text-lg font-bold text-[var(--text-primary)]">{quick.eventsCount}</p>
            <p className="text-xs text-[var(--text-muted)]">日历事件</p>
          </div>
        </div>
        <div className="bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl p-3 flex items-center gap-3">
          <Target size={16} className="text-[var(--success)]" />
          <div>
            <p className="text-lg font-bold text-[var(--text-primary)]">{todoList.length}</p>
            <p className="text-xs text-[var(--text-muted)]">全部待办</p>
          </div>
        </div>
        <div className="bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl p-3 flex items-center gap-3">
          <TrendingUp size={16} className="text-[#06b6d4]" />
          <div>
            <p className="text-lg font-bold text-[var(--text-primary)]">
              {todoList.length > 0 ? Math.round((completedTodos / todoList.length) * 100) : 0}%
            </p>
            <p className="text-xs text-[var(--text-muted)]">完成率</p>
          </div>
        </div>
      </div>

      {/* Weekly focus chart */}
      <div className="bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp size={16} className="text-[var(--text-secondary)]" />
          <h3 className="text-sm font-medium text-[var(--text-primary)]">本周专注趋势</h3>
        </div>
        {totalWeekMinutes > 0 ? (
          <div className="min-w-0 flex items-end gap-3 h-40">
            {last7.map((date) => {
              const data = weekStats.dailyBreakdown[date];
              const minutes = data?.minutes || 0;
              const pomodoros = data?.pomodoros || 0;
              const dayOfWeek = new Date(date + 'T00:00:00').getDay();
              const isToday = date === toLocalDateString(new Date());

              return (
                <div key={date} className="flex-1 flex flex-col items-center gap-2">
                  <span className="whitespace-nowrap text-[10px] leading-tight text-[var(--text-muted)] sm:text-xs">
                    {minutes > 0 ? `${minutes}分` : '-'}
                  </span>
                  <div className="w-full flex items-end justify-center" style={{ height: '120px' }}>
                    <div
                      className={`w-full rounded-t-md transition-all ${
                        isToday
                          ? 'bg-gradient-to-t from-[var(--accent)] to-[var(--accent)]'
                          : 'bg-gradient-to-t from-[#d4c4a8] to-[#e5dcc8]'
                      }`}
                      style={{ height: `${Math.max(minutes > 0 ? 8 : 0, (minutes / maxMinutes) * 100)}%` }}
                    />
                  </div>
                  <span className={`text-xs font-medium ${isToday ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}>
                    {DAY_LABELS[dayOfWeek]}
                    {pomodoros > 0 && (
                      <span className="block text-xs text-[var(--text-muted)]">{pomodoros}个</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="h-40 flex items-center justify-center text-[var(--text-muted)] text-sm">
            <TrendingUp size={20} className="mr-2 opacity-40" />
            还没有专注记录，开始你的第一个番茄钟吧
          </div>
        )}
      </div>

      {/* Achievement badges */}
      <div className="bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl p-5">
        <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3">成就徽章</h3>
        <div className="flex flex-wrap gap-4">
          {badges.map((badge) => (
            <div key={badge.label} className="flex flex-col items-center gap-1">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  badge.unlocked
                    ? 'bg-gradient-to-br from-[#f59e0b] to-[#c87d2f] text-white'
                    : 'bg-[var(--border-light)] text-[var(--text-muted)]'
                }`}
              >
                {badge.icon}
              </div>
              <span className={`text-xs ${badge.unlocked ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]'}`}>
                {badge.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

