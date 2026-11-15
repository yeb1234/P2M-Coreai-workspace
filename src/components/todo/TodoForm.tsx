import React, { useCallback, useRef, useState } from 'react';
import { Calendar } from 'lucide-react';
import type { ScheduleItem, TodoPriority } from '../../types';
import { PRIORITY_COLORS, PRIORITY_LABELS } from '../../types';
import { usePomodoroStore, useScheduleStore, useUIStore } from '../../stores';
import { toISODateString } from '../../lib/date';
import { playInteractionSound } from '../../lib/sounds';
import { parseTodoQuickInput } from '../../lib/todoQuickInput';
import { combineLocalDateTime, dateTimeParts, defaultDueAt, getNextWholeHour, toMinuteISOString } from '../../lib/scheduleTime';
import {
  ALLOWED_POMODORO_ROUNDS,
  getPlannedMinutesForRounds,
  inferAllowedRoundsFromDuration,
  getScheduleDurationMinutes,
} from '../../lib/pomodoroPlanning';

const PRIORITY_SHORTCUTS: Record<string, TodoPriority> = {
  '/g': 'green',
  '/p': 'high',
  '/y': 'medium',
  '/b': 'low',
};

function getReminderDefaultParts(startDate: string, startTime: string, fallbackDate?: string | null) {
  if (startDate && startTime) {
    const startAt = new Date(combineLocalDateTime(startDate, startTime));
    startAt.setMinutes(startAt.getMinutes() - 30);
    return dateTimeParts(toMinuteISOString(startAt));
  }
  return {
    date: startDate || fallbackDate || toISODateString(new Date()),
    time: '09:00',
  };
}

interface TodoFormProps {
  todo?: ScheduleItem | null;
  defaultDate?: string | null;
  defaultPriority?: TodoPriority | null;
  onClose: () => void;
}

export const TodoForm: React.FC<TodoFormProps> = ({ todo, defaultDate, defaultPriority, onClose }) => {
  const addTodo = useScheduleStore((s) => s.addTodo);
  const updateItem = useScheduleStore((s) => s.updateItem);
  const noteEnterBehavior = useUIStore((s) => s.noteEnterBehavior);
  const pomodoroConfig = usePomodoroStore((s) => s.config);
  const descriptionInputRef = useRef<HTMLTextAreaElement>(null);
  const startParts = todo?.startAt ? dateTimeParts(todo.startAt) : null;
  const dueParts = todo?.dueAt ? dateTimeParts(todo.dueAt) : null;
  const reminderParts = todo?.reminderAt ? dateTimeParts(todo.reminderAt) : null;

  const [title, setTitle] = useState(todo?.title || '');
  const [description, setDescription] = useState(todo?.description || '');
  const [priority, setPriority] = useState<TodoPriority>(todo?.priority || defaultPriority || 'green');
  const [startDate, setStartDate] = useState(startParts?.date || '');
  const [startTime, setStartTime] = useState(startParts?.time || '');
  const [dueDate, setDueDate] = useState(dueParts?.date || '');
  const [endTime, setEndTime] = useState(dueParts?.time || '');
  const [reminderEnabled, setReminderEnabled] = useState(Boolean(todo?.reminderAt));
  const [reminderDate, setReminderDate] = useState(reminderParts?.date || startDate);
  const [reminderTime, setReminderTime] = useState(reminderParts?.time || startTime);

  // 初始 pomodoroCount：优先用户设定，其次从时长反推，未排期默认 1 轮
  const initialPomodoroCount = todo?.pomodoroRounds && todo.pomodoroRounds > 0
    ? todo.pomodoroRounds
    : (startDate && startTime && dueDate && endTime
      ? inferAllowedRoundsFromDuration(
        getScheduleDurationMinutes(
          combineLocalDateTime(startDate, startTime),
          combineLocalDateTime(dueDate, endTime)
        ),
        pomodoroConfig
      )
      : pomodoroConfig.longBreakInterval);
  const [pomodoroCount, setPomodoroCount] = useState(initialPomodoroCount);

  // 当排程时间变化时，自动反推番茄钟数量
  React.useEffect(() => {
    if (!startDate || !startTime || !dueDate || !endTime) return;
    const duration = getScheduleDurationMinutes(
      combineLocalDateTime(startDate, startTime),
      combineLocalDateTime(dueDate, endTime)
    );
    if (duration <= 0) return;
    const inferred = inferAllowedRoundsFromDuration(duration, pomodoroConfig);
    setPomodoroCount(inferred);
  }, [startDate, startTime, dueDate, endTime, pomodoroConfig]);

  const priorities: TodoPriority[] = ['high', 'medium', 'low', 'green'];

  const handleTitleChange = useCallback((value: string) => {
    for (const [shortcut, nextPriority] of Object.entries(PRIORITY_SHORTCUTS)) {
      if (value.endsWith(shortcut)) {
        setTitle(value.slice(0, -shortcut.length));
        setPriority(nextPriority);
        return;
      }
    }
    setTitle(value);
  }, []);

  const handleTitleKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    descriptionInputRef.current?.focus();
  }, []);

  const handleStartTimeFocus = useCallback(() => {
    if (!startTime) {
      const defaults = getNextWholeHour();
      if (!startDate) setStartDate(defaults.date);
      setStartTime(defaults.startTime);
      if (!endTime) {
        setEndTime(defaults.endTime);
        if (!dueDate) setDueDate(defaults.endDate);
      }
    }
  }, [startTime, endTime, startDate, dueDate]);

  const handleEndTimeFocus = useCallback(() => {
    if (!endTime) {
      if (startTime && startDate) {
        const startAt = new Date(`${startDate}T${startTime}:00`);
        const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
        const { date, time } = dateTimeParts(toMinuteISOString(endAt));
        setEndTime(time);
        if (!dueDate) setDueDate(date);
      } else {
        const defaults = getNextWholeHour();
        setEndTime(defaults.endTime);
        if (!dueDate) setDueDate(defaults.endDate);
      }
    }
  }, [endTime, startTime, startDate, dueDate]);

  const handleStartDateFocus = useCallback(() => {
    if (!startDate) {
      const today = toISODateString(new Date());
      setStartDate(today);
      if (!dueDate) setDueDate(today);
    }
  }, [startDate, dueDate]);

  const handleDueDateFocus = useCallback(() => {
    if (!dueDate) {
      setDueDate(startDate || toISODateString(new Date()));
    }
  }, [dueDate, startDate]);

  const handlePomodoroCountChange = useCallback((count: number) => {
    setPomodoroCount(count);
    if (startDate && startTime) {
      const plannedMinutes = getPlannedMinutesForRounds(count, pomodoroConfig);
      const startAt = new Date(`${startDate}T${startTime}:00`);
      const endAt = new Date(startAt.getTime() + plannedMinutes * 60000);
      const { date, time } = dateTimeParts(toMinuteISOString(endAt));
      setDueDate(date);
      setEndTime(time);
    }
  }, [startDate, startTime, pomodoroConfig]);

  const handleReminderToggle = useCallback((checked: boolean) => {
    setReminderEnabled(checked);
    if (checked && !reminderEnabled && !todo?.reminderAt) {
      const defaultReminder = getReminderDefaultParts(startDate || dueDate, startTime, defaultDate);
      setReminderDate(defaultReminder.date);
      setReminderTime(defaultReminder.time);
    }
  }, [defaultDate, dueDate, reminderEnabled, startDate, startTime, todo?.reminderAt]);

  const saveTodo = useCallback(() => {
    const parsed = parseTodoQuickInput(title);
    if (!parsed.title.trim()) return;

    const normalizedStartDate = startDate || dueDate;
    const normalizedDueDate = dueDate || startDate;
    const hasAnyScheduleInput = Boolean(startDate || startTime || dueDate || endTime);
    const hasCompleteScheduleInput = Boolean(normalizedStartDate && normalizedDueDate && startTime && endTime);
    let startAt: string | null = null;
    let dueAt: string | null = null;
    if (hasAnyScheduleInput && hasCompleteScheduleInput) {
      startAt = combineLocalDateTime(normalizedStartDate, startTime);
      dueAt = combineLocalDateTime(normalizedDueDate, endTime);
      if (new Date(dueAt).getTime() <= new Date(startAt).getTime()) {
        dueAt = defaultDueAt(startAt, 60);
      }
    }

    const data = {
      title: parsed.title.trim(),
      description: description.trim(),
      priority: parsed.priority || priority,
      startAt,
      dueAt,
      reminderAt: reminderEnabled
        ? parsed.reminderAt ?? combineLocalDateTime(reminderDate || normalizedStartDate || defaultDate || toISODateString(new Date()), reminderTime || startTime || '09:00')
        : null,
      pomodoroRounds: pomodoroCount,
    };

    if (todo) {
      updateItem(todo.id, data);
      playInteractionSound('save');
    } else {
      addTodo(data);
      playInteractionSound('success');
    }
    onClose();
  }, [addTodo, defaultDate, description, dueDate, endTime, onClose, priority, reminderDate, reminderEnabled, reminderTime, startDate, startTime, title, todo, updateItem]);

  const handleDescriptionKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter') return;
    const shouldSave = noteEnterBehavior === 'enter_save' ? !event.altKey : event.altKey;
    if (!shouldSave) return;
    event.preventDefault();
    saveTodo();
  }, [noteEnterBehavior, saveTodo]);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        saveTodo();
      }}
      className="space-y-3 md:space-y-4"
    >
      <div>
        <label htmlFor="todo-form-title" className="block text-xs md:text-sm font-medium text-[var(--text-secondary)] mb-1">
          标题 <span className="text-[var(--danger)]">*</span>
        </label>
        <input
          id="todo-form-title" type="text"
          value={title}
          onChange={(event) => handleTitleChange(event.target.value)}
          onKeyDown={handleTitleKeyDown}
          className="w-full px-3 py-1.5 md:py-2 border border-[var(--border-medium)] rounded-lg focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent outline-none transition-all bg-[var(--bg-base)] text-sm text-[var(--text-primary)]"
          placeholder="输入标题，快捷：/g 绿 /p 粉 /y 黄 /b 蓝"
          autoFocus
          required
        />
      </div>

      <div>
        <label className="block text-xs md:text-sm font-medium text-[var(--text-secondary)] mb-1">描述</label>
        <textarea
          ref={descriptionInputRef}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          onKeyDown={handleDescriptionKeyDown}
          className="w-full px-3 py-1.5 md:py-2 border border-[var(--border-medium)] rounded-lg focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent outline-none transition-all resize-none bg-[var(--bg-base)] text-sm text-[var(--text-primary)]"
          placeholder={noteEnterBehavior === 'enter_save' ? '添加描述（可选）... Enter 保存，Alt+Enter 换行' : '添加描述（可选）... Enter 换行，Alt+Enter 保存'}
          rows={2}
        />
      </div>

      <div>
        <label className="block text-xs md:text-sm font-medium text-[var(--text-secondary)] mb-1.5">便签颜色</label>
        <div className="flex gap-1.5 md:gap-2">
          {priorities.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setPriority(item)}
              className={`flex-1 py-1.5 px-2 md:py-2 md:px-3 rounded-lg border-2 transition-all text-xs md:text-sm font-medium ${
                priority === item ? 'border-current shadow-sm' : 'border-[var(--border-light)] hover:border-[var(--border-medium)]'
              }`}
              style={{
                color: priority === item ? PRIORITY_COLORS[item] : undefined,
                backgroundColor: priority === item ? `${PRIORITY_COLORS[item]}30` : undefined,
                borderColor: priority === item ? PRIORITY_COLORS[item] : undefined,
              }}
            >
              {PRIORITY_LABELS[item]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs md:text-sm font-medium text-[var(--text-secondary)] mb-1">开始时间</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="date"
              value={startDate}
              onChange={(event) => {
                setStartDate(event.target.value);
                if (!dueDate) setDueDate(event.target.value);
              }}
              onFocus={handleStartDateFocus}
              className="w-full px-3 py-1.5 md:py-2 border border-[var(--border-medium)] rounded-lg focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent outline-none transition-all bg-[var(--bg-base)] text-sm text-[var(--text-primary)]"
            />
            <Calendar size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
          </div>
          <input
            type="time"
            value={startTime}
            onChange={(event) => setStartTime(event.target.value)}
            onFocus={handleStartTimeFocus}
            step="60"
            className="w-28 px-3 py-1.5 md:py-2 border border-[var(--border-medium)] rounded-lg focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent outline-none transition-all bg-[var(--bg-base)] text-sm text-[var(--text-primary)]"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs md:text-sm font-medium text-[var(--text-secondary)] mb-1">截止时间</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              onFocus={handleDueDateFocus}
              className="w-full px-3 py-1.5 md:py-2 border border-[var(--border-medium)] rounded-lg focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent outline-none transition-all bg-[var(--bg-base)] text-sm text-[var(--text-primary)]"
            />
            <Calendar size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
          </div>
          <input
            type="time"
            value={endTime}
            onChange={(event) => setEndTime(event.target.value)}
            onFocus={handleEndTimeFocus}
            step="60"
            className="w-28 px-3 py-1.5 md:py-2 border border-[var(--border-medium)] rounded-lg focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent outline-none transition-all bg-[var(--bg-base)] text-sm text-[var(--text-primary)]"
          />
        </div>
        <p className="mt-1 text-xs md:text-xs text-[var(--text-muted)]">开始和截止时间会按分钟写入数据库。</p>
      </div>

      <div>
        <label className="block text-xs md:text-sm font-medium text-[var(--text-secondary)] mb-1">
          预计番茄钟数量
        </label>
        <div className="flex items-center gap-2">
          <select
            value={pomodoroCount}
            onChange={(event) => handlePomodoroCountChange(Number(event.target.value))}
            className="flex-1 px-3 py-1.5 md:py-2 border border-[var(--border-medium)] rounded-lg focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent outline-none transition-all bg-[var(--bg-base)] text-sm text-[var(--text-primary)]"
          >
            {ALLOWED_POMODORO_ROUNDS.map((n) => (
              <option key={n} value={n}>
                {n} 个
              </option>
            ))}
          </select>
          <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">
            预计 {getPlannedMinutesForRounds(pomodoroCount, pomodoroConfig)} 分钟
          </span>
        </div>
        <p className="mt-1 text-xs md:text-xs text-[var(--text-muted)]">
          修改数量会自动调整截止时间，修改截止时间也会反推数量。
        </p>
      </div>

      <div className="rounded-lg border border-[var(--border-light)] bg-[var(--bg-elevated)] px-3 py-2.5">
        <label className="flex cursor-pointer items-center justify-between gap-3">
          <span className="text-xs md:text-sm font-medium text-[var(--text-secondary)]">是否提醒</span>
          <input
            type="checkbox"
            checked={reminderEnabled}
            onChange={(event) => handleReminderToggle(event.target.checked)}
            className="h-4 w-4 rounded border-[var(--border-medium)] text-[var(--accent)] focus:ring-[var(--accent)]"
          />
        </label>
        {reminderEnabled && (
          <div className="mt-2 flex gap-2">
            <div className="relative flex-1">
              <input
                type="date"
                value={reminderDate}
                onChange={(event) => setReminderDate(event.target.value)}
                className="w-full px-3 py-1.5 md:py-2 border border-[var(--border-medium)] rounded-lg focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent outline-none transition-all bg-[var(--bg-base)] text-sm text-[var(--text-primary)]"
              />
              <Calendar size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
            </div>
            <input
              type="time"
              value={reminderTime}
              onChange={(event) => setReminderTime(event.target.value)}
              step="60"
              className="w-28 px-3 py-1.5 md:py-2 border border-[var(--border-medium)] rounded-lg focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent outline-none transition-all bg-[var(--bg-base)] text-sm text-[var(--text-primary)]"
            />
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border-light)] mt-1">
        <button type="button" onClick={onClose} className="px-4 py-2 text-xs md:text-sm font-medium text-[var(--text-secondary)] bg-[var(--bg-secondary)] rounded-lg hover:bg-[var(--bg-elevated)] transition-colors">
          取消
        </button>
        <button type="submit" className="px-4 py-2 text-xs md:text-sm font-semibold text-white bg-[var(--accent)] rounded-lg hover:bg-[var(--accent-hover)] shadow-sm transition-colors">
          {todo ? '保存' : '创建'}
        </button>
      </div>
    </form>
  );
};
