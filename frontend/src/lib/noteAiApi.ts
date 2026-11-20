import { apiFetch } from './videoApi';
import { createScheduleItem } from './scheduleApi';
import { refreshScheduleFromServer } from './scheduleSync';
import { combineLocalDateTime, defaultDueAt } from './scheduleTime';

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
  const dueDate = item.due_date?.slice(0, 10);
  const dueAt = dueDate ? combineLocalDateTime(dueDate, '23:59') : undefined;
  const startAt = dueDate ? combineLocalDateTime(dueDate, '00:00') : undefined;
  await createScheduleItem({
    type: 'todo',
    title: item.title,
    description: item.description?.trim() || '',
    priority: item.priority || 'green',
    status: 'pending',
    startAt,
    dueAt,
  });
  // 笔记 AI 的“加入待办”也写服务端 schedule_items；刷新共用 store，
  // 否则已打开的待办 / 日历 / 周历页面要重新进入才能看到。
  await refreshScheduleFromServer();
}

export async function createCalendarEventFromAi(item: NoteAiEvent): Promise<void> {
  if (!item.date) throw new Error('这条日程没有明确日期，先补上日期再创建');
  const date = item.date.slice(0, 10);
  const startTime = item.start_time?.slice(0, 5);
  const endTime = item.end_time?.slice(0, 5);
  const startAt = startTime
    ? combineLocalDateTime(date, startTime)
    : combineLocalDateTime(date, '00:00');
  const dueAt = endTime
    ? combineLocalDateTime(date, endTime)
    : startTime
      ? defaultDueAt(startAt)
      : combineLocalDateTime(date, '23:59');

  // 日历页 / 周历读 scheduleStore；不能继续写 legacy calendar_events，
  // 否则会出现“已加入日历”但页面永远看不到。
  await createScheduleItem({
    type: 'event',
    title: item.title,
    description: item.description || '',
    status: 'pending',
    priority: 'green',
    startAt,
    dueAt,
  });
  await refreshScheduleFromServer();
}
