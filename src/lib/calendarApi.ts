import { authFetch } from './authApi';
import type { CalendarEvent } from '../types';

interface ApiCalendarEvent {
  id: string;
  title: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  type: string;
  color: string;
  todo_id: string | null;
  pomodoro_session_id: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

function fromApi(item: ApiCalendarEvent): CalendarEvent {
  return {
    id: item.id,
    title: item.title,
    date: item.date,
    startTime: item.start_time ?? undefined,
    endTime: item.end_time ?? undefined,
    type: item.type as CalendarEvent['type'],
    color: item.color,
    todoId: item.todo_id,
    pomodoroSessionId: item.pomodoro_session_id,
    description: item.description ?? undefined,
    createdAt: item.created_at,
  };
}

function toApi(data: Omit<CalendarEvent, 'id' | 'createdAt'> & { id?: string }) {
  return {
    id: data.id,
    title: data.title,
    date: data.date,
    start_time: data.startTime ?? null,
    end_time: data.endTime ?? null,
    type: data.type,
    color: data.color,
    todo_id: data.todoId,
    pomodoro_session_id: data.pomodoroSessionId,
    description: data.description ?? null,
  };
}

export async function fetchCalendarEvents(start?: string, end?: string): Promise<CalendarEvent[]> {
  const params = new URLSearchParams();
  if (start) params.set('start', start);
  if (end) params.set('end', end);
  const query = params.toString();
  const res = await authFetch(`/api/calendar-events${query ? `?${query}` : ''}`);
  if (!res.ok) throw new Error('failed to fetch calendar events');
  const data = await res.json() as { items: ApiCalendarEvent[] };
  return data.items.map(fromApi);
}

export async function createCalendarEvent(
  data: Omit<CalendarEvent, 'id' | 'createdAt'> & { id?: string }
): Promise<CalendarEvent> {
  const res = await authFetch('/api/calendar-events', {
    method: 'POST',
    body: JSON.stringify(toApi(data)),
  });
  if (!res.ok) throw new Error('failed to create calendar event');
  return fromApi(await res.json() as ApiCalendarEvent);
}
