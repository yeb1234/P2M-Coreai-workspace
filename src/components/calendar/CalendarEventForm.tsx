import React, { useState } from 'react';
import { useCalendarStore, useTodoStore } from '../../stores';
import { playInteractionSound } from '../../lib/sounds';

interface CalendarEventFormProps {
  date: string;
  onClose: () => void;
}

export const CalendarEventForm: React.FC<CalendarEventFormProps> = ({ date, onClose }) => {
  const { addEvent } = useCalendarStore();
  const { addTodo } = useTodoStore();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [createTodo, setCreateTodo] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const eventId = addEvent({
      title: title.trim(),
      date,
      startTime: startTime || undefined,
      endTime: endTime || undefined,
      type: 'event',
      color: '#8b5cf6',
      todoId: null,
      pomodoroSessionId: null,
      description: description.trim() || undefined,
    });

    if (createTodo) {
      addTodo({
        title: title.trim(),
        description: description.trim(),
        dueDate: date,
        calendarEventId: eventId,
      });
    }

    playInteractionSound('success');
    onClose();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-[#6b7280] mb-1">
          标题 <span className="text-[#dc3545]">*</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full px-3 py-2 border border-[#d1cdc6] rounded-lg focus:ring-2 focus:ring-[#c87d2f] focus:border-transparent outline-none transition-all bg-[#fef7ed]"
          placeholder="事件标题"
          autoFocus
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-[#6b7280] mb-1">描述</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full px-3 py-2 border border-[#d1cdc6] rounded-lg focus:ring-2 focus:ring-[#c87d2f] focus:border-transparent outline-none transition-all resize-none bg-[#fef7ed]"
          placeholder="事件描述（可选）"
          rows={2}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-[#6b7280] mb-1">开始时间</label>
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="w-full px-3 py-2 border border-[#d1cdc6] rounded-lg focus:ring-2 focus:ring-[#c87d2f] focus:border-transparent outline-none transition-all bg-[#fef7ed]"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[#6b7280] mb-1">结束时间</label>
          <input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="w-full px-3 py-2 border border-[#d1cdc6] rounded-lg focus:ring-2 focus:ring-[#c87d2f] focus:border-transparent outline-none transition-all bg-[#fef7ed]"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="createTodo"
          checked={createTodo}
          onChange={(e) => setCreateTodo(e.target.checked)}
          className="w-4 h-4 text-[#c87d2f] rounded focus:ring-[#c87d2f]"
        />
        <label htmlFor="createTodo" className="text-sm text-[#6b7280]">
          同时创建待办事项
        </label>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-sm font-medium text-[#6b7280] bg-[#f3f2ef] rounded-lg hover:bg-[#e5e2dd] transition-colors"
        >
          取消
        </button>
        <button
          type="submit"
          className="px-4 py-2 text-sm font-medium text-white bg-[#c87d2f] rounded-lg hover:bg-[#b06d20] transition-colors"
        >
          创建事件
        </button>
      </div>
    </form>
  );
};
