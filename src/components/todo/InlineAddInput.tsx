import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useTodoStore } from '../../stores';
import type { TodoPriority } from '../../types';

const PRIORITY_SHORTCUTS: Record<string, TodoPriority> = {
  '/g': 'green',
  '/p': 'high',
  '/y': 'medium',
  '/b': 'low',
};

export const InlineAddInput: React.FC = () => {
  const addTodo = useTodoStore((s) => s.addTodo);
  const [active, setActive] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (active && inputRef.current) {
      inputRef.current.focus();
    }
  }, [active]);

  const handleSubmit = useCallback(() => {
    let title = value.trim();
    let priority: TodoPriority = 'green';
    for (const [shortcut, p] of Object.entries(PRIORITY_SHORTCUTS)) {
      if (title.endsWith(shortcut)) {
        title = title.slice(0, -shortcut.length).trim();
        priority = p;
        break;
      }
    }
    if (title) {
      addTodo({ title, description: '', priority, dueDate: null });
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
        className="w-full flex items-center gap-3 px-3 py-3 text-sm text-[#b8b4ac] hover:text-[#c87d2f] hover:bg-[#fef7ed] rounded-lg transition-all group"
      >
        <div className="w-4 flex-shrink-0" />
        <div className="w-5 h-5 border-2 border-dashed border-[#d1cdc6] rounded-full flex items-center justify-center group-hover:border-[#c87d2f] transition-colors flex-shrink-0">
          <Plus size={12} />
        </div>
        <span className="flex-1 text-left">新提醒事项</span>
        <div className="w-[76px] flex-shrink-0" />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3 px-3 py-3 rounded-lg border border-[#c87d2f] bg-[#faf9f7] shadow-sm">
      <div className="w-4 flex-shrink-0" />
      <div className="w-5 h-5 border-2 border-[#c87d2f] rounded-full flex items-center justify-center flex-shrink-0">
        <div className="w-2 h-2 bg-[#c87d2f] rounded-full" />
      </div>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleSubmit}
        onKeyDown={handleKeyDown}
        className="flex-1 text-sm text-[#1a1a1a] bg-transparent outline-none placeholder:text-[#d1cdc6]"
        placeholder="输入待办...（/g绿色 /p粉色）"
      />
      <div className="w-[76px] flex-shrink-0" />
    </div>
  );
};
