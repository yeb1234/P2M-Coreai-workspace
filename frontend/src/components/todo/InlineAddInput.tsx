import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useScheduleStore } from '../../stores';
import { parseTodoQuickInput } from '../../lib/todoQuickInput';

export const InlineAddInput: React.FC = () => {
  const addTodo = useScheduleStore((s) => s.addTodo);
  const [active, setActive] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (active && inputRef.current) {
      inputRef.current.focus();
    }
  }, [active]);

  const handleSubmit = useCallback(() => {
    const parsed = parseTodoQuickInput(value);
    if (parsed.title) {
      addTodo({
        title: parsed.title,
        description: '',
        priority: parsed.priority || 'green',
        startAt: null,
        dueAt: null,
        reminderAt: null,
        pomodoroRounds: parsed.pomodoroRounds ?? 1,
      });
    }
    setValue('');
    setActive(false);
  }, [value, addTodo]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      setValue('');
      setActive(false);
    }
  }, [handleSubmit]);

  if (!active) {
    return (
      <button
        onClick={() => setActive(true)}
        className="w-full flex items-center gap-3 px-3 py-3 text-sm text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-bg)] rounded-lg transition-all group"
      >
        <div className="w-4 flex-shrink-0" />
        <div className="w-5 h-5 border-2 border-dashed border-[var(--border-medium)] rounded-full flex items-center justify-center group-hover:border-[var(--accent)] transition-colors flex-shrink-0">
          <Plus size={12} />
        </div>
        <span className="flex-1 text-left">新提醒事项</span>
        <div className="w-[76px] flex-shrink-0" />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3 px-3 py-3 rounded-lg border border-[var(--accent)] bg-[var(--bg-elevated)] shadow-sm">
      <div className="w-4 flex-shrink-0" />
      <div className="w-5 h-5 border-2 border-[var(--accent)] rounded-full flex items-center justify-center flex-shrink-0">
        <div className="w-2 h-2 bg-[var(--accent)] rounded-full" />
      </div>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleSubmit}
        onKeyDown={handleKeyDown}
        className="flex-1 text-sm text-[var(--text-primary)] bg-transparent outline-none placeholder:text-[var(--text-muted)]"
        placeholder="输入待办... 例：洗澡 /t1 /g"
      />
      <div className="w-[76px] flex-shrink-0" />
    </div>
  );
};
