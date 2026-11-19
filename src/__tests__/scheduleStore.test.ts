import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useScheduleStore } from '../stores/scheduleStore';

/**
 * scheduleStore 的单元测试。
 *
 * 由 todoStore.test.ts 迁移而来。原来的测试覆盖 11 个方法，
 * 迁移后只保留 6 个 —— 因为 scheduleStore 是后端同步层，
 * 有几项能力本身就不存在了：
 *
 *   删掉 getFilteredTodos    过滤逻辑现在由页面自己按 filter 字段算
 *   删掉 getTodosByDate      按日期取待办改成在组件里 filter
 *   删掉 toggleTodoStatus    状态变更走 updateItem
 *   删掉 trashCompletedTodos 完成后进回收站是后端的行为
 *
 * 保留的 6 项测的是本地状态机（乐观更新 + undo/redo），
 * 这部分逻辑在 store 里，值得测。
 *
 * 注意：store 的写操作是「先改本地状态，再异步调后端」。
 * 测试里 mock 掉所有 API，只验状态变化 —— 断言不需要等 promise。
 */

vi.mock('../lib/scheduleApi', () => ({
  createScheduleItem: vi.fn().mockResolvedValue({ id: 'mock', type: 'todo' }),
  deleteScheduleItem: vi.fn().mockResolvedValue(undefined),
  patchScheduleItem: vi.fn().mockResolvedValue(undefined),
  restoreScheduleItem: vi.fn().mockResolvedValue(undefined),
  fetchScheduleItems: vi.fn().mockResolvedValue([]),
  clearScheduleItems: vi.fn().mockResolvedValue(undefined),
}));

const reset = () => {
  useScheduleStore.setState({
    items: {},
    itemOrder: [],
    filter: { priority: null, status: 'all', searchQuery: '' },
    pendingTodoDate: null,
    pendingTodoPriority: null,
    loading: false,
    error: null,
    undoStack: [],
    redoStack: [],
  });
};

describe('scheduleStore', () => {
  beforeEach(reset);

  it('adds a todo', () => {
    const id = useScheduleStore.getState().addTodo({ title: 'Test todo' });
    const item = useScheduleStore.getState().items[id];
    expect(item).toBeDefined();
    expect(item.title).toBe('Test todo');
    expect(item.type).toBe('todo');
  });

  it('只有 todo 类型进 itemOrder', () => {
    const todoId = useScheduleStore.getState().addTodo({ title: 'A todo' });
    const eventId = useScheduleStore.getState().addEvent({ title: 'An event' });
    const order = useScheduleStore.getState().itemOrder;
    expect(order).toContain(todoId);
    expect(order).not.toContain(eventId);
    // 但两者都在 items 里
    expect(useScheduleStore.getState().items[eventId]).toBeDefined();
  });

  it('deleteItem 是软删除（标记 deletedAt，不物理移除）', () => {
    const id = useScheduleStore.getState().addTodo({ title: 'To delete' });
    useScheduleStore.getState().deleteItem(id);
    const item = useScheduleStore.getState().items[id];
    // 条目还在，只是被标记 —— 这样才能 restore 和 undo
    expect(item).toBeDefined();
    expect(item.deletedAt).toBeTruthy();
    // itemOrder 不清 —— 排序是位置信息，删除是状态信息，
    // 渲染层按 deletedAt 过滤，两者互不干扰
    expect(useScheduleStore.getState().itemOrder).toContain(id);
  });

  it('restores a deleted item', () => {
    const id = useScheduleStore.getState().addTodo({ title: 'To restore' });
    useScheduleStore.getState().deleteItem(id);
    useScheduleStore.getState().restoreItem(id);
    expect(useScheduleStore.getState().items[id].deletedAt).toBeNull();
    expect(useScheduleStore.getState().itemOrder).toContain(id);
  });

  it('updates an item', () => {
    const id = useScheduleStore.getState().addTodo({ title: 'Original' });
    useScheduleStore.getState().updateItem(id, { title: 'Updated' });
    expect(useScheduleStore.getState().items[id].title).toBe('Updated');
  });

  it('undoes a creation', () => {
    const id = useScheduleStore.getState().addTodo({ title: 'Undo me' });
    expect(useScheduleStore.getState().items[id]).toBeDefined();
    useScheduleStore.getState().undo();
    expect(useScheduleStore.getState().items[id]).toBeUndefined();
  });

  it('redoes after undo', () => {
    const id = useScheduleStore.getState().addTodo({ title: 'Redo me' });
    useScheduleStore.getState().undo();
    expect(useScheduleStore.getState().items[id]).toBeUndefined();
    useScheduleStore.getState().redo();
    expect(useScheduleStore.getState().items[id]).toBeDefined();
  });

  it('undo 栈上限 50', () => {
    for (let i = 0; i < 60; i += 1) {
      useScheduleStore.getState().addTodo({ title: `Todo ${i}` });
    }
    expect(useScheduleStore.getState().undoStack.length).toBeLessThanOrEqual(50);
  });
});
