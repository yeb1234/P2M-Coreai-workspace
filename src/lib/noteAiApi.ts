import { apiFetch } from './videoApi';
import { createScheduleItem } from './scheduleApi';
import { createCalendarEvent } from './calendarApi';

export type NoteAiAction = 'summary' | 'polish' | 'actions';

export interface NoteAiTodo {
  title: string;
  description?: string;
  due_date?: string | null;
  priority?: 'high' | 'medium' | 'low' | 'green';
}

export interface NoteAiEvent {
  title: string;
  date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  description?: string;
}

export interface NoteAiResult {
  summary?: string;
  markdown?: string;
  todos?: NoteAiTodo[];
  events?: NoteAiEvent[];
  provider?: string;
  model?: string;
}

export interface NoteAiResponse {
  action: NoteAiAction;
  result: NoteAiResult;
  provider?: string;
  model?: string;
}

export async function runNoteAi(input: {
  action: NoteAiAction;
  title: string;
  markdown: string;
  instruction?: string;
}): Promise<NoteAiResponse> {
  return apiFetch<NoteAiResponse>('/api/notes/ai', {
    method: 'POST',
    body: JSON.stringify(input),
    timeoutMs: 90000,
  });
}

export async function createTodoFromAi(item: NoteAiTodo): Promise<void> {
  const description = [item.description?.trim(), item.due_date ? `建议截止：${item.due_date}` : '']
    .filter(Boolean)
    .join('\n');
  await createScheduleItem({
    type: 'todo',
    title: item.title,
    description,
    priority: item.priority || 'green',
    status: 'pending',
  });
}

export async function createCalendarEventFromAi(item: NoteAiEvent): Promise<void> {
  if (!item.date) throw new Error('这条日程没有明确日期，先补上日期再创建');
  await createCalendarEvent({
    title: item.title,
    date: item.date,
    startTime: item.start_time || undefined,
    endTime: item.end_time || undefined,
    type: 'event',
    color: '#8b5cf6',
    todoId: null,
    pomodoroSessionId: null,
    description: item.description || '',
  });
}
