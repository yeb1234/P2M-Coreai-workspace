import React, { useState } from 'react';
import { Plus, CalendarDays } from 'lucide-react';
import { CalendarToolbar } from './CalendarToolbar';
import { CalendarGrid } from './CalendarGrid';
import { CalendarEventForm } from './CalendarEventForm';
import { Modal, PageTitle } from '../shared';
import { useCalendarStore, useTodoStore, useUIStore } from '../../stores';
import { toISODateString } from '../../lib/date';
import type { ISODateString } from '../../types';

export const CalendarPage: React.FC = () => {
  const { selectedDate } = useCalendarStore();
  const { setPendingTodoDate, setPendingTodoPriority } = useTodoStore();
  const { setActiveView } = useUIStore();
  const [showEventForm, setShowEventForm] = useState(false);

  const handleDayDoubleClick = (date: ISODateString) => {
    setPendingTodoDate(date);
    setPendingTodoPriority('medium');
    setActiveView('todo');
  };

  const handleAddEvent = () => {
    setShowEventForm(true);
  };

  return (
    <div className="w-full pt-2">
      <PageTitle
        title="日历"
        subtitle="点击日期查看事件"
        icon={<CalendarDays size={22} />}
        action={
          <button
            onClick={handleAddEvent}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-[#c87d2f] rounded-lg hover:bg-[#b06d20] transition-colors"
          >
            <Plus size={16} />
            新建事件
          </button>
        }
      />

      <div className="calendar-paper rounded-xl border border-[#e5e2dd] p-4 mx-auto shadow-sm">
        <CalendarToolbar />
        <div className="mt-4">
          <CalendarGrid onDayDoubleClick={handleDayDoubleClick} />
        </div>
      </div>

      {selectedDate && (
        <SelectedDateEvents />
      )}

      <Modal
        isOpen={showEventForm}
        onClose={() => setShowEventForm(false)}
        title="新建事件"
      >
        <CalendarEventForm
          date={selectedDate || toISODateString(new Date())}
          onClose={() => setShowEventForm(false)}
        />
      </Modal>
    </div>
  );
};

const SelectedDateEvents: React.FC = () => {
  const { selectedDate, getEventsForDate } = useCalendarStore();
  const events = selectedDate ? getEventsForDate(selectedDate) : [];

  if (!selectedDate || events.length === 0) return null;

  return (
    <div className="mt-4 bg-[#fef7ed] rounded-xl border border-[#e5e2dd] p-4">
      <h3 className="font-medium text-[#1a1a1a] mb-3">
        {new Date(selectedDate).toLocaleDateString('zh-CN', {
          month: 'long',
          day: 'numeric',
          weekday: 'long',
        })}
      </h3>
      <div className="space-y-2">
        {events.map((event) => (
          <div
            key={event.id}
            className="flex items-center gap-3 p-2 rounded-lg"
            style={{ backgroundColor: `${event.color}10` }}
          >
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: event.color }}
            />
            <div className="flex-1">
              <p className="text-sm font-medium text-[#1a1a1a]">{event.title}</p>
              {event.startTime && (
                <p className="text-xs text-[#6b7280]">
                  {event.startTime}{event.endTime ? ` - ${event.endTime}` : ''}
                </p>
              )}
            </div>
            <span className="text-xs text-[#9ca3af] capitalize">
              {event.type === 'todo' ? '待办' : event.type === 'pomodoro' ? '专注' : '事件'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
