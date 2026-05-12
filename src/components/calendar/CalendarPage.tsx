import React, { useMemo, useState } from 'react';
import { Plus, CalendarDays, Trash2 } from 'lucide-react';
import { CalendarToolbar } from './CalendarToolbar';
import { CalendarGrid } from './CalendarGrid';
import { CalendarEventForm } from './CalendarEventForm';
import { Modal, PageTitle } from '../shared';
import { TodoForm } from '../todo/TodoForm';
import { useCalendarStore, useScheduleStore } from '../../stores';
import { toISODateString } from '../../lib/date';
import type { ISODateString } from '../../types';
import { getScheduleItemsForDate } from './calendarDerivedData';
import { dateTimeParts, hasScheduleTime } from '../../lib/scheduleTime';
import { playInteractionSound } from '../../lib/sounds';

export const CalendarPage: React.FC = () => {
  const selectedDate = useCalendarStore((s) => s.selectedDate);
  const [showEventForm, setShowEventForm] = useState(false);
  const [todoPlanDate, setTodoPlanDate] = useState<ISODateString | null>(null);

  return (
    <div className="w-full pt-2">
      <PageTitle
        title="日历"
        subtitle="点击日期查看事件"
        icon={<CalendarDays size={22} />}
        action={
          <button onClick={() => setShowEventForm(true)} className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-[#c87d2f] rounded-lg hover:bg-[#b06d20] transition-colors">
            <Plus size={16} />
            新建事件
          </button>
        }
      />

      <div className="calendar-paper rounded-xl border border-[#e5e2dd] p-4 mx-auto shadow-sm">
        <CalendarToolbar />
        <div className="mt-4">
          <CalendarGrid onDayDoubleClick={(date) => setTodoPlanDate(date)} />
        </div>
      </div>

      {selectedDate && <SelectedDateEvents />}

      <Modal isOpen={showEventForm} onClose={() => setShowEventForm(false)} title="新建事件">
        <CalendarEventForm date={selectedDate || toISODateString(new Date())} onClose={() => setShowEventForm(false)} />
      </Modal>

      <Modal isOpen={Boolean(todoPlanDate)} onClose={() => setTodoPlanDate(null)} title={todoPlanDate ? `${todoPlanDate} 的待办计划` : '新建待办'}>
        <TodoForm defaultDate={todoPlanDate} defaultPriority="medium" onClose={() => setTodoPlanDate(null)} />
      </Modal>
    </div>
  );
};

const SelectedDateEvents: React.FC = () => {
  const selectedDate = useCalendarStore((s) => s.selectedDate);
  const items = useScheduleStore((s) => s.items);
  const deleteItem = useScheduleStore((s) => s.deleteItem);
  const dayItems = useMemo(
    () => selectedDate ? getScheduleItemsForDate(items, selectedDate) : [],
    [items, selectedDate],
  );
  const events = dayItems.filter((item) => item.type === 'event');
  const pendingTodos = dayItems.filter((item) => item.type === 'todo' && item.status !== 'completed');
  const completedTodos = dayItems.filter((item) => item.type === 'todo' && item.status === 'completed');

  if (!selectedDate || dayItems.length === 0) return null;

  const handleDelete = (id: string) => {
    deleteItem(id);
    playInteractionSound('delete');
  };

  return (
    <div className="mt-4 bg-[#fef7ed] rounded-xl border border-[#e5e2dd] p-4">
      <h3 className="font-medium text-[#1a1a1a] mb-3">
        {new Date(selectedDate).toLocaleDateString('zh-CN', {
          month: 'long',
          day: 'numeric',
          weekday: 'long',
        })}
      </h3>

      {events.length > 0 && (
        <div className="space-y-2">
          {events.map((event) => {
            if (!hasScheduleTime(event)) return null;
            const start = dateTimeParts(event.startAt);
            const due = dateTimeParts(event.dueAt);
            return (
              <div key={event.id} className="flex items-center gap-3 p-2 rounded-lg" style={{ backgroundColor: '#8b5cf610' }}>
                <div className="w-2 h-2 rounded-full bg-[#8b5cf6]" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-[#1a1a1a]">{event.title}</p>
                  <p className="text-xs text-[#6b7280]">{start.time} - {due.time}</p>
                </div>
                <button type="button" onClick={() => handleDelete(event.id)} className="p-1.5 text-[#9ca3af] transition-colors hover:text-[#dc3545]" title="删除">
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {pendingTodos.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium text-[#c87d2f]">待办</p>
          <div className="space-y-2">
            {pendingTodos.map((todo) => (
              <div key={todo.id} className="flex items-center gap-3 rounded-lg border border-[#e5e2dd] bg-white px-3 py-2">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: todo.priority === 'high' ? '#e8a0a0' : todo.priority === 'medium' ? '#e8d4a0' : todo.priority === 'low' ? '#a0c4e8' : '#a0d4a0' }} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[#1a1a1a]">{todo.title}</p>
                  {todo.pomodoroRounds > 0 && <p className="text-[10px] text-[#9ca3af]">{todo.pomodoroRounds} 个番茄</p>}
                </div>
                <button type="button" onClick={() => handleDelete(todo.id)} className="p-1.5 text-[#9ca3af] transition-colors hover:text-[#dc3545]" title="移入垃圾箱">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {completedTodos.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium text-[#16a34a]">已完成</p>
          <div className="space-y-2">
            {completedTodos.map((todo) => (
              <div key={todo.id} className="flex items-center gap-3 rounded-lg border border-[#e5e2dd] bg-white px-3 py-2">
                <div className="w-2 h-2 rounded-full shrink-0 bg-[#16a34a]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-[#9ca3af] line-through">{todo.title}</p>
                </div>
                <button type="button" onClick={() => handleDelete(todo.id)} className="p-1.5 text-[#9ca3af] transition-colors hover:text-[#dc3545]" title="移入垃圾箱">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
