import React, { useCallback, useMemo, useRef, useState } from 'react';
import Clock from 'react-clock';
import 'react-clock/dist/Clock.css';
import { AlarmClock, Eye, EyeOff, Hourglass, Maximize2, Minimize2, Pause, Play, Plus, RotateCcw, Settings2, TimerReset, X } from 'lucide-react';
import { PageTitle } from '../shared';
import { useNotificationStore, useScheduleStore, useTimeCenterStore } from '../../stores';
import { playNotificationSound } from '../../lib/sounds';
import { toLocalDateString } from '../../lib/date';
import { generateId } from '../../lib/id';
import { useClockNow } from '../../hooks/useClockNow';
import { userScopedStorage } from '../../lib/userScopedStorage';

/* ------------------------------------------------------------------ */
/*  Widget system                                                      */
/* ------------------------------------------------------------------ */

type WidgetId = 'hero-clock' | 'world-clocks' | 'stopwatch' | 'active-countdown' | 'quick-presets';
type WidgetSize = 'small' | 'large' | 'full';

interface WidgetLayout {
  id: WidgetId;
  enabled: boolean;
  position: number;
  size: WidgetSize;
}

const WIDGET_META: Record<WidgetId, { label: string; icon: React.ReactNode }> = {
  'hero-clock': { label: '当前时间', icon: <AlarmClock size={14} /> },
  'world-clocks': { label: '世界时钟', icon: <TimerReset size={14} /> },
  'stopwatch': { label: '正计时', icon: <TimerReset size={14} /> },
  'active-countdown': { label: '运行中倒计时', icon: <Hourglass size={14} /> },
  'quick-presets': { label: '快捷预设', icon: <Play size={14} /> },
};

const DEFAULT_LAYOUT: WidgetLayout[] = [
  { id: 'hero-clock', enabled: true, position: 0, size: 'large' },
  { id: 'world-clocks', enabled: true, position: 1, size: 'large' },
  { id: 'stopwatch', enabled: true, position: 2, size: 'small' },
  { id: 'active-countdown', enabled: true, position: 3, size: 'small' },
  { id: 'quick-presets', enabled: true, position: 4, size: 'small' },
];

/* ------------------------------------------------------------------ */
/*  Helpers (kept from original)                                       */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  WidgetCard  (drag + zoom, mirrors PluginCard)                     */
/* ------------------------------------------------------------------ */

interface WidgetCardProps {
  id: WidgetId;
  size: WidgetSize;
  dragId: string | null;
  overId: string | null;
  onDragStart: (id: string) => void;
  onDragOver: (id: string) => void;
  onDragLeave: () => void;
  onDrop: (id: string) => void;
  onDragEnd: () => void;
  onToggleSize: (id: string) => void;
  onToggleEnabled: (id: string) => void;
  children: React.ReactNode;
}

const WidgetCard: React.FC<WidgetCardProps> = React.memo(({
  id, size, dragId, overId, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd, onToggleSize, onToggleEnabled, children,
}) => {
  const meta = WIDGET_META[id];
  const isDragging = dragId === id;
  const isDropTarget = overId === id && dragId !== id;

  return (
    <div
      className={`tc-widget ${isDragging ? 'opacity-40' : ''} ${isDropTarget ? 'ring-2 ring-[var(--accent)] ring-offset-2 rounded-2xl' : ''}`}
      data-size={size}
      draggable
      onDragStart={(e) => {
        if ((e.target as HTMLElement).closest('button')) { e.preventDefault(); return; }
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
        onDragStart(id);
      }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDragOver(id); }}
      onDragLeave={() => onDragLeave()}
      onDrop={(e) => { e.preventDefault(); onDrop(id); }}
      onDragEnd={() => onDragEnd()}
    >
      <div className="bg-[var(--bg-card)] rounded-2xl md:rounded-xl border border-[var(--border-light)] shadow-sm overflow-hidden flex flex-col h-full">
        <div className="flex items-center justify-between px-4 py-2.5 md:px-3 md:py-2 border-b border-[var(--border-light)]">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[var(--accent)]">{meta.icon}</span>
            <h3 className="font-semibold text-[var(--text-primary)] text-sm truncate">{meta.label}</h3>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => onToggleSize(id)}
              className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] rounded-lg transition-colors"
              title={size === 'full' || size === 'large' ? '缩小' : '放大'}
            >
              {size === 'full' || size === 'large' ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
            <button
              onClick={() => onToggleEnabled(id)}
              className="p-1.5 text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] rounded-lg transition-colors"
              title="隐藏此组件"
            >
              <X size={13} />
            </button>
          </div>
        </div>
        <div className="p-3 md:p-2 flex-1 overflow-auto">{children}</div>
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  Widget contents                                                    */
/* ------------------------------------------------------------------ */

function HeroClockWidget({ now }: { now: Date }) {
  return (
    <div className="flex flex-col md:flex-row items-center justify-center md:justify-evenly h-full w-full gap-4 md:gap-0">
      <div className="time-center-clock-shell shrink-0">
        <Clock value={now} size={104} renderNumbers hourMarksLength={8} minuteMarksLength={3} />
      </div>
      <div className="shrink-0 text-center md:text-left">
        <p className="font-mono text-3xl font-semibold text-[var(--text-primary)]">{now.toLocaleTimeString('zh-CN')}</p>
        <p className="mt-1 text-sm text-[var(--text-muted)]">{now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</p>
      </div>
    </div>
  );
}

function WorldClocksWidget({ now }: { now: Date }) {
  const { worldClocks, addWorldClock, removeWorldClock, updateWorldClock } = useTimeCenterStore();
  const [zoneLabel, setZoneLabel] = useState('');
  const [zoneValue, setZoneValue] = useState('Asia/Shanghai');
  return (
    <div className="flex flex-col gap-3 flex-1 pt-3">
      <div className="flex flex-wrap gap-2">
        <input value={zoneLabel} onChange={(e) => setZoneLabel(e.target.value)} placeholder="名称" className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-2 py-1.5 text-xs flex-1 min-w-0" />
        <select value={zoneValue} onChange={(e) => setZoneValue(e.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-2 py-1.5 text-xs flex-[2] min-w-0">
          {TIMEZONE_OPTIONS.map((item) => (<option key={item.value} value={item.value}>{item.label} · {item.value}</option>))}
        </select>
        <button
          onClick={() => {
            const option = TIMEZONE_OPTIONS.find((item) => item.value === zoneValue);
            const label = zoneLabel.trim() || option?.label || zoneValue;
            if (!zoneValue || worldClocks.some((c) => c.timeZone === zoneValue && c.label === label)) return;
            addWorldClock({ label, timeZone: zoneValue });
            setZoneLabel('');
          }}
          className="inline-flex items-center justify-center gap-1 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[var(--accent-hover)]"
        >
          <Plus size={13} /> 时区
        </button>
      </div>
      <div className="flex flex-wrap gap-3 content-start pt-1">
        {worldClocks.map((clock) => (
          <div key={clock.id} className="group relative flex flex-col items-center justify-center rounded-lg bg-[var(--bg-elevated)] px-3 py-2 border border-[var(--border-light)] flex-1 min-w-0 h-[56px]">
            {clock.id === 'local' ? (
              <>
                <p className="truncate text-xs text-[var(--text-muted)] h-4 leading-4">{clock.label}</p>
                <p className="font-mono text-sm leading-none text-[var(--accent)]">{formatTimeInZone(now, clock.timeZone)}</p>
              </>
            ) : (
              <>
                <input value={clock.label} onChange={(e) => updateWorldClock(clock.id, { label: e.target.value })} className="text-center min-w-0 h-4 leading-4 p-0 m-0 rounded border border-transparent bg-transparent text-xs text-[var(--text-muted)] outline-none transition focus:border-[var(--border)] focus:bg-[var(--bg-card)] w-full" />
                <p className="font-mono text-sm leading-none text-[var(--text-primary)]">{formatTimeInZone(now, clock.timeZone)}</p>
                <button onClick={() => removeWorldClock(clock.id)} className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded text-[var(--text-muted)] opacity-0 transition hover:bg-[var(--bg-card)] hover:text-[var(--danger)] group-hover:opacity-100">
                  <X size={10} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function StopwatchWidget({ elapsed, running, onStart, onPause, onReset }: {
  elapsed: number;
  running: boolean;
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 pt-4">
      <p className="font-mono text-4xl font-bold text-[var(--text-primary)]">{formatSeconds(elapsed)}</p>
      <div className="flex gap-2">
        <button onClick={running ? onPause : onStart} className="w-10 h-10 rounded-xl bg-[var(--accent)] text-white flex items-center justify-center">{running ? <Pause size={18} /> : <Play size={18} />}</button>
        <button onClick={onReset} className="w-10 h-10 rounded-xl bg-[var(--bg-elevated)] text-[var(--text-muted)] flex items-center justify-center hover:text-[var(--text-secondary)]"><RotateCcw size={16} /></button>
      </div>
    </div>
  );
}

function ActiveCountdownWidget({
  countdownEndById, countdownPresets, onPause, onComplete,
}: {
  countdownEndById: Record<string, number>;
  countdownPresets: { id: string; label: string; seconds: number }[];
  onPause: (id: string) => void;
  onComplete: (id: string) => void;
}) {
  const active = useMemo(() => {
    return Object.entries(countdownEndById).map(([id, endAt]) => {
      const preset = countdownPresets.find((p) => p.id === id);
      return { id, endAt, label: preset?.label || '倒计时', total: preset?.seconds || 60 };
    });
  }, [countdownEndById, countdownPresets]);

  const [nowMs] = useState(() => Date.now());

  if (active.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 text-[var(--text-muted)] h-full">
        <Hourglass size={18} />
        <span className="text-xs">暂无运行中的倒计时</span>
      </div>
    );
  }
  return (
    <div className="space-y-2 max-h-[260px] overflow-y-auto">
      {active.map(({ id, endAt, label, total }) => {
        const remaining = Math.max(0, Math.ceil((endAt - nowMs) / 1000));
        const pct = Math.min(100, Math.max(0, ((total - remaining) / total) * 100));
        return (
          <div key={id} className="bg-[var(--bg-elevated)] rounded-xl p-2 border border-[var(--border-light)]">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-[var(--text-primary)]">{label}</p>
              <p className="font-mono text-sm font-bold text-blue-500">{formatSeconds(remaining)}</p>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
              </div>
              <button onClick={() => onPause(id)} className="shrink-0 px-2 py-0.5 rounded-lg bg-blue-500 text-white text-xs">暂停</button>
              <button onClick={() => onComplete(id)} className="shrink-0 px-2 py-0.5 rounded-lg bg-[var(--bg-card)] text-[var(--text-muted)] text-xs hover:text-[var(--danger)]">取消</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function QuickPresetsWidget({ onStart: _onStart }: { onStart: (id: string, seconds: number) => void }) {
  const { countdownPresets, addCountdownPreset } = useTimeCenterStore();
  const [customMin, setCustomMin] = useState('');
  const presets = [
    { label: '5 分', seconds: 5 * 60 },
    { label: '15 分', seconds: 15 * 60 },
    { label: '25 分', seconds: 25 * 60 },
    { label: '45 分', seconds: 45 * 60 },
    { label: '60 分', seconds: 60 * 60 },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-5 gap-3">
        {presets.map((p) => (
          <button
            key={p.seconds}
            onClick={() => {
              const existing = countdownPresets.find((c) => c.seconds === p.seconds);
              if (existing) _onStart(existing.id, p.seconds);
              else { const newId = generateId(); addCountdownPreset({ label: p.label, seconds: p.seconds }); _onStart(newId, p.seconds); }
            }}
            className="py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-light)] text-xs font-medium text-[var(--text-primary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition"
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex gap-3">
        <input type="number" min={1} value={customMin} onChange={(e) => setCustomMin(e.target.value)} placeholder="自定义分钟" className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-2 py-1.5 text-xs" />
        <button
          onClick={() => {
            const min = Math.max(1, Number(customMin) || 1);
            const newId = generateId();
            addCountdownPreset({ label: `${min} 分钟`, seconds: min * 60 });
            _onStart(newId, min * 60);
            setCustomMin('');
          }}
          className="px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-xs font-medium"
        >
          开始
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Task creator form (used inside a widget or as a floating bar)     */
/* ------------------------------------------------------------------ */

function TaskCreator() {
  const [taskType, setTaskType] = useState<'countdown' | 'todo'>('countdown');
  const [taskTitle, setTaskTitle] = useState('新的时间任务');
  const [taskMinutes, setTaskMinutes] = useState(5);
  const [taskAt, setTaskAt] = useState(() => toDateTimeInput(new Date(Date.now() + 30 * 60 * 1000)));

  const { addCountdownPreset } = useTimeCenterStore();
  // 待办统一走 scheduleStore（后端 schedule_items 表）。
  // 待办统一写这里：
  // 在时间中心建的待办不会出现在待办页 —— 两边数据不通。
  const addTodo = useScheduleStore((s) => s.addTodo);

  const create = () => {
    const title = taskTitle.trim() || (taskType === 'countdown' ? '倒计时' : '待办提醒');
    if (taskType === 'countdown') addCountdownPreset({ label: title, seconds: Math.max(1, taskMinutes) * 60 });
    if (taskType === 'todo') {
      const d = new Date(taskAt);
      addTodo({ title, description: '来自时间中心的提醒', priority: 'medium', dueAt: toLocalDateString(d), reminderAt: d.toISOString() });
    }
    setTaskTitle('新的时间任务');
    setTaskMinutes(5);
    setTaskAt(toDateTimeInput(new Date(Date.now() + 30 * 60 * 1000)));
  };

  return (
    <div className="flex flex-wrap items-center gap-2 bg-[var(--bg-elevated)] rounded-xl p-3 border border-[var(--border-light)]">
      <select value={taskType} onChange={(e) => setTaskType(e.target.value as typeof taskType)} className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-2 py-1.5 text-xs">
        <option value="countdown">倒计时</option>
        <option value="todo">待办提醒</option>
      </select>
      <input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="任务名称" className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-2 py-1.5 text-xs flex-1 min-w-[80px]" />
      {taskType === 'countdown' ? (
        <input type="number" min={1} value={taskMinutes} onChange={(e) => setTaskMinutes(Math.max(1, Number(e.target.value) || 1))} className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-2 py-1.5 text-xs w-16" />
      ) : (
        <input type="datetime-local" value={taskAt} onChange={(e) => setTaskAt(e.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-2 py-1.5 text-xs" />
      )}
      <button onClick={create} className="inline-flex items-center gap-1 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white">
        <Plus size={13} /> 添加
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export const TimeCenterPage2: React.FC = () => {
  const now = useClockNow();

  const validWidgetIds = new Set<WidgetId>(['hero-clock', 'world-clocks', 'stopwatch', 'active-countdown', 'quick-presets']);
  const [layout, setLayout] = useState<WidgetLayout[]>(() => {
    try {
      const raw = userScopedStorage.getItem('p2m-timecenter-layout');
      if (raw) {
        const parsed = JSON.parse(raw) as WidgetLayout[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          const filtered = parsed.filter((item) => validWidgetIds.has(item.id));
          if (filtered.length > 0) return filtered;
        }
      }
    } catch { /* ignore */ }
    return DEFAULT_LAYOUT;
  });
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [showManager, setShowManager] = useState(false);

  /* stopwatch state (page-level so it survives widget hide/show) */
  const [swBase, setSwBase] = useState(0);
  const [swStartAt, setSwStartAt] = useState<number | null>(null);
  const swElapsed = swStartAt != null
    ? swBase + Math.max(0, Math.floor((now.getTime() - swStartAt) / 1000))
    : swBase;
  const swRunning = swStartAt != null;
  const startStopwatch = () => setSwStartAt(Date.now());
  const pauseStopwatch = () => {
    if (swStartAt != null) {
      setSwBase(swBase + Math.max(0, Math.floor((Date.now() - swStartAt) / 1000)));
    }
    setSwStartAt(null);
  };
  const resetStopwatch = () => { setSwStartAt(null); setSwBase(0); };

  /* countdown state */
  const [countdownEndById, setCountdownEndById] = useState<Record<string, number>>({});
  const completedCountdownRef = useRef<Set<string>>(new Set());

  const { countdownPresets } = useTimeCenterStore();
  const addNotification = useNotificationStore((s) => s.addNotification);

  const startCountdown = useCallback((id: string, seconds: number) => {
    completedCountdownRef.current.delete(id);
    setCountdownEndById((current) => ({ ...current, [id]: Date.now() + seconds * 1000 }));
  }, []);

  const pauseCountdown = useCallback((id: string) => {
    completedCountdownRef.current.delete(id);
    setCountdownEndById((current) => { const next = { ...current }; delete next[id]; return next; });
  }, []);

  const completeCountdown = useCallback((id: string) => {
    if (completedCountdownRef.current.has(id)) return;
    completedCountdownRef.current.add(id);
    const label = countdownPresets.find((item) => item.id === id)?.label || '倒计时已结束';
    setCountdownEndById((current) => { const next = { ...current }; delete next[id]; return next; });
    const added = addNotification({ type: 'system', title: '倒计时结束', message: label, sourceKey: `countdown:${id}:${countdownEndById[id] ?? 'done'}` });
    if (added) playNotificationSound();
  }, [addNotification, countdownEndById, countdownPresets]);

  /* widget layout helpers */
  const enabledWidgets = useMemo(() => {
    const list = layout.filter((l) => l.enabled);
    list.sort((a, b) => a.position - b.position);
    return list;
  }, [layout]);

  const hiddenCount = layout.length - enabledWidgets.length;
  const allFull = enabledWidgets.length > 0 && enabledWidgets.every((w) => w.size === 'full');

  const swapWidgets = useCallback((idA: string, idB: string) => {
    setLayout((prev) => {
      const a = prev.find((i) => i.id === idA);
      const b = prev.find((i) => i.id === idB);
      if (!a || !b) return prev;
      const next = prev.map((item) => {
        if (item.id === idA) return { ...item, position: b.position };
        if (item.id === idB) return { ...item, position: a.position };
        return item;
      });
      userScopedStorage.setItem('p2m-timecenter-layout', JSON.stringify(next));
      return next;
    });
  }, []);

  const toggleWidgetSize = useCallback((id: string) => {
    setLayout((prev) => {
      const item = prev.find((i) => i.id === id);
      if (!item) return prev;
      const nextSize: WidgetSize = item.size === 'small' ? 'large' : 'small';
      const next = prev.map((i) => (i.id === id ? { ...i, size: nextSize } : i));
      userScopedStorage.setItem('p2m-timecenter-layout', JSON.stringify(next));
      return next;
    });
  }, []);

  const toggleWidgetEnabled = useCallback((id: string) => {
    setLayout((prev) => {
      const next = prev.map((i) => (i.id === id ? { ...i, enabled: !i.enabled } : i));
      userScopedStorage.setItem('p2m-timecenter-layout', JSON.stringify(next));
      return next;
    });
  }, []);

  const setAllWidgetSize = useCallback((size: WidgetSize) => {
    setLayout((prev) => {
      const next = prev.map((i) => (i.enabled ? { ...i, size } : i));
      userScopedStorage.setItem('p2m-timecenter-layout', JSON.stringify(next));
      return next;
    });
  }, []);

  const handleDrop = useCallback((id: string) => {
    if (dragId && dragId !== id) swapWidgets(dragId, id);
    setDragId(null);
    setOverId(null);
  }, [dragId, swapWidgets]);

  const renderWidgetContent = (widgetId: WidgetId) => {
    switch (widgetId) {
      case 'hero-clock': return <HeroClockWidget now={now} />;
      case 'world-clocks': return <WorldClocksWidget now={now} />;
      case 'stopwatch': return (
        <StopwatchWidget
          elapsed={swElapsed}
          running={swRunning}
          onStart={startStopwatch}
          onPause={pauseStopwatch}
          onReset={resetStopwatch}
        />
      );
      case 'active-countdown': return (
        <ActiveCountdownWidget
          countdownEndById={countdownEndById}
          countdownPresets={countdownPresets}
          onPause={pauseCountdown}
          onComplete={completeCountdown}
        />
      );
      case 'quick-presets': return <QuickPresetsWidget onStart={startCountdown} />;
      default: return null;
    }
  };

  return (
    <div className="w-full pt-2 space-y-3">
      <PageTitle
        title="时间中心"
        subtitle="拖动卡片调整位置，点一下可以放大或缩小"
        icon={<AlarmClock size={22} />}
      />

      <TaskCreator />

      <div className="flex items-center justify-start gap-2">
        <button
          onClick={() => setShowManager(!showManager)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors"
          style={{ color: showManager ? 'var(--accent)' : 'var(--text-secondary)', borderColor: showManager ? 'var(--accent)' : 'var(--border-light)', backgroundColor: 'var(--bg-card)' }}
        >
          <Settings2 size={13} />
          管理组件{hiddenCount > 0 && ` (${hiddenCount} 个已隐藏)`}
        </button>
        {enabledWidgets.length > 0 && (
          <button
            onClick={() => setAllWidgetSize(allFull ? 'small' : 'full')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors"
            style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-light)', backgroundColor: 'var(--bg-card)' }}
          >
            {allFull ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            {allFull ? '全部缩小' : '全部展开'}
          </button>
        )}
      </div>

      {showManager && (
        <div className="mb-4 p-3 rounded-xl border border-[var(--border-light)] bg-[var(--bg-card)]">
          <div className="flex flex-wrap gap-2">
            {DEFAULT_LAYOUT.map((w) => {
              const item = layout.find((l) => l.id === w.id);
              const enabled = item?.enabled !== false;
              return (
                <button
                  key={w.id}
                  onClick={() => toggleWidgetEnabled(w.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors"
                  style={{
                    color: enabled ? 'var(--text-primary)' : 'var(--text-muted)',
                    borderColor: enabled ? 'var(--accent)' : 'var(--border-light)',
                    backgroundColor: enabled ? 'var(--accent-bg)' : 'var(--bg-elevated)',
                  }}
                >
                  {WIDGET_META[w.id].icon}
                  {WIDGET_META[w.id].label}
                  {enabled ? <Eye size={12} /> : <EyeOff size={12} />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="tc-grid">
        {enabledWidgets.map((widget) => (
          <WidgetCard
            key={widget.id}
            id={widget.id}
            size={widget.size}
            dragId={dragId}
            overId={overId}
            onDragStart={setDragId}
            onDragOver={setOverId}
            onDragLeave={() => setOverId(null)}
            onDrop={handleDrop}
            onDragEnd={() => { setDragId(null); setOverId(null); }}
            onToggleSize={toggleWidgetSize}
            onToggleEnabled={toggleWidgetEnabled}
          >
            {renderWidgetContent(widget.id)}
          </WidgetCard>
        ))}
      </div>

      {enabledWidgets.length === 0 && !showManager && (
        <div className="text-center py-16 text-sm" style={{ color: 'var(--text-muted)' }}>
          <EyeOff size={32} className="mx-auto mb-3 opacity-40" />
          <p>所有组件都被隐藏了</p>
          <button onClick={() => setShowManager(true)} className="mt-2 text-xs underline" style={{ color: 'var(--accent)' }}>点这里打开管理面板恢复</button>
        </div>
      )}
    </div>
  );
};
