import React, { useEffect, useMemo, useRef, useState } from 'react';
import Clock from 'react-clock';
import Countdown from 'react-countdown';
import 'react-clock/dist/Clock.css';
import { AlarmClock, Bell, Hourglass, Pause, Play, Plus, RotateCcw, TimerReset, Trash2, X } from 'lucide-react';
import { PageTitle } from '../shared';
import { useNotificationStore, useTimeCenterStore, useTodoStore } from '../../stores';
import { playNotificationSound } from '../../lib/sounds';
import { toLocalDateString } from '../../lib/date';
import { useClockNow } from '../../hooks/useClockNow';

type TaskType = 'stopwatch' | 'countdown' | 'alarm' | 'reminder' | 'todo';

interface TimeTaskRow {
  id: string;
  type: TaskType;
  title: string;
  target: string;
  display?: string;
  status: string;
  enabled: boolean;
  triggered: boolean;
}

const pad = (value: number) => String(value).padStart(2, '0');
const formatSeconds = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};
const toDateTimeInput = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};
const typeMeta: Record<TaskType, { label: string; icon: React.ReactNode }> = {
  stopwatch: { label: '正计时', icon: <TimerReset size={14} /> },
  countdown: { label: '倒计时', icon: <Hourglass size={14} /> },
  alarm: { label: '闹钟', icon: <AlarmClock size={14} /> },
  reminder: { label: '提醒', icon: <Bell size={14} /> },
  todo: { label: '待办', icon: <Bell size={14} /> },
};

const TIMEZONE_OPTIONS = [
  { label: '上海', value: 'Asia/Shanghai' },
  { label: '东京', value: 'Asia/Tokyo' },
  { label: '新加坡', value: 'Asia/Singapore' },
  { label: '迪拜', value: 'Asia/Dubai' },
  { label: '伦敦', value: 'Europe/London' },
  { label: '巴黎', value: 'Europe/Paris' },
  { label: '纽约', value: 'America/New_York' },
  { label: '洛杉矶', value: 'America/Los_Angeles' },
  { label: '温哥华', value: 'America/Vancouver' },
  { label: '悉尼', value: 'Australia/Sydney' },
];

function formatTimeInZone(date: Date, timeZone: string): string {
  try {
    return date.toLocaleTimeString('zh-CN', { timeZone, hour: '2-digit', minute: '2-digit' });
  } catch {
    return '--:--';
  }
}

function TimeCenterClock({ date }: { date: Date }) {
  return (
    <div className="time-center-clock-shell">
      <Clock value={date} size={104} renderNumbers hourMarksLength={8} minuteMarksLength={3} />
    </div>
  );
}

function CountdownDisplay({
  id,
  seconds,
  endAt,
  onComplete,
}: {
  id: string;
  seconds: number;
  endAt?: number;
  onComplete: (id: string) => void;
}) {
  if (!endAt) return <>{formatSeconds(seconds)}</>;

  return (
    <Countdown
      key={`${id}-${endAt}`}
      date={endAt}
      daysInHours
      renderer={({ total }) => formatSeconds(Math.ceil(total / 1000))}
      onComplete={() => onComplete(id)}
    />
  );
}

export const TimeCenterPage: React.FC = () => {
  const now = useClockNow();
  const nowMs = now.getTime();
  const [taskType, setTaskType] = useState<TaskType>('countdown');
  const [taskTitle, setTaskTitle] = useState('新的时间任务');
  const [taskMinutes, setTaskMinutes] = useState(5);
  const [taskTime, setTaskTime] = useState('09:00');
  const [taskAt, setTaskAt] = useState(() => toDateTimeInput(new Date(Date.now() + 30 * 60 * 1000)));
  const [stopwatchRunning, setStopwatchRunning] = useState(false);
  const [stopwatchBaseElapsed, setStopwatchBaseElapsed] = useState(0);
  const [zoneLabel, setZoneLabel] = useState('');
  const [zoneValue, setZoneValue] = useState('Asia/Shanghai');
  const [stopwatchStart, setStopwatchStart] = useState<number | null>(null);
  const [countdownEndById, setCountdownEndById] = useState<Record<string, number>>({});
  const completedCountdownRef = useRef<Set<string>>(new Set());

  const {
    worldClocks,
    alarms,
    reminders,
    countdownPresets,
    addAlarm,
    toggleAlarm,
    removeAlarm,
    markAlarmTriggered,
    addReminder,
    toggleReminder,
    removeReminder,
    markReminderTriggered,
    addCountdownPreset,
    removeCountdownPreset,
    addWorldClock,
    updateWorldClock,
    removeWorldClock,
  } = useTimeCenterStore();
  const todos = useTodoStore((s) => s.todos);
  const addTodo = useTodoStore((s) => s.addTodo);
  const addNotification = useNotificationStore((s) => s.addNotification);

  const stopwatchElapsed = stopwatchRunning && stopwatchStart != null
    ? Math.max(0, Math.floor((nowMs - stopwatchStart) / 1000))
    : stopwatchBaseElapsed;

  useEffect(() => {
    const today = now.toISOString().slice(0, 10);
    const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    alarms.forEach((alarm) => {
      if (!alarm.enabled || alarm.lastTriggeredDate === today || alarm.time !== hhmm) return;
      markAlarmTriggered(alarm.id, today);
      const added = addNotification({ type: 'system', title: '闹钟', message: alarm.label || alarm.time, sourceKey: `alarm:${alarm.id}:${today}` });
      if (added) playNotificationSound();
    });
    reminders.forEach((reminder) => {
      if (!reminder.enabled || reminder.triggeredAt || new Date(reminder.remindAt).getTime() > now.getTime()) return;
      markReminderTriggered(reminder.id, now.toISOString());
      const added = addNotification({ type: reminder.source === 'todo' ? 'todo' : 'system', title: '时间提醒', message: reminder.title, sourceKey: `time-reminder:${reminder.id}:${reminder.remindAt}` });
      if (added) playNotificationSound();
    });
  }, [addNotification, alarms, markAlarmTriggered, markReminderTriggered, now, reminders]);

  const rows = useMemo<TimeTaskRow[]>(() => {
    const countdownRows = countdownPresets.map((item) => ({
      id: item.id,
      type: 'countdown' as const,
      title: item.label,
      target: `${Math.round(item.seconds / 60)} 分钟`,
      status: countdownEndById[item.id] ? '运行中' : '待开始',
      enabled: true,
      triggered: false,
    }));
    const alarmRows = alarms.map((item) => ({
      id: item.id,
      type: 'alarm' as const,
      title: item.label,
      target: item.time,
      display: item.time,
      status: item.enabled ? '启用' : '停用',
      enabled: item.enabled,
      triggered: false,
    }));
    const reminderRows = reminders.map((item) => ({
      id: item.id,
      type: item.source === 'todo' ? 'todo' as const : 'reminder' as const,
      title: item.title,
      target: new Date(item.remindAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
      display: item.triggeredAt ? '已提醒' : '待提醒',
      status: item.triggeredAt ? '已完成' : item.enabled ? '启用' : '停用',
      enabled: item.enabled,
      triggered: Boolean(item.triggeredAt),
    }));
    const todoRows = Object.values(todos)
      .filter((todo) => todo.reminderAt && todo.status !== 'completed' && !reminderRows.some((row) => row.type === 'todo' && row.id === todo.id))
      .map((todo) => ({
        id: todo.id,
        type: 'todo' as const,
        title: todo.title,
        target: new Date(todo.reminderAt!).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
        display: '待提醒',
        status: '来自待办',
        enabled: true,
        triggered: false,
      }));
    return [
      { id: 'stopwatch', type: 'stopwatch', title: '正计时', target: '手动计时', display: formatSeconds(stopwatchElapsed), status: stopwatchRunning ? '运行中' : '已暂停', enabled: true, triggered: false },
      ...countdownRows,
      ...alarmRows,
      ...reminderRows,
      ...todoRows,
    ];
  }, [alarms, countdownEndById, countdownPresets, reminders, stopwatchElapsed, stopwatchRunning, todos]);

  const startStopwatch = () => {
    setStopwatchStart(Date.now() - stopwatchBaseElapsed * 1000);
    setStopwatchRunning(true);
  };
  const pauseStopwatch = () => {
    if (stopwatchStart != null) {
      setStopwatchBaseElapsed(Math.max(0, Math.floor((Date.now() - stopwatchStart) / 1000)));
    }
    setStopwatchStart(null);
    setStopwatchRunning(false);
  };
  const resetStopwatch = () => {
    setStopwatchStart(null);
    setStopwatchBaseElapsed(0);
    setStopwatchRunning(false);
  };
  const startCountdown = (id: string, seconds: number) => {
    completedCountdownRef.current.delete(id);
    setCountdownEndById((current) => ({ ...current, [id]: Date.now() + seconds * 1000 }));
  };
  const pauseCountdown = (id: string) => {
    completedCountdownRef.current.delete(id);
    setCountdownEndById((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  };
  const completeCountdown = (id: string) => {
    if (completedCountdownRef.current.has(id)) return;
    completedCountdownRef.current.add(id);
    const label = countdownPresets.find((item) => item.id === id)?.label || '倒计时已结束';
    setCountdownEndById((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    const added = addNotification({ type: 'system', title: '倒计时结束', message: label, sourceKey: `countdown:${id}:${countdownEndById[id] ?? 'done'}` });
    if (added) playNotificationSound();
  };
  const createTask = () => {
    const title = taskTitle.trim() || typeMeta[taskType].label;
    if (taskType === 'countdown') addCountdownPreset({ label: title, seconds: Math.max(1, taskMinutes) * 60 });
    if (taskType === 'alarm') addAlarm({ label: title, time: taskTime });
    if (taskType === 'reminder') addReminder({ title, remindAt: new Date(taskAt).toISOString() });
    if (taskType === 'todo') {
      const reminderDate = new Date(taskAt);
      addTodo({
        title,
        description: '来自时间中心的提醒',
        priority: 'medium',
        dueDate: toLocalDateString(reminderDate),
        reminderAt: reminderDate.toISOString(),
      });
    }
  };
  const addCustomTimezone = () => {
    const option = TIMEZONE_OPTIONS.find((item) => item.value === zoneValue);
    const label = zoneLabel.trim() || option?.label || zoneValue;
    if (!zoneValue || worldClocks.some((clock) => clock.timeZone === zoneValue && clock.label === label)) return;
    addWorldClock({ label, timeZone: zoneValue });
    setZoneLabel('');
  };

  return (
    <div className="w-full pt-2">
      <PageTitle title="时间中心" subtitle="统一管理计时、倒计时、闹钟与提醒" icon={<AlarmClock size={22} />} />

      <section className="theme-card mb-4 rounded-lg p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          <TimeCenterClock date={now} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="font-mono text-3xl font-semibold text-[var(--text-primary)]">{now.toLocaleTimeString('zh-CN')}</p>
                <p className="mt-1 text-sm text-[var(--text-muted)]">{now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</p>
              </div>
              <div className="grid gap-2 md:w-[420px] md:grid-cols-[96px_1fr_auto]">
                <input
                  value={zoneLabel}
                  onChange={(e) => setZoneLabel(e.target.value)}
                  className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-2 py-2 text-xs text-[var(--text-primary)]"
                  placeholder="名称"
                />
                <select
                  value={zoneValue}
                  onChange={(e) => setZoneValue(e.target.value)}
                  className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-2 py-2 text-xs text-[var(--text-primary)]"
                >
                  {TIMEZONE_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>{item.label} · {item.value}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={addCustomTimezone}
                  className="inline-flex items-center justify-center gap-1 rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-medium text-white transition hover:bg-[var(--accent-hover)]"
                >
                  <Plus size={13} />
                  时区
                </button>
              </div>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-4">
              {worldClocks.map((clock) => (
                <div key={clock.id} className="group relative flex items-center justify-between gap-2 rounded-lg bg-[var(--bg-elevated)] px-3 py-2">
                  <div className="min-w-0 flex-1">
                    {clock.id === 'local' ? (
                      <>
                        <p className="truncate text-xs text-[var(--text-muted)]">{clock.label}</p>
                        <p className="truncate text-[10px] text-[var(--text-muted)]">{clock.timeZone}</p>
                      </>
                    ) : (
                      <div className="grid gap-1">
                        <input
                          value={clock.label}
                          onChange={(e) => updateWorldClock(clock.id, { label: e.target.value })}
                          className="min-w-0 rounded border border-transparent bg-transparent px-1 text-xs text-[var(--text-muted)] outline-none transition focus:border-[var(--border)] focus:bg-[var(--bg-card)]"
                          aria-label="时区名称"
                        />
                        <select
                          value={clock.timeZone}
                          onChange={(e) => {
                            const option = TIMEZONE_OPTIONS.find((item) => item.value === e.target.value);
                            updateWorldClock(clock.id, { timeZone: e.target.value, label: clock.label.trim() || option?.label || e.target.value });
                          }}
                          className="min-w-0 rounded border border-transparent bg-transparent px-1 text-[10px] text-[var(--text-muted)] outline-none transition focus:border-[var(--border)] focus:bg-[var(--bg-card)]"
                          aria-label="选择时区"
                        >
                          {TIMEZONE_OPTIONS.map((item) => (
                            <option key={item.value} value={item.value}>{item.label} · {item.value}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <p className="font-mono text-base text-[var(--accent)]">{formatTimeInZone(now, clock.timeZone)}</p>
                    {clock.id !== 'local' && (
                      <button
                        type="button"
                        onClick={() => removeWorldClock(clock.id)}
                        className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded text-[var(--text-muted)] opacity-0 transition hover:bg-[var(--bg-card)] hover:text-[var(--danger)] group-hover:opacity-100"
                        title="删除时区"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border-light)] bg-[var(--bg-elevated)] p-3">
            <p className="text-xs text-[var(--text-muted)]">当前时间任务</p>
            <p className="mt-1 text-2xl font-semibold text-[var(--accent)]">{rows.length}</p>
          </div>
        </div>
      </section>

      <section className="theme-card rounded-lg p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-medium text-[var(--text-primary)]">时间任务表</h3>
            <p className="text-xs text-[var(--text-muted)]">同一张表里管理所有时间控件。</p>
          </div>
          <div className="grid w-full gap-2 md:w-auto md:grid-cols-[110px_180px_110px_170px_auto]">
            <select value={taskType} onChange={(e) => setTaskType(e.target.value as TaskType)} className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-2 py-2 text-xs">
              <option value="countdown">倒计时</option>
              <option value="alarm">闹钟</option>
              <option value="reminder">提醒</option>
              <option value="todo">待办提醒</option>
            </select>
            <input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-2 py-2 text-xs" placeholder="任务名称" />
            {taskType === 'countdown' ? (
              <input type="number" min={1} value={taskMinutes} onChange={(e) => setTaskMinutes(Math.max(1, Number(e.target.value) || 1))} className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-2 py-2 text-xs" />
            ) : taskType === 'alarm' ? (
              <input type="time" value={taskTime} onChange={(e) => setTaskTime(e.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-2 py-2 text-xs" />
            ) : (
              <input type="datetime-local" value={taskAt} onChange={(e) => setTaskAt(e.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-2 py-2 text-xs" />
            )}
            <span className="hidden rounded-lg bg-[var(--bg-elevated)] px-2 py-2 text-xs text-[var(--text-muted)] md:block">{taskType === 'countdown' ? '分钟' : taskType === 'alarm' ? '每日触发' : taskType === 'todo' ? '同步待办' : '单次触发'}</span>
            <button onClick={createTask} className="flex items-center justify-center gap-1 rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-medium text-white"><Plus size={13} />添加</button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-separate border-spacing-y-1 text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--text-muted)]">
                <th className="px-3 py-2 font-medium">类型</th>
                <th className="px-3 py-2 font-medium">名称</th>
                <th className="px-3 py-2 font-medium">目标</th>
                <th className="px-3 py-2 font-medium">当前</th>
                <th className="px-3 py-2 font-medium">状态</th>
                <th className="px-3 py-2 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.type}-${row.id}`} className="bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
                  <td className="rounded-l-lg px-3 py-2">
                    <span className="inline-flex items-center gap-1.5 text-[var(--accent)]">{typeMeta[row.type].icon}{typeMeta[row.type].label}</span>
                  </td>
                  <td className="px-3 py-2 font-medium text-[var(--text-primary)]">{row.title}</td>
                  <td className="px-3 py-2">{row.target}</td>
                  <td className="px-3 py-2 font-mono text-base text-[var(--text-primary)]">
                    {row.type === 'countdown' ? (
                      <CountdownDisplay
                        id={row.id}
                        seconds={countdownPresets.find((item) => item.id === row.id)?.seconds || 60}
                        endAt={countdownEndById[row.id]}
                        onComplete={completeCountdown}
                      />
                    ) : row.display}
                  </td>
                  <td className="px-3 py-2">{row.status}</td>
                  <td className="rounded-r-lg px-3 py-2">
                    <div className="flex justify-end gap-1">
                      {row.type === 'stopwatch' && (
                        <>
                          <button onClick={stopwatchRunning ? pauseStopwatch : startStopwatch} className="rounded-md bg-[var(--accent)] px-2 py-1 text-white">{stopwatchRunning ? <Pause size={13} /> : <Play size={13} />}</button>
                          <button onClick={resetStopwatch} className="rounded-md bg-[var(--bg-card)] px-2 py-1 text-[var(--text-muted)]"><RotateCcw size={13} /></button>
                        </>
                      )}
                      {row.type === 'countdown' && (
                        <>
                          <button onClick={() => countdownEndById[row.id] ? pauseCountdown(row.id) : startCountdown(row.id, countdownPresets.find((item) => item.id === row.id)?.seconds || 60)} className="rounded-md bg-[var(--accent)] px-2 py-1 text-white">{countdownEndById[row.id] ? <Pause size={13} /> : <Play size={13} />}</button>
                          <button onClick={() => removeCountdownPreset(row.id)} className="rounded-md bg-[var(--bg-card)] px-2 py-1 text-[var(--text-muted)] hover:text-[var(--danger)]"><Trash2 size={13} /></button>
                        </>
                      )}
                      {row.type === 'alarm' && (
                        <>
                          <button onClick={() => toggleAlarm(row.id)} className="rounded-md bg-[var(--bg-card)] px-2 py-1 text-[var(--text-muted)]">{row.enabled ? '停用' : '启用'}</button>
                          <button onClick={() => removeAlarm(row.id)} className="rounded-md bg-[var(--bg-card)] px-2 py-1 text-[var(--text-muted)] hover:text-[var(--danger)]"><Trash2 size={13} /></button>
                        </>
                      )}
                      {(row.type === 'reminder' || row.type === 'todo') && row.type !== 'todo' && (
                        <>
                          <button onClick={() => toggleReminder(row.id)} className="rounded-md bg-[var(--bg-card)] px-2 py-1 text-[var(--text-muted)]">{row.enabled ? '停用' : '启用'}</button>
                          <button onClick={() => removeReminder(row.id)} className="rounded-md bg-[var(--bg-card)] px-2 py-1 text-[var(--text-muted)] hover:text-[var(--danger)]"><Trash2 size={13} /></button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
