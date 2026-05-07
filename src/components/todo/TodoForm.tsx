import React, { useState, useCallback, useRef } from 'react';
import { Calendar } from 'lucide-react';
import type { Todo, TodoPriority } from '../../types';
import { PRIORITY_COLORS, PRIORITY_LABELS } from '../../types';
import { useTodoStore, usePomodoroStore } from '../../stores';
import { toISODateString } from '../../lib/date';

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
  const { addTodo, updateTodo } = useTodoStore();
  const { config } = usePomodoroStore();
  const dateInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(todo?.title || '');
  const [description, setDescription] = useState(todo?.description || '');
  const [priority, setPriority] = useState<TodoPriority>(todo?.priority || defaultPriority || 'green');
  const [dueDate, setDueDate] = useState(todo?.dueDate || defaultDate || toISODateString(new Date()));
  const [pomodoroRounds, setPomodoroRounds] = useState(todo?.pomodoroRounds || 0);
  const [customMode, setCustomMode] = useState(false);
  const [customHours, setCustomHours] = useState(() => {
    if (!todo?.pomodoroRounds) return '1.5';
    const { workDuration, shortBreakDuration, longBreakDuration, longBreakInterval } = config;
    const perRound = longBreakInterval * (workDuration + shortBreakDuration) + longBreakDuration;
    const totalMin = todo.pomodoroRounds * (workDuration + shortBreakDuration) - shortBreakDuration;
    const rounds = Math.ceil(totalMin / perRound);
    return ((rounds * perRound) / 60).toFixed(1);
  });

  const PRESET_OPTIONS = [0, 1, 2, 3];

  const handleTitleChange = useCallback((val: string) => {
    for (const [shortcut, p] of Object.entries(PRIORITY_SHORTCUTS)) {
      if (val.endsWith(shortcut)) {
        setTitle(val.slice(0, -shortcut.length));
        setPriority(p);
        return;
      }
    }
    setTitle(val);
  }, []);

  const formatDisplayDate = (iso: string): string => {
    const [y, m, d] = iso.split('-');
    return `${y}/${m}/${d}`;
  };

  const parseDisplayDate = (text: string): string | null => {
    const m = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (!m) return null;
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const day = parseInt(m[3], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  const handleDateInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    const parsed = parseDisplayDate(val);
    if (parsed) {
      setDueDate(parsed);
    }
  }, []);

  const handleDateFocus = useCallback(() => {
    if (!dueDate) {
      setDueDate(toISODateString(new Date()));
    }
    setTimeout(() => {
      const input = dateInputRef.current;
      if (input) {
        // Select day part (last 2 chars) in YYYY/MM/DD
        const len = input.value.length;
        input.setSelectionRange(len - 2, len);
      }
    }, 0);
  }, [dueDate]);

  const handleDateBlur = useCallback(() => {
    const input = dateInputRef.current;
    if (input) {
      const parsed = parseDisplayDate(input.value);
      if (parsed) {
        setDueDate(parsed);
      }
    }
  }, []);

  const handleDateKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
    }
  }, []);

  const calcTotalPomodoros = (hours: number): number => {
    const { workDuration, shortBreakDuration, longBreakDuration, longBreakInterval } = config;
    const N = longBreakInterval;
    const totalMin = hours * 60;
    if (totalMin < workDuration) return 0;
    let p = 0;
    while (true) {
      const next = p + 1;
      const time = next * (workDuration + shortBreakDuration) - shortBreakDuration + Math.floor(next / N) * longBreakDuration;
      if (time > totalMin) break;
      p = next;
    }
    return p;
  };

  const formatTimeEstimate = (hours: number): string => {
    const totalMin = hours * 60;
    if (totalMin < 60) {
      return `大约${Math.round(totalMin)}分钟`;
    }
    const h = Math.floor(totalMin / 60);
    const m = Math.round(totalMin % 60);
    if (m === 0) return `大约${h}小时`;
    return `大约${h}小时${m}分`;
  };

  const handleSelectPreset = (val: number) => {
    setCustomMode(false);
    setPomodoroRounds(val);
  };

  const handleSelectCustom = () => {
    setCustomMode(true);
    const total = calcTotalPomodoros(parseFloat(customHours) || 1.5);
    setPomodoroRounds(total);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const data = {
      title: title.trim(),
      description: description.trim(),
      priority,
      dueDate: dueDate || null,
      pomodoroRounds: customMode ? pomodoroRounds : (pomodoroRounds || 0),
    };

    if (todo) {
      updateTodo(todo.id, data);
    } else {
      addTodo(data);
    }

    onClose();
  };

  const priorities: TodoPriority[] = ['high', 'medium', 'low', 'green'];

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-[#6b7280] mb-1">
          标题 <span className="text-[#dc3545]">*</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          className="w-full px-3 py-2 border border-[#d1cdc6] rounded-lg focus:ring-2 focus:ring-[#c87d2f] focus:border-transparent outline-none transition-all bg-[#faf9f7]"
          placeholder="输入标题（/g绿色 /p粉色 /y黄色 /b蓝色）"
          autoFocus
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-[#6b7280] mb-1">描述</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full px-3 py-2 border border-[#d1cdc6] rounded-lg focus:ring-2 focus:ring-[#c87d2f] focus:border-transparent outline-none transition-all resize-none bg-[#faf9f7]"
          placeholder="添加描述（可选）"
          rows={3}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-[#6b7280] mb-2">便签颜色</label>
        <div className="flex gap-2">
          {priorities.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPriority(p)}
              className={`flex-1 py-2 px-3 rounded-lg border-2 transition-all text-sm font-medium ${
                priority === p
                  ? 'border-current shadow-sm'
                  : 'border-[#e5e2dd] hover:border-[#d1cdc6]'
              }`}
              style={{
                color: priority === p ? PRIORITY_COLORS[p] : undefined,
                backgroundColor: priority === p ? `${PRIORITY_COLORS[p]}30` : undefined,
                borderColor: priority === p ? PRIORITY_COLORS[p] : undefined,
              }}
            >
              {PRIORITY_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-[#6b7280] mb-1">截止日期</label>
        <div className="relative">
          <input
            ref={dateInputRef}
            type="text"
            value={dueDate ? formatDisplayDate(dueDate) : ''}
            onChange={handleDateInputChange}
            onFocus={handleDateFocus}
            onBlur={handleDateBlur}
            onKeyDown={handleDateKeyDown}
            className={`w-full px-3 py-2 border border-[#d1cdc6] rounded-lg focus:ring-2 focus:ring-[#c87d2f] focus:border-transparent outline-none transition-all bg-[#faf9f7] ${!dueDate ? 'text-[#b8b4ac]' : 'text-[#1a1a1a]'}`}
            placeholder="YYYY/MM/DD"
          />
          <Calendar size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#d1cdc6] pointer-events-none" />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-[#6b7280] mb-1">番茄钟计划</label>
        <div className="flex gap-2">
          {PRESET_OPTIONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => handleSelectPreset(r)}
              className={`flex-1 py-2 px-3 rounded-lg border-2 transition-all text-sm font-medium ${
                !customMode && pomodoroRounds === r
                  ? 'border-[#c87d2f] bg-[#fef7ed] text-[#c87d2f]'
                  : 'border-[#e5e2dd] text-[#9ca3af] hover:border-[#d1cdc6]'
              }`}
            >
              {r === 0 ? '无' : `${r}轮`}
            </button>
          ))}
          <button
            type="button"
            onClick={handleSelectCustom}
            className={`flex-1 py-2 px-3 rounded-lg border-2 transition-all text-sm font-medium ${
              customMode
                ? 'border-[#c87d2f] bg-[#fef7ed] text-[#c87d2f]'
                : 'border-[#e5e2dd] text-[#9ca3af] hover:border-[#d1cdc6]'
            }`}
          >
            自定义
          </button>
        </div>
        {customMode && (
          <div className="mt-2 flex items-center gap-2">
            <input
              type="text"
              inputMode="decimal"
              value={customHours}
              onChange={(e) => {
                const val = e.target.value;
                if (/^[0-9]*\.?[0-9]?$/.test(val) || val === '') {
                  setCustomHours(val);
                  const h = parseFloat(val);
                  if (h > 0) {
                    setPomodoroRounds(calcTotalPomodoros(h));
                  }
                }
              }}
              className="w-24 px-3 py-1.5 border border-[#d1cdc6] rounded-lg focus:ring-2 focus:ring-[#c87d2f] focus:border-transparent outline-none text-sm bg-[#faf9f7] text-[#1a1a1a]"
              placeholder="1.5"
            />
            <span className="text-sm text-[#6b7280]">小时</span>
            <span className="text-xs text-[#b8b4ac] ml-2">
              {formatTimeEstimate(parseFloat(customHours) || 0)} · {pomodoroRounds}个番茄
            </span>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-[#e5e2dd] mt-2">
        <button
          type="button"
          onClick={onClose}
          className="px-5 py-2.5 text-sm font-medium text-[#6b7280] bg-[#f3f2ef] rounded-xl hover:bg-[#e5e2dd] transition-colors"
        >
          取消
        </button>
        <button
          type="submit"
          className="px-5 py-2.5 text-sm font-semibold text-white bg-[#c87d2f] rounded-xl hover:bg-[#b06d20] shadow-sm transition-colors"
        >
          {todo ? '保存更改' : '创建待办'}
        </button>
      </div>
    </form>
  );
};
