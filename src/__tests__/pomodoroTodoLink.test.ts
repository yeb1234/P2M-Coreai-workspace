import { describe, it, expect, beforeEach, vi } from 'vitest';
import { usePomodoroStore, POMODORO_VIRTUAL_TODO_ID } from '../stores/pomodoroStore';
import { useScheduleStore } from '../stores/scheduleStore';

/**
 * 番茄钟 → 待办 的联动。
 *
 * 这里测的是一条曾经断掉的链路：
 * 用户在待办上点「开始番茄」，做完一轮后，
 * 待办的 pomodoroCount 应该 +1（进度条靠它渲染）。
 *
 * 之前的实现里 pomodoroStore 只读不写，待办进度永远停在 0%。
 */

vi.mock('../lib/scheduleApi', () => ({
  createScheduleItem: vi.fn().mockResolvedValue({ id: 'mock', type: 'todo' }),
  deleteScheduleItem: vi.fn().mockResolvedValue(undefined),
  patchScheduleItem: vi.fn().mockResolvedValue(undefined),
  restoreScheduleItem: vi.fn().mockResolvedValue(undefined),
  fetchScheduleItems: vi.fn().mockResolvedValue([]),
  clearScheduleItems: vi.fn().mockResolvedValue(undefined),
}));

// 不 mock pomodoroSync —— 它导出的函数很多，内部对后端的调用失败会自己 catch，
// 这里只关心本地状态联动。

describe('番茄钟 → 待办 联动', () => {
  beforeEach(() => {
    useScheduleStore.setState({ items: {}, itemOrder: [], undoStack: [], redoStack: [] });
  });

  it('做完一轮工作后，待办的 pomodoroCount +1', () => {
    const todoId = useScheduleStore.getState().addTodo({ title: '要专注的任务' });
    const before = useScheduleStore.getState().items[todoId].pomodoroCount;

    usePomodoroStore.getState().linkToTodo(todoId);
    usePomodoroStore.getState().startTimer(todoId);
    usePomodoroStore.getState().completePhase();

    const after = useScheduleStore.getState().items[todoId].pomodoroCount;
    expect(after).toBe(before + 1);
  });

  it('连续两轮累加', () => {
    const todoId = useScheduleStore.getState().addTodo({ title: '两轮任务' });
    usePomodoroStore.getState().linkToTodo(todoId);
    usePomodoroStore.getState().startTimer(todoId);

    for (let i = 0; i < 2; i += 1) {
      usePomodoroStore.getState().completePhase(); // 结束工作
      usePomodoroStore.getState().completePhase(); // 结束休息
    }

    expect(useScheduleStore.getState().items[todoId].pomodoroCount).toBe(2);
  });

  it('虚拟待办不写回（不关联具体任务时）', () => {
    usePomodoroStore.getState().linkToTodo(POMODORO_VIRTUAL_TODO_ID);
    usePomodoroStore.getState().startTimer(POMODORO_VIRTUAL_TODO_ID);
    usePomodoroStore.getState().completePhase();

    // 虚拟 id 不在 items 里，不应该凭空创建条目
    expect(useScheduleStore.getState().items[POMODORO_VIRTUAL_TODO_ID]).toBeUndefined();
  });

  it('待办被删除后不再累加', () => {
    const todoId = useScheduleStore.getState().addTodo({ title: '要删的任务' });
    useScheduleStore.getState().deleteItem(todoId);

    usePomodoroStore.getState().linkToTodo(todoId);
    usePomodoroStore.getState().startTimer(todoId);
    const before = useScheduleStore.getState().items[todoId].pomodoroCount;
    usePomodoroStore.getState().completePhase();

    // 软删除的条目不参与累加
    expect(useScheduleStore.getState().items[todoId].pomodoroCount).toBe(before);
  });
});
