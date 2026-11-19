import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TodoSummary } from '../components/dashboard/summaries/TodoSummary';
import { RecentNotesSummary } from '../components/dashboard/summaries/RecentNotesSummary';
import { useScheduleStore } from '../stores/scheduleStore';
import { useNotesStore } from '../stores/notesStore';
import { useUIStore } from '../stores/uiStore';
import { selectTodoProjection } from '../lib/projections/todo';
import { selectNotesProjection } from '../lib/projections/notes';
import type { ScheduleItem } from '../types';
import type { Note } from '../stores/notesStore';

vi.mock('../lib/scheduleApi', () => ({
  fetchScheduleItems: vi.fn(async () => []),
  createScheduleItem: vi.fn(async () => undefined),
  patchScheduleItem: vi.fn(async () => undefined),
  deleteScheduleItem: vi.fn(async () => undefined),
  restoreScheduleItem: vi.fn(async () => undefined),
  clearScheduleItems: vi.fn(async () => undefined),
}));

function makeTodo(overrides: Partial<ScheduleItem> & { id: string }): ScheduleItem {
  return {
    type: 'todo',
    title: '待办',
    description: '',
    status: 'pending',
    priority: 'green',
    startAt: null,
    dueAt: null,
    reminderAt: null,
    pomodoroCount: 0,
    pomodoroRounds: 0,
    totalFocusMinutes: 0,
    completedAt: null,
    deletedAt: null,
    sortOrder: 0,
    createdAt: '2026-11-16T01:00:00.000Z',
    updatedAt: '2026-11-16T01:00:00.000Z',
    ...overrides,
  } as ScheduleItem;
}

function makeNote(overrides: Partial<Note> & { id: string }): Note {
  return {
    title: '笔记',
    content: '正文',
    color: 'sticky-yellow',
    tag: '',
    pinned: false,
    createdAt: '2026-11-16T01:00:00.000Z',
    updatedAt: '2026-11-16T01:00:00.000Z',
    ...overrides,
  } as Note;
}

describe('工作台摘要 = 插件页同一份投影', () => {
  beforeEach(() => {
    useScheduleStore.setState({ items: {}, itemOrder: [], loading: false, error: null });
    useNotesStore.setState({ notes: [], trash: {} });
    useUIStore.setState({ activeView: 'dashboard' });
  });

  it('待办投影的计数/今日口径是单一来源', () => {
    const items = {
      a: makeTodo({ id: 'a', title: '今天要交', startAt: '2026-11-16T09:00:00+08:00', dueAt: '2026-11-16T10:00:00+08:00' }),
      b: makeTodo({ id: 'b', title: '今天的已完成', status: 'completed', startAt: '2026-11-16T08:00:00+08:00', dueAt: '2026-11-16T09:00:00+08:00' }),
      c: makeTodo({ id: 'c', title: '昨天的', startAt: '2026-11-15T09:00:00+08:00', dueAt: '2026-11-15T10:00:00+08:00' }),
      d: makeTodo({ id: 'd', title: '删掉的', startAt: '2026-11-16T09:00:00+08:00', dueAt: '2026-11-16T10:00:00+08:00', deletedAt: '2026-11-16T02:00:00+08:00' }),
      e: { ...makeTodo({ id: 'e', title: '日程', startAt: '2026-11-16T09:00:00+08:00', dueAt: '2026-11-16T10:00:00+08:00' }), type: 'event' as const },
    };

    const projection = selectTodoProjection(items, '2026-11-16');

    expect(projection.counts.total).toBe(3); // d 已删除、e 是日程
    expect(projection.todayCounts).toEqual({ done: 1, total: 2 });
    expect(projection.overdue.map((todo) => todo.id)).toEqual(['c']);
  });

  it('待办卡片订阅 store：新增/完成/删除立即反映，无需重挂载', () => {
    render(<TodoSummary />);
    expect(screen.queryByText('写周报')).toBeNull();

    act(() => {
      useScheduleStore.getState().addTodo({ title: '写周报' });
    });
    expect(screen.getByText('写周报')).toBeTruthy();

    const id = Object.values(useScheduleStore.getState().items)[0].id;
    act(() => {
      useScheduleStore.getState().updateItem(id, { status: 'completed' });
    });
    expect(useScheduleStore.getState().items[id].status).toBe('completed');

    act(() => {
      useScheduleStore.getState().deleteItem(id);
    });
    expect(Object.values(useScheduleStore.getState().items).some((item) => item.deletedAt)).toBe(true);
  });

  it('最近笔记卡片按笔记页顺序取前三条（置顶在前），不是按 updatedAt 倒序', () => {
    const notes = [
      makeNote({ id: 'n1', title: '普通笔记一', updatedAt: '2026-11-16T09:00:00+08:00' }),
      makeNote({ id: 'n2', title: '置顶笔记', pinned: true, updatedAt: '2026-11-10T09:00:00+08:00' }),
      makeNote({ id: 'n3', title: '普通笔记二', updatedAt: '2026-11-16T10:00:00+08:00' }),
      makeNote({ id: 'n4', title: '普通笔记三', updatedAt: '2026-11-16T11:00:00+08:00' }),
    ];

    const projection = selectNotesProjection(notes);
    expect(projection.recent.map((note) => note.id)).toEqual(['n2', 'n1', 'n3']);

    useNotesStore.setState({ notes });
    const { container } = render(<RecentNotesSummary />);
    const text = container.textContent ?? '';
    expect(text.indexOf('置顶笔记')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('置顶笔记')).toBeLessThan(text.indexOf('普通笔记一'));
    expect(text).not.toContain('普通笔记三');

    act(() => {
      useNotesStore.getState().addNote({ title: '新写的', content: '刚存下' });
    });
    expect(screen.getByText('新写的')).toBeTruthy();
  });
});
