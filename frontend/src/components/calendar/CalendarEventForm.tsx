import React, { useState } from 'react';
import { useScheduleStore } from '../../stores';
import { playInteractionSound } from '../../lib/sounds';
import { combineLocalDateTime, defaultDueAt } from '../../lib/scheduleTime';

interface CalendarEventFormProps {
  date: string;
  onClose: () => void;
}

export const CalendarEventForm: React.FC<CalendarEventFormProps> = ({ date, onClose }) => {
  const addEvent = useScheduleStore((s) => s.addEvent);
  const addTodo = useScheduleStore((s) => s.addTodo);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  // 默认勾上，和周历保持一致。
  // 原来这里是 false 而周历是 true —— 用户在日历里新建了东西、
  // 以为会进待办页，结果「有时行有时不行」，其实取决于在哪个页面建的。
  const [createTodo, setCreateTodo] = useState(true);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    const startAt = combineLocalDateTime(date, startTime || '09:00');
    let dueAt = combineLocalDateTime(date, endTime || startTime || '10:00');
    if (new Date(dueAt).getTime() <= new Date(startAt).getTime()) {
      dueAt = defaultDueAt(startAt, 60);
    }

    if (createTodo) {
      addTodo({
        title: title.trim(),
        description: description.trim(),
        priority: 'medium',
        startAt,
        dueAt,
        reminderAt: null,
      });
    } else {
      addEvent({
        title: title.trim(),
        description: description.trim(),
        startAt,
        dueAt,
      });
    }

    playInteractionSound('success');
    onClose();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="event-form-title" className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
          标题 <span className="text-[var(--danger)]">*</span>
        </label>
        <input
          id="event-form-title" type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="w-full px-3 py-2 border border-[var(--border-medium)] rounded-lg focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent outline-none transition-all bg-[var(--bg-accent)]"
          placeholder="事件标题"
          autoFocus
          required
        />
      </div>

      <div>
        <label htmlFor="f-3bdd08" className="block text-sm font-medium text-[var(--text-secondary)] mb-1">描述</label>
        <textarea id="f-3bdd08"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className="w-full px-3 py-2 border border-[var(--border-medium)] rounded-lg focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent outline-none transition-all resize-none bg-[var(--bg-accent)]"
          placeholder="事件描述（可选）"
          rows={2}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="event-form-start" className="block text-sm font-medium text-[var(--text-secondary)] mb-1">开始时间</label>
          <input id="event-form-start" type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} step="60" className="w-full px-3 py-2 border border-[var(--border-medium)] rounded-lg focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent outline-none transition-all bg-[var(--bg-accent)]" />
        </div>
        <div>
          <label htmlFor="event-form-due" className="block text-sm font-medium text-[var(--text-secondary)] mb-1">截止时间</label>
          <input id="event-form-due" type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} step="60" className="w-full px-3 py-2 border border-[var(--border-medium)] rounded-lg focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent outline-none transition-all bg-[var(--bg-accent)]" />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="createTodo"
          checked={createTodo}
          onChange={(event) => setCreateTodo(event.target.checked)}
          className="w-4 h-4 text-[var(--accent)] rounded focus:ring-[var(--accent)]"
        />
        <label htmlFor="createTodo" className="text-sm text-[var(--text-secondary)]">
          保存为待办事项
        </label>
        <span className="text-[11px] text-[var(--text-muted)]">
          {createTodo ? '会出现在待办事项' : '只是日程，不进待办'}
        </span>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] bg-[var(--bg-base)] rounded-lg hover:bg-[var(--border-light)] transition-colors">
          取消
        </button>
        <button type="submit" className="px-4 py-2 text-sm font-medium text-white bg-[var(--accent)] rounded-lg hover:bg-[var(--accent-hover)] transition-colors">
          创建
        </button>
      </div>
    </form>
  );
};
