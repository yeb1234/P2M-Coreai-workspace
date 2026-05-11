import React, { useCallback, useMemo, useRef, useState } from 'react';
import { AlarmClock, Calendar } from 'lucide-react';
import type { Todo, TodoPriority } from '../../types';
import { PRIORITY_COLORS, PRIORITY_LABELS } from '../../types';
import { usePomodoroStore, useTodoStore } from '../../stores';
import { toISODateString } from '../../lib/date';
import { playInteractionSound } from '../../lib/sounds';

const PRIORITY_SHORTCUTS: Record<string, TodoPriority> = {
  '/g': 'green',
  '/p': 'high',
  '/y': 'medium',
  '/b': 'low',
};

interface TodoFormProps {
  todo?: Todo | null;
  defaultDate?: string | null;
  defaultPriority?: TodoPriority | null;
  onClose: () => void;
}

export const TodoForm: React.FC<TodoFormProps> = ({ todo, defaultDate, defaultPriority, onClose }) => {
  const addTodo = useTodoStore((s) => s.addTodo);
  const updateTodo = useTodoStore((s) => s.updateTodo);
  const config = usePomodoroStore((s) => s.config);
  const dateInputRef = useRef<HTMLInputElement>(null);

  const pomodorosPerPlanRound = Math.max(1, config.longBreakInterval || 4);
  const getPresetPomodoros = useCallback(
    (rounds: number) => (rounds <= 0 ? 0 : rounds * pomodorosPerPlanRound),
    [pomodorosPerPlanRound]
  );

  const [title, setTitle] = useState(todo?.title || '');
  const [description, setDescription] = useState(todo?.description || '');
  const [priority, setPriority] = useState<TodoPriority>(todo?.priority || defaultPriority || 'green');
  const [dueDate, setDueDate] = useState(todo?.dueDate || defaultDate || toISODateString(new Date()));
  const [reminderAt, setReminderAt] = useState(() => todo?.reminderAt ? todo.reminderAt.slice(0, 16) : '');
  const [pomodoroRounds, setPomodoroRounds] = useState(todo?.pomodoroRounds || 0);
  const [customMode, setCustomMode] = useState(() => {
    if (!todo?.pomodoroRounds) return false;
    return todo.pomodoroRounds % pomodorosPerPlanRound !== 0;
  });
  const [customHours, setCustomHours] = useState(() => {
    if (!todo?.pomodoroRounds) return '1.0';
    return ((todo.pomodoroRounds * config.workDuration) / 60).toFixed(1);
  });

  const presetOptions = useMemo(() => [0, 1, 2, 3], []);
  const priorities: TodoPriority[] = ['high', 'medium', 'low', 'green'];

  const calcTotalPomodoros = useCallback((hours: number): number => {
    const totalMin = hours * 60;
    if (totalMin <= 0) return 0;
    return Math.max(1, Math.floor(totalMin / config.workDuration));
  }, [config.workDuration]);

  const formatTimeEstimate = useCallback((hours: number): string => {
    const totalMin = hours * 60;
    if (totalMin <= 0) return '约 0 分钟';
    if (totalMin < 60) return `约 ${Math.round(totalMin)} 分钟`;
    const h = Math.floor(totalMin / 60);
    const m = Math.round(totalMin % 60);
    return m === 0 ? `约 ${h} 小时` : `约 ${h} 小时 ${m} 分钟`;
  }, []);

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

  const formatDisplayDate = (iso: string): string => {
    const [y, m, d] = iso.split('-');
    return `${y}/${m}/${d}`;
  };

  const parseDisplayDate = (text: string): string | null => {
    const match = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (!match) return null;
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);
    if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  const handleDateInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = parseDisplayDate(event.target.value);
    if (parsed) setDueDate(parsed);
  }, []);

  const handleDateFocus = useCallback(() => {
    if (!dueDate) setDueDate(toISODateString(new Date()));
    setTimeout(() => {
      const input = dateInputRef.current;
      if (!input) return;
      const len = input.value.length;
      input.setSelectionRange(Math.max(0, len - 2), len);
    }, 0);
  }, [dueDate]);

  const handleDateBlur = useCallback(() => {
    const input = dateInputRef.current;
    if (!input) return;
    const parsed = parseDisplayDate(input.value);
    if (parsed) setDueDate(parsed);
  }, []);

  const handleDateKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    }
  }, []);

  const handleSelectPreset = useCallback((rounds: number) => {
    setCustomMode(false);
    setPomodoroRounds(getPresetPomodoros(rounds));
  }, [getPresetPomodoros]);

  const handleSelectCustom = useCallback(() => {
    setCustomMode(true);
    setPomodoroRounds(calcTotalPomodoros(parseFloat(customHours) || 1));
  }, [calcTotalPomodoros, customHours]);

  const handleCustomHoursChange = useCallback((value: string) => {
    if (!/^[0-9]*\.?[0-9]*$/.test(value)) return;
    setCustomHours(value);
    const hours = parseFloat(value);
    if (Number.isFinite(hours)) setPomodoroRounds(calcTotalPomodoros(hours));
  }, [calcTotalPomodoros]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;

    const data = {
      title: title.trim(),
      description: description.trim(),
      priority,
      dueDate: dueDate || null,
      reminderAt: reminderAt ? new Date(reminderAt).toISOString() : null,
      pomodoroRounds,
    };

    if (todo) {
      updateTodo(todo.id, data);
      playInteractionSound('save');
    } else {
      addTodo(data);
      playInteractionSound('success');
    }
    onClose();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 md:space-y-4">
      <div>
        <label className="block text-xs md:text-sm font-medium text-[#6b7280] mb-1">
          标题 <span className="text-[#dc3545]">*</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={(event) => handleTitleChange(event.target.value)}
          className="w-full px-3 py-1.5 md:py-2 border border-[#d1cdc6] rounded-lg focus:ring-2 focus:ring-[#c87d2f] focus:border-transparent outline-none transition-all bg-[#faf9f7] text-sm"
          placeholder="输入标题，快捷：/g 绿 /p 粉 /y 黄 /b 蓝"
          autoFocus
          required
        />
      </div>

      <div>
        <label className="block text-xs md:text-sm font-medium text-[#6b7280] mb-1">描述</label>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className="w-full px-3 py-1.5 md:py-2 border border-[#d1cdc6] rounded-lg focus:ring-2 focus:ring-[#c87d2f] focus:border-transparent outline-none transition-all resize-none bg-[#faf9f7] text-sm"
          placeholder="添加描述（可选）"
          rows={2}
        />
      </div>

      <div>
        <label className="block text-xs md:text-sm font-medium text-[#6b7280] mb-1.5">便签颜色</label>
        <div className="flex gap-1.5 md:gap-2">
          {priorities.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setPriority(item)}
              className={`flex-1 py-1.5 px-2 md:py-2 md:px-3 rounded-lg border-2 transition-all text-xs md:text-sm font-medium ${
                priority === item ? 'border-current shadow-sm' : 'border-[#e5e2dd] hover:border-[#d1cdc6]'
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
        <label className="block text-xs md:text-sm font-medium text-[#6b7280] mb-1">截止日期</label>
        <div className="relative">
          <input
            ref={dateInputRef}
            type="text"
            value={dueDate ? formatDisplayDate(dueDate) : ''}
            onChange={handleDateInputChange}
            onFocus={handleDateFocus}
            onBlur={handleDateBlur}
            onKeyDown={handleDateKeyDown}
            className={`w-full px-3 py-1.5 md:py-2 border border-[#d1cdc6] rounded-lg focus:ring-2 focus:ring-[#c87d2f] focus:border-transparent outline-none transition-all bg-[#faf9f7] text-sm ${!dueDate ? 'text-[#b8b4ac]' : 'text-[#1a1a1a]'}`}
            placeholder="YYYY/MM/DD"
          />
          <Calendar size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#d1cdc6] pointer-events-none" />
        </div>
      </div>

      <div>
        <label className="block text-xs md:text-sm font-medium text-[#6b7280] mb-1">提醒时间</label>
        <div className="relative">
          <input
            type="datetime-local"
            value={reminderAt}
            onChange={(event) => setReminderAt(event.target.value)}
            className="w-full px-3 py-1.5 md:py-2 border border-[#d1cdc6] rounded-lg focus:ring-2 focus:ring-[#c87d2f] focus:border-transparent outline-none transition-all bg-[#faf9f7] text-sm text-[#1a1a1a]"
          />
          <AlarmClock size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#d1cdc6] pointer-events-none" />
        </div>
      </div>

      <div>
        <label className="block text-xs md:text-sm font-medium text-[#6b7280] mb-1">番茄钟计划</label>
        <p className="mb-1.5 text-[10px] md:text-xs text-[#9ca3af]">
          1 轮 = {pomodorosPerPlanRound} 个番茄
        </p>
        <div className="flex gap-1.5 md:gap-2">
          {presetOptions.map((rounds) => {
            const planned = getPresetPomodoros(rounds);
            return (
              <button
                key={rounds}
                type="button"
                onClick={() => handleSelectPreset(rounds)}
                className={`flex-1 py-1.5 px-2 md:py-2 md:px-3 rounded-lg border-2 transition-all text-xs md:text-sm font-medium ${
                  !customMode && pomodoroRounds === planned
                    ? 'border-[#c87d2f] bg-[#fef7ed] text-[#c87d2f]'
                    : 'border-[#e5e2dd] text-[#9ca3af] hover:border-[#d1cdc6]'
                }`}
              >
                {rounds === 0 ? '无' : `${rounds}`}
                {rounds > 0 && <span className="block text-[8px] md:text-[10px] font-normal opacity-70">{planned}个</span>}
              </button>
            );
          })}
          <button
            type="button"
            onClick={handleSelectCustom}
            className={`flex-1 py-1.5 px-2 md:py-2 md:px-3 rounded-lg border-2 transition-all text-xs md:text-sm font-medium ${
              customMode
                ? 'border-[#c87d2f] bg-[#fef7ed] text-[#c87d2f]'
                : 'border-[#e5e2dd] text-[#9ca3af] hover:border-[#d1cdc6]'
            }`}
          >
            自定义
          </button>
        </div>
        {customMode && (
          <div className="mt-1.5 flex items-center gap-2">
            <input
              type="text"
              inputMode="decimal"
              value={customHours}
              onChange={(event) => handleCustomHoursChange(event.target.value)}
              className="w-20 px-2 py-1 border border-[#d1cdc6] rounded-lg focus:ring-2 focus:ring-[#c87d2f] focus:border-transparent outline-none text-xs bg-[#faf9f7] text-[#1a1a1a]"
              placeholder="1.0"
            />
            <span className="text-xs text-[#6b7280]">小时</span>
            <span className="text-[10px] text-[#b8b4ac]">
              {formatTimeEstimate(parseFloat(customHours) || 0)} · {pomodoroRounds}个
            </span>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-3 border-t border-[#e5e2dd] mt-1">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-xs md:text-sm font-medium text-[#6b7280] bg-[#f3f2ef] rounded-lg hover:bg-[#e5e2dd] transition-colors"
        >
          取消
        </button>
        <button
          type="submit"
          className="px-4 py-2 text-xs md:text-sm font-semibold text-white bg-[#c87d2f] rounded-lg hover:bg-[#b06d20] shadow-sm transition-colors"
        >
          {todo ? '保存' : '创建'}
        </button>
      </div>
    </form>
  );
};
