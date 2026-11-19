import { authFetch } from './authApi';
import type { ScheduleItem, ScheduleItemInput, ScheduleItemUpdate } from '../types';

interface ApiScheduleItem {
  id: string;
  type: 'todo' | 'event';
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'high' | 'medium' | 'low' | 'green';
  start_at: string | null;
  due_at: string | null;
  reminder_at: string | null;
  pomodoro_count: number;
  pomodoro_rounds: number;
  total_focus_minutes: number;
  completed_at: string | null;
  deleted_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function fromApi(item: ApiScheduleItem): ScheduleItem {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    description: item.description || '',
    status: item.status,
    priority: item.priority,
    startAt: item.start_at,
    dueAt: item.due_at,
    reminderAt: item.reminder_at,
    pomodoroCount: item.pomodoro_count,
    pomodoroRounds: item.pomodoro_rounds,
    totalFocusMinutes: item.total_focus_minutes,
    completedAt: item.completed_at,
    deletedAt: item.deleted_at,
    sortOrder: item.sort_order,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}

function toApi(data: ScheduleItemInput | ScheduleItemUpdate, id?: string) {
  return {
    id,
    type: data.type,
    title: data.title,
    description: data.description,
    status: data.status,
    priority: data.priority,
    start_at: data.startAt,
    due_at: data.dueAt,
    reminder_at: data.reminderAt,
    pomodoro_count: data.pomodoroCount,
    pomodoro_rounds: data.pomodoroRounds,
    total_focus_minutes: data.totalFocusMinutes,
    completed_at: data.completedAt,
    deleted_at: data.deletedAt,
    sort_order: data.sortOrder,
  };
}

export async function fetchScheduleItems(includeDeleted = true): Promise<ScheduleItem[]> {
  const res = await authFetch(`/api/schedule-items?include_deleted=${includeDeleted ? 'true' : 'false'}`);
  if (!res.ok) throw new Error('failed to fetch schedule items');
  const data = await res.json() as { items: ApiScheduleItem[] };
  return data.items.map(fromApi);
}

export async function createScheduleItem(data: ScheduleItemInput, id?: string): Promise<ScheduleItem> {
  const res = await authFetch('/api/schedule-items', {
    method: 'POST',
    body: JSON.stringify(toApi(data, id)),
  });
  if (!res.ok) throw new Error('failed to create schedule item');
  return fromApi(await res.json() as ApiScheduleItem);
}

export async function patchScheduleItem(id: string, data: ScheduleItemUpdate): Promise<ScheduleItem> {
  const res = await authFetch(`/api/schedule-items/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(toApi(data)),
  });
  if (!res.ok) throw new Error('failed to update schedule item');
  return fromApi(await res.json() as ApiScheduleItem);
}

export async function deleteScheduleItem(id: string, permanent = false): Promise<void> {
  const res = await authFetch(`/api/schedule-items/${encodeURIComponent(id)}?permanent=${permanent ? 'true' : 'false'}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('failed to delete schedule item');
}

export async function restoreScheduleItem(id: string): Promise<ScheduleItem> {
  const res = await authFetch(`/api/schedule-items/${encodeURIComponent(id)}/restore`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('failed to restore schedule item');
  return fromApi(await res.json() as ApiScheduleItem);
}

export async function clearScheduleItems(): Promise<void> {
  const res = await authFetch('/api/schedule-items', { method: 'DELETE' });
  if (!res.ok) throw new Error('failed to clear schedule items');
}
