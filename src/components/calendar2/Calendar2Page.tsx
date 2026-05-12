import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { PageTitle } from '../shared';
import { useScheduleStore } from '../../stores';
import { toISODateString } from '../../lib/date';
import { playInteractionSound } from '../../lib/sounds';
import { PRIORITY_COLORS, type ScheduleItem, type TodoPriority, type TodoStatus } from '../../types';
import { combineLocalDateTime, datePart, hasScheduleTime } from '../../lib/scheduleTime';

interface ScheduledWeekItem extends ScheduleItem {
  startAt: string;
  dueAt: string;
}

interface WeekEvent {
  id: string;
  title: string;
  dayIndex: number;
  startMinutes: number;
  endMinutes: number;
  color: string;
  item: ScheduledWeekItem;
}

interface LaidOutWeekEvent extends WeekEvent {
  conflictColumn: number;
  conflictColumns: number;
}

interface DraftSelection {
  dayIndex: number;
  startMinutes: number;
  endMinutes: number;
  title?: string;
  color?: string;
  priority?: TodoPriority;
  itemId?: string;
  type?: 'todo' | 'event';
}

interface CalendarLane {
  id: TodoPriority;
  title: string;
  color: string;
}

const START_HOUR = 6;
const END_HOUR = 23;
const HOUR_HEIGHT = 64;
const SNAP_MINUTES = 15;
const DEFAULT_DAY_WIDTH = 124;
const LEFT_GUTTER = 64;
const MIN_DAY_WIDTH = 72;
const EVENT_SIDE_INSET = 8;
const EVENT_OVERLAP_GAP = 4;
const SHORT_EVENT_HEIGHT = 34;
const COMPACT_EVENT_HEIGHT = 48;
const DESKTOP_PANEL_BREAKPOINT = 1080;
const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const CALENDAR_LANES: CalendarLane[] = [
  { id: 'high', title: '粉色待办', color: PRIORITY_COLORS.high },
  { id: 'medium', title: '黄色待办', color: PRIORITY_COLORS.medium },
  { id: 'low', title: '蓝色待办', color: PRIORITY_COLORS.low },
  { id: 'green', title: '绿色待办', color: PRIORITY_COLORS.green },
];
const STATUS_FILTERS: Array<{ id: TodoStatus; title: string; color: string }> = [
  { id: 'pending', title: '待处理', color: '#9ca3af' },
  { id: 'in_progress', title: '进行中', color: '#f59e0b' },
  { id: 'completed', title: '已完成', color: '#16a34a' },
];

function startOfWeek(date: Date): Date {
  const next = new Date(date);
  const day = next.getDay() || 7;
  next.setDate(next.getDate() - day + 1);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfMonthGrid(date: Date): Date {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const day = first.getDay() || 7;
  first.setDate(first.getDate() - day + 1);
  return first;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function snapMinutes(minutes: number): number {
  return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
}

function formatTime(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const prefix = hour < 12 ? '上午' : '下午';
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${prefix}${displayHour}:${String(minute).padStart(2, '0')}`;
}

function formatTimeInput(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function formatHourLabel(hour: number): string {
  if (hour === 12) return '下午12点';
  return hour < 12 ? `上午${hour}点` : `下午${hour - 12}点`;
}

function minutesToTop(minutes: number): number {
  return ((minutes - START_HOUR * 60) / 60) * HOUR_HEIGHT;
}

function durationToHeight(startMinutes: number, endMinutes: number): number {
  return Math.max(24, ((endMinutes - startMinutes) / 60) * HOUR_HEIGHT);
}

function getClientSelection(
  clientX: number,
  clientY: number,
  grid: HTMLDivElement,
  dayWidth: number,
  visibleDayOffset: number,
  visibleDayCount: number,
): { dayIndex: number; minutes: number } {
  const rect = grid.getBoundingClientRect();
  const x = clientX - rect.left - LEFT_GUTTER;
  const y = clientY - rect.top;
  const dayIndex = clamp(visibleDayOffset + Math.floor(x / dayWidth), visibleDayOffset, visibleDayOffset + visibleDayCount - 1);
  const rawMinutes = START_HOUR * 60 + (y / HOUR_HEIGHT) * 60;
  const minutes = clamp(snapMinutes(rawMinutes), START_HOUR * 60, END_HOUR * 60);
  return { dayIndex, minutes };
}

function eventColor(item: ScheduleItem): string {
  if (item.type === 'event') return '#8b5cf6';
  return item.status === 'completed' ? '#16a34a' : PRIORITY_COLORS[item.priority];
}

function minutesFromIso(iso: string): number {
  const date = new Date(iso);
  return date.getHours() * 60 + date.getMinutes();
}

function layoutConflictGroup(group: WeekEvent[]): LaidOutWeekEvent[] {
  const sorted = [...group].sort((a, b) =>
    a.startMinutes - b.startMinutes
    || b.endMinutes - a.endMinutes
    || a.title.localeCompare(b.title)
    || a.id.localeCompare(b.id)
  );
  const columnEnds: number[] = [];
  const columnsById = new Map<string, number>();

  sorted.forEach((event) => {
    const column = columnEnds.findIndex((endMinutes) => endMinutes <= event.startMinutes);
    const nextColumn = column === -1 ? columnEnds.length : column;
    columnEnds[nextColumn] = event.endMinutes;
    columnsById.set(event.id, nextColumn);
  });

  const conflictColumns = Math.max(1, columnEnds.length);
  return group.map((event) => ({
    ...event,
    conflictColumn: columnsById.get(event.id) ?? 0,
    conflictColumns,
  }));
}

function layoutDayEvents(dayEvents: WeekEvent[]): LaidOutWeekEvent[] {
  const sorted = [...dayEvents].sort((a, b) =>
    a.startMinutes - b.startMinutes
    || a.endMinutes - b.endMinutes
    || a.id.localeCompare(b.id)
  );
  const groups: WeekEvent[][] = [];
  let currentGroup: WeekEvent[] = [];
  let currentGroupEnd = 0;

  sorted.forEach((event) => {
    if (currentGroup.length === 0 || event.startMinutes < currentGroupEnd) {
      currentGroup.push(event);
      currentGroupEnd = Math.max(currentGroupEnd, event.endMinutes);
      return;
    }
    groups.push(currentGroup);
    currentGroup = [event];
    currentGroupEnd = event.endMinutes;
  });

  if (currentGroup.length > 0) groups.push(currentGroup);
  return groups.flatMap(layoutConflictGroup);
}

function layoutWeekEvents(events: WeekEvent[]): LaidOutWeekEvent[] {
  return DAYS.flatMap((_, dayIndex) => layoutDayEvents(events.filter((event) => event.dayIndex === dayIndex)));
}

export const Calendar2Page: React.FC = () => {
  const scheduleItems = useScheduleStore((s) => s.items);
  const addTodo = useScheduleStore((s) => s.addTodo);
  const addEvent = useScheduleStore((s) => s.addEvent);
  const updateItem = useScheduleStore((s) => s.updateItem);
  const deleteItem = useScheduleStore((s) => s.deleteItem);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [draft, setDraft] = useState<DraftSelection | null>(null);
  const [dragAnchor, setDragAnchor] = useState<DraftSelection | null>(null);
  const [editingDraft, setEditingDraft] = useState<DraftSelection | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [createTodo, setCreateTodo] = useState(true);
  const [pageWidth, setPageWidth] = useState(0);
  const [gridAvailableWidth, setGridAvailableWidth] = useState(0);
  const [compactDayOffset, setCompactDayOffset] = useState(0);
  const [monthCollapsed, setMonthCollapsed] = useState(false);
  const [visiblePriorities, setVisiblePriorities] = useState<Record<TodoPriority, boolean>>({ high: true, medium: true, low: true, green: true });
  const [visibleStatuses, setVisibleStatuses] = useState<Record<TodoStatus, boolean>>({ pending: true, in_progress: true, completed: true });
  const [resizing, setResizing] = useState<{ id: string; startMinutes: number; dayIndex: number; newEndMinutes: number } | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const gridFrameRef = useRef<HTMLElement | null>(null);
  const dragOffsetRef = useRef(0);

  useEffect(() => {
    void useScheduleStore.getState().loadItems();
  }, []);

  useEffect(() => {
    const node = pageRef.current;
    if (!node) return;
    const updateWidth = () => setPageWidth(Math.round(Math.max(0, node.getBoundingClientRect().width)));
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const node = gridFrameRef.current;
    if (!node) return;
    const updateWidth = () => setGridAvailableWidth(Math.floor(node.clientWidth));
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, [pageWidth]);

  const monthGridDays = useMemo(() => Array.from({ length: 42 }, (_, index) => addDays(startOfMonthGrid(weekStart), index)), [weekStart]);
  const weekDays = useMemo(() => DAYS.map((label, index) => ({ label, date: addDays(weekStart, index) })), [weekStart]);
  const weekDateStrings = useMemo(() => weekDays.map((item) => toISODateString(item.date)), [weekDays]);
  const showDesktopPanel = pageWidth >= DESKTOP_PANEL_BREAKPOINT;
  const visibleDayCount = useMemo(() => {
    if (!pageWidth) return 7;
    if (pageWidth < 870) return 4;
    if (pageWidth < 1080) return 5;
    if (pageWidth < 1280) return 6;
    return 7;
  }, [pageWidth]);
  const maxCompactOffset = Math.max(0, 7 - visibleDayCount);
  const visibleDayOffset = visibleDayCount === 7 ? 0 : Math.min(compactDayOffset, maxCompactOffset);
  const visibleWeekDays = useMemo(() => weekDays.slice(visibleDayOffset, visibleDayOffset + visibleDayCount), [visibleDayCount, visibleDayOffset, weekDays]);
  const dayWidth = useMemo(() => {
    const widthSource = gridAvailableWidth || pageWidth;
    if (!widthSource) return DEFAULT_DAY_WIDTH;
    const available = Math.max(0, widthSource - LEFT_GUTTER - 1);
    const preferred = Math.floor(available / visibleDayCount);
    if (visibleDayCount === 4) return clamp(preferred, 112, 180);
    if (visibleDayCount === 5) return clamp(preferred, 104, 200);
    if (visibleDayCount === 6) return clamp(preferred, 96, 220);
    return Math.max(preferred, MIN_DAY_WIDTH);
  }, [gridAvailableWidth, pageWidth, visibleDayCount]);
  const gridWidth = gridAvailableWidth ? Math.max(0, gridAvailableWidth) : LEFT_GUTTER + visibleDayCount * dayWidth;

  const items = useMemo(() => Object.values(scheduleItems).filter((item) => !item.deletedAt), [scheduleItems]);
  const todoPool = useMemo(() => {
    const weekEnd = addDays(weekStart, 6);
    return items
      .filter((item) => item.type === 'todo' && hasScheduleTime(item) && visiblePriorities[item.priority] && visibleStatuses[item.status])
      .filter((item) => {
        if (!hasScheduleTime(item)) return false;
        const due = new Date(`${datePart(item.startAt)}T12:00:00`);
        return due >= weekStart && due <= weekEnd;
      })
      .sort((a, b) => new Date(a.startAt ?? 0).getTime() - new Date(b.startAt ?? 0).getTime());
  }, [items, visiblePriorities, visibleStatuses, weekStart]);

  const events = useMemo<WeekEvent[]>(() => items
    .flatMap((item): WeekEvent[] => {
      if (!hasScheduleTime(item) || !(item.type === 'event' || visiblePriorities[item.priority] && visibleStatuses[item.status])) return [];
      const dayIndex = weekDateStrings.indexOf(datePart(item.startAt));
      if (dayIndex < 0) return [];
      const startMinutes = minutesFromIso(item.startAt);
      const endMinutes = Math.max(startMinutes + SNAP_MINUTES, minutesFromIso(item.dueAt));
      return [{
        id: item.id,
        title: item.title,
        dayIndex,
        startMinutes,
        endMinutes,
        color: eventColor(item),
        item,
      }];
    }), [items, visiblePriorities, visibleStatuses, weekDateStrings]);
  const laidOutEvents = useMemo(() => layoutWeekEvents(events), [events]);

  const monthTitle = `${weekStart.getFullYear()}年${weekStart.getMonth() + 1}月`;
  const compactDayLabel = `${DAYS[visibleDayOffset]}-${DAYS[visibleDayOffset + visibleDayCount - 1]}`;
  const nextCompactOffset = visibleDayOffset >= maxCompactOffset ? 0 : Math.min(maxCompactOffset, visibleDayOffset + 1);

  const startSelection = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!gridRef.current || (event.target as HTMLElement).closest('[data-calendar-event]')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = getClientSelection(event.clientX, event.clientY, gridRef.current, dayWidth, visibleDayOffset, visibleDayCount);
    const next = { dayIndex: point.dayIndex, startMinutes: point.minutes, endMinutes: point.minutes + SNAP_MINUTES };
    setDragAnchor(next);
    setDraft(next);
  }, [dayWidth, visibleDayCount, visibleDayOffset]);

  const moveSelection = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!gridRef.current || !dragAnchor) return;
    const point = getClientSelection(event.clientX, event.clientY, gridRef.current, dayWidth, visibleDayOffset, visibleDayCount);
    if (point.dayIndex !== dragAnchor.dayIndex) return;
    const startMinutes = Math.min(dragAnchor.startMinutes, point.minutes);
    const endMinutes = Math.max(dragAnchor.startMinutes + SNAP_MINUTES, point.minutes);
    setDraft({ dayIndex: dragAnchor.dayIndex, startMinutes, endMinutes: clamp(endMinutes, startMinutes + SNAP_MINUTES, END_HOUR * 60) });
  }, [dayWidth, dragAnchor, visibleDayCount, visibleDayOffset]);

  const finishSelection = useCallback(() => {
    if (draft && draft.endMinutes - draft.startMinutes >= SNAP_MINUTES) {
      setEditingDraft({ ...draft, type: 'todo' });
      setDraftTitle(draft.title || '');
      setCreateTodo(true);
    }
    setDragAnchor(null);
  }, [draft]);

  const closeDraftEditor = useCallback(() => {
    setEditingDraft(null);
    setDraft(null);
    setDragAnchor(null);
    setDraftTitle('');
    setCreateTodo(true);
  }, []);

  const saveDraft = useCallback(() => {
    if (!editingDraft) return;
    const title = draftTitle.trim() || '未命名事项';
    const date = weekDateStrings[editingDraft.dayIndex];
    const startAt = combineLocalDateTime(date, formatTimeInput(editingDraft.startMinutes));
    const dueAt = combineLocalDateTime(date, formatTimeInput(editingDraft.endMinutes));

    if (editingDraft.itemId) {
      const existingItem = scheduleItems[editingDraft.itemId];
      updateItem(editingDraft.itemId, { title, startAt, dueAt, reminderAt: existingItem?.reminderAt ? startAt : existingItem?.reminderAt ?? null });
    } else if (createTodo) {
      addTodo({
        title,
        priority: editingDraft.priority || 'medium',
        startAt,
        dueAt,
        reminderAt: null,
      });
    } else {
      addEvent({
        title,
        description: '',
        startAt,
        dueAt,
      });
    }

    playInteractionSound('success');
    closeDraftEditor();
  }, [addEvent, addTodo, closeDraftEditor, createTodo, draftTitle, editingDraft, scheduleItems, updateItem, weekDateStrings]);

  const handleLaneDragStart = useCallback((event: React.DragEvent<HTMLElement>, lane: CalendarLane) => {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-calendar2-lane', JSON.stringify(lane));
    event.dataTransfer.setData('text/plain', lane.title);
  }, []);

  const handleTodoDragStart = useCallback((event: React.DragEvent<HTMLElement>, item: ScheduleItem) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-calendar2-item', item.id);
    event.dataTransfer.setData('text/plain', item.title);
    dragOffsetRef.current = 0;
  }, []);

  const handleEventDragStart = useCallback((event: React.DragEvent<HTMLDivElement>, item: WeekEvent) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-calendar2-item', item.id);
    event.dataTransfer.setData('text/plain', item.title);
    const rect = (event.currentTarget as HTMLDivElement).getBoundingClientRect();
    const offsetPx = clamp(event.clientY - rect.top, 0, rect.height);
    dragOffsetRef.current = snapMinutes((offsetPx / HOUR_HEIGHT) * 60);
  }, []);

  const handleGridDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!gridRef.current) return;
    const hasSupportedData = event.dataTransfer.types.includes('application/x-calendar2-lane') || event.dataTransfer.types.includes('application/x-calendar2-item');
    if (!hasSupportedData) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = event.dataTransfer.types.includes('application/x-calendar2-lane') ? 'copy' : 'move';
    const point = getClientSelection(event.clientX, event.clientY, gridRef.current, dayWidth, visibleDayOffset, visibleDayCount);
    const startMinutes = clamp(point.minutes - dragOffsetRef.current, START_HOUR * 60, END_HOUR * 60 - SNAP_MINUTES);
    setDraft({ dayIndex: point.dayIndex, startMinutes, endMinutes: clamp(startMinutes + 60, startMinutes + SNAP_MINUTES, END_HOUR * 60) });
  }, [dayWidth, visibleDayCount, visibleDayOffset]);

  const handleGridDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!gridRef.current) return;
    const laneRaw = event.dataTransfer.getData('application/x-calendar2-lane');
    const itemId = event.dataTransfer.getData('application/x-calendar2-item');
    if (!laneRaw && !itemId) return;
    event.preventDefault();
    const point = getClientSelection(event.clientX, event.clientY, gridRef.current, dayWidth, visibleDayOffset, visibleDayCount);
    const date = weekDateStrings[point.dayIndex];
    const startMinutes = clamp(point.minutes - dragOffsetRef.current, START_HOUR * 60, END_HOUR * 60 - SNAP_MINUTES);

    if (itemId) {
      const item = scheduleItems[itemId];
      if (!item || !hasScheduleTime(item)) return;
      const duration = Math.max(SNAP_MINUTES, Math.round((new Date(item.dueAt).getTime() - new Date(item.startAt).getTime()) / 60000));
      const endMinutes = clamp(startMinutes + duration, startMinutes + SNAP_MINUTES, END_HOUR * 60);
      const startAt = combineLocalDateTime(date, formatTimeInput(startMinutes));
      const dueAt = combineLocalDateTime(date, formatTimeInput(endMinutes));
      updateItem(itemId, { startAt, dueAt, reminderAt: item.reminderAt ? startAt : item.reminderAt });
      setDraft(null);
      dragOffsetRef.current = 0;
      playInteractionSound('save');
      return;
    }

    try {
      const lane = JSON.parse(laneRaw) as CalendarLane;
      const next = {
        dayIndex: point.dayIndex,
        startMinutes,
        endMinutes: clamp(startMinutes + 60, startMinutes + SNAP_MINUTES, END_HOUR * 60),
        title: lane.title,
        color: lane.color,
        priority: lane.id,
        type: 'todo' as const,
      };
      setDraft(next);
      setEditingDraft(next);
      setDraftTitle(lane.title);
      setCreateTodo(true);
    } catch {
      setDraft(null);
    }
  }, [dayWidth, scheduleItems, updateItem, visibleDayCount, visibleDayOffset, weekDateStrings]);

  const handleEventContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>, item: WeekEvent) => {
    event.preventDefault();
    const shouldDelete = window.confirm(`删除「${item.title}」？`);
    if (!shouldDelete) return;
    deleteItem(item.id);
    setDraft(null);
    playInteractionSound('delete');
  }, [deleteItem]);

  return (
    <div ref={pageRef} className="flex h-full min-h-0 flex-col gap-5 px-4 py-5 lg:px-8 lg:py-7">
      <PageTitle
        title="日历2"
        subtitle="周视图：拖动安排待办和事件"
        icon={<CalendarDays size={22} />}
        action={
          <button
            type="button"
            onClick={() => {
              const today = new Date();
              const todayStr = toISODateString(today);
              const dayIdx = weekDateStrings.indexOf(todayStr);
              setEditingDraft({ dayIndex: dayIdx >= 0 ? dayIdx : 0, startMinutes: 9 * 60, endMinutes: 10 * 60, type: 'todo' });
              setDraftTitle('');
              setCreateTodo(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
          >
            <Plus size={16} />
            新建
          </button>
        }
      />

      <div className="mx-auto flex w-full rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] shadow-[0_18px_42px_rgba(15,23,42,0.08)]" style={{ maxWidth: '100%' }}>
        {showDesktopPanel && (
          <aside className="w-[240px] shrink-0 border-r border-[var(--border-light)] bg-[var(--bg-base)] p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-[var(--text-primary)]">{monthTitle}</p>
              <div className="flex gap-1">
                <button type="button" onClick={() => setWeekStart((date) => addDays(date, -7))} className="grid h-7 w-7 place-items-center rounded-md hover:bg-[var(--bg-elevated)]" title="上一周"><ChevronLeft size={15} /></button>
                <button type="button" onClick={() => setWeekStart((date) => addDays(date, 7))} className="grid h-7 w-7 place-items-center rounded-md hover:bg-[var(--bg-elevated)]" title="下一周"><ChevronRight size={15} /></button>
                <button type="button" onClick={() => setMonthCollapsed((value) => !value)} className="grid h-7 w-7 place-items-center rounded-md hover:bg-[var(--bg-elevated)]" title={monthCollapsed ? '展开月历' : '折叠月历'}><ChevronDown size={15} className={`transition-transform ${monthCollapsed ? '-rotate-90' : ''}`} /></button>
              </div>
            </div>
            {!monthCollapsed && (
              <div className="mt-5 grid grid-cols-7 gap-y-1 text-center text-[11px] text-[var(--text-muted)]">
                {'一二三四五六日'.split('').map((day) => <span key={day} className="py-1">{day}</span>)}
                {monthGridDays.map((date) => {
                  const dateStr = toISODateString(date);
                  const inMonth = date.getMonth() === weekStart.getMonth();
                  const isToday = dateStr === toISODateString(new Date());
                  return (
                    <button key={dateStr} type="button" onClick={() => setWeekStart(startOfWeek(date))} className={`mx-auto grid h-7 w-7 place-items-center rounded-full text-[11px] transition-colors ${isToday ? 'bg-[color-mix(in_srgb,var(--accent)_18%,white)] font-semibold text-[var(--accent)] ring-1 ring-[color-mix(in_srgb,var(--accent)_30%,transparent)]' : inMonth ? 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]' : 'text-[var(--text-muted)] opacity-45 hover:bg-[var(--bg-elevated)]'}`} title={`切换到 ${dateStr} 所在周`}>
                      {date.getDate()}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-[var(--text-muted)]">本周待办</p>
                <span className="text-[10px] text-[var(--text-muted)]">{todoPool.length} 项</span>
              </div>
              <div className="space-y-1.5">
                {todoPool.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[var(--border-light)] px-3 py-3 text-xs text-[var(--text-muted)]">本周还没有具体事项</div>
                ) : (
                  todoPool.map((item) => (
                    <div key={item.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)]">
                      <span className="h-3.5 w-3.5 rounded-sm border-2" style={{ borderColor: PRIORITY_COLORS[item.priority], background: `${PRIORITY_COLORS[item.priority]}1f` }} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate">{item.title}</p>
                        <p className="text-[10px] text-[var(--text-muted)]">{item.startAt ? datePart(item.startAt) : '未排期'}</p>
                      </div>
                      <span draggable onDragStart={(event) => handleTodoDragStart(event, item)} className="cursor-grab rounded px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] hover:bg-[var(--bg-card)] active:cursor-grabbing" title="拖到周视图时间格进行排程">拖入</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="mt-5">
              <p className="mb-2 text-xs font-semibold text-[var(--text-muted)]">快速新建</p>
              <div className="space-y-1.5">
                {CALENDAR_LANES.map((lane) => (
                  <label key={lane.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)]">
                    <input type="checkbox" checked={visiblePriorities[lane.id]} onChange={(event) => setVisiblePriorities((current) => ({ ...current, [lane.id]: event.target.checked }))} className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent)]" />
                    <span className="h-3.5 w-3.5 rounded-sm border-2" style={{ borderColor: lane.color, background: `${lane.color}1f` }} />
                    {lane.title}
                    <span draggable onDragStart={(event) => handleLaneDragStart(event, lane)} className="ml-auto cursor-grab rounded px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] hover:bg-[var(--bg-card)] active:cursor-grabbing" title="拖到周视图时间格快速创建">拖入</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-5">
              <p className="mb-2 text-xs font-semibold text-[var(--text-muted)]">待办状态</p>
              <div className="space-y-1.5">
                {STATUS_FILTERS.map((item) => (
                  <label key={item.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)]">
                    <input type="checkbox" checked={visibleStatuses[item.id]} onChange={(event) => setVisibleStatuses((current) => ({ ...current, [item.id]: event.target.checked }))} className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent)]" />
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.color }} />
                    {item.title}
                  </label>
                ))}
              </div>
            </div>
          </aside>
        )}

        <section ref={gridFrameRef} className="min-w-0 flex-1 overflow-hidden bg-[var(--bg-card)]">
          <div className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--bg-card)]" style={{ width: gridWidth }}>
            <div className="grid" style={{ gridTemplateColumns: `${LEFT_GUTTER}px repeat(${visibleDayCount}, ${dayWidth}px)` }}>
              <div className="border-r border-[var(--border-light)] px-2 py-3 text-[11px] text-[var(--text-muted)]">
                <span>GMT+08</span>
                {visibleDayCount < 7 && (
                  <button type="button" onClick={() => setCompactDayOffset(nextCompactOffset)} className="mt-2 block rounded-md border border-[var(--border-light)] px-1.5 py-1 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]" title="切换显示前半周/后半周">
                    {compactDayLabel}
                  </button>
                )}
              </div>
              {visibleWeekDays.map((item) => {
                const dateStr = toISODateString(item.date);
                const isToday = dateStr === toISODateString(new Date());
                const dateCircleSize = Math.min(40, dayWidth * 0.38);
                return (
                  <div key={item.date.toISOString()} className="border-r border-[var(--border-light)] px-3 py-2 text-center last:border-r-0">
                    <p className="text-[11px] font-medium text-[var(--text-secondary)]">{item.label}</p>
                    <p className={`mx-auto mt-1 grid place-items-center rounded-full text-2xl font-semibold ${isToday ? 'bg-[color-mix(in_srgb,var(--accent)_15%,white)] text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`} style={{ width: dateCircleSize, height: dateCircleSize, fontSize: dateCircleSize * 0.5 }}>
                      {item.date.getDate()}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          <div
            ref={gridRef}
            className="relative select-none"
            style={{ height: (END_HOUR - START_HOUR) * HOUR_HEIGHT, width: gridWidth }}
            onPointerDown={startSelection}
            onPointerMove={moveSelection}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
              finishSelection();
            }}
            onPointerCancel={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
              setDragAnchor(null);
            }}
            onDragOver={handleGridDragOver}
            onDrop={handleGridDrop}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraft(null);
            }}
          >
            {Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, index) => START_HOUR + index).map((hour) => (
              <React.Fragment key={hour}>
                <div className="absolute left-0 w-[64px] border-r border-[var(--border-light)] pr-2 text-right text-[11px] text-[var(--text-muted)]" style={{ top: minutesToTop(hour * 60) - 8 }}>
                  {formatHourLabel(hour)}
                </div>
                <div className="absolute left-[64px] right-0 border-t border-[var(--border-light)]" style={{ top: minutesToTop(hour * 60) }} />
              </React.Fragment>
            ))}

            {Array.from({ length: END_HOUR - START_HOUR }, (_, index) => START_HOUR + index).map((hour) => (
              <div key={`half-${hour}`} className="absolute left-[64px] right-0 border-t border-dashed border-[color-mix(in_srgb,var(--border-light)_70%,transparent)]" style={{ top: minutesToTop(hour * 60 + 30) }} />
            ))}

            {Array.from({ length: visibleDayCount + 1 }, (_, index) => (
              <div key={index} className="absolute top-0 bottom-0 border-l border-[var(--border-light)]" style={{ left: LEFT_GUTTER + index * dayWidth }} />
            ))}

            {laidOutEvents.filter((event) => event.dayIndex >= visibleDayOffset && event.dayIndex < visibleDayOffset + visibleDayCount).map((event) => {
              const displayEndMinutes = resizing?.id === event.id ? resizing.newEndMinutes : event.endMinutes;
              const eventHeight = durationToHeight(event.startMinutes, displayEndMinutes) - 8;
              const isShortEvent = eventHeight <= SHORT_EVENT_HEIGHT;
              const isCompactEvent = eventHeight <= COMPACT_EVENT_HEIGHT;
              const eventLaneWidth = Math.max(28, (dayWidth - EVENT_SIDE_INSET * 2 - EVENT_OVERLAP_GAP * (event.conflictColumns - 1)) / event.conflictColumns);
              const eventLeft = LEFT_GUTTER + (event.dayIndex - visibleDayOffset) * dayWidth + EVENT_SIDE_INSET + event.conflictColumn * (eventLaneWidth + EVENT_OVERLAP_GAP);
              const showResizeHandle = eventHeight >= 24;
              return (
                <div
                  key={event.id}
                  data-calendar-event
                  data-conflict-column={event.conflictColumn}
                  data-conflict-columns={event.conflictColumns}
                  draggable
                  onDragStart={(dragEvent) => handleEventDragStart(dragEvent, event)}
                  onContextMenu={(contextEvent) => handleEventContextMenu(contextEvent, event)}
                  className="absolute z-10 cursor-grab overflow-hidden rounded-md px-2 text-white shadow-sm active:cursor-grabbing"
                  style={{
                    left: eventLeft,
                    top: minutesToTop(event.startMinutes) + 4,
                    width: eventLaneWidth,
                    height: eventHeight,
                    background: event.color,
                    paddingTop: isShortEvent ? 2 : isCompactEvent ? 4 : 6,
                    paddingBottom: isShortEvent ? 2 : 4,
                  }}
                >
                  <p className={`truncate font-semibold leading-none ${isShortEvent ? 'text-[11px]' : 'text-[10px]'}`}>{event.title}</p>
                  {!isShortEvent && (
                    <p className={`truncate font-medium opacity-95 ${isCompactEvent ? 'mt-0.5 text-[8px] leading-none' : 'mt-1 text-[9px] leading-none'}`}>
                      {formatTime(event.startMinutes)} - {formatTime(displayEndMinutes)}
                    </p>
                  )}
                  {showResizeHandle && (
                    <div
                      data-resize-handle
                      draggable={false}
                      className="absolute bottom-0 left-0 right-0 z-20 h-2 cursor-ns-resize"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                        setResizing({ id: event.id, startMinutes: event.startMinutes, dayIndex: event.dayIndex, newEndMinutes: displayEndMinutes });
                      }}
                      onPointerMove={(e) => {
                        if (e.buttons !== 1 || !gridRef.current) return;
                        const rect = gridRef.current.getBoundingClientRect();
                        const y = e.clientY - rect.top;
                        const rawMinutes = START_HOUR * 60 + (y / HOUR_HEIGHT) * 60;
                        const newEndMinutes = clamp(snapMinutes(rawMinutes), event.startMinutes + SNAP_MINUTES, END_HOUR * 60);
                        setResizing({ id: event.id, startMinutes: event.startMinutes, dayIndex: event.dayIndex, newEndMinutes });
                      }}
                      onPointerUp={() => {
                        setResizing((current) => {
                          if (!current || current.id !== event.id) return null;
                          const item = scheduleItems[event.id];
                          if (item) {
                            const date = weekDateStrings[event.dayIndex];
                            const dueAt = combineLocalDateTime(date, formatTimeInput(current.newEndMinutes));
                            updateItem(event.id, { dueAt, reminderAt: item.reminderAt ? item.startAt : item.reminderAt });
                            playInteractionSound('save');
                          }
                          return null;
                        });
                      }}
                    />
                  )}
                </div>
              );
            })}

            {draft && (
              <div className="absolute z-20 rounded-md border border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent)_28%,transparent)]" style={{ left: LEFT_GUTTER + (draft.dayIndex - visibleDayOffset) * dayWidth + 8, top: minutesToTop(draft.startMinutes) + 4, width: dayWidth - 16, height: durationToHeight(draft.startMinutes, draft.endMinutes) - 8 }}>
                <div className="px-2 py-1 text-[11px] font-semibold text-[var(--accent)]">
                  {formatTime(draft.startMinutes)} - {formatTime(draft.endMinutes)}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {editingDraft && createPortal(
        <div className="fixed inset-0 flex items-start justify-center bg-black/20 px-4 py-16 backdrop-blur-[1px]" style={{ zIndex: 2147483647 }} onMouseDown={closeDraftEditor}>
          <div className="mx-auto w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-[var(--text-primary)]">新建日程</p>
              <button type="button" onClick={closeDraftEditor} className="grid h-7 w-7 place-items-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]"><X size={15} /></button>
            </div>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {weekDays[editingDraft.dayIndex].label} {formatTime(editingDraft.startMinutes)} - {formatTime(editingDraft.endMinutes)}
            </p>
            <input
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') saveDraft();
              }}
              autoFocus
              className="mt-4 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              placeholder="日程标题"
            />
            {!editingDraft.itemId && (
              <label className="mt-3 flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <input type="checkbox" checked={createTodo} onChange={(event) => setCreateTodo(event.target.checked)} className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent)]" />
                保存为待办
              </label>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={closeDraftEditor} className="rounded-lg px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]">取消</button>
              <button type="button" onClick={saveDraft} className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]">保存</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};
