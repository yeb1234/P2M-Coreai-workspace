import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/serverNotesSync', () => ({
  syncServerNoteIntoLocal: vi.fn(),
  removeServerNoteFromLocal: vi.fn(),
}));

vi.mock('../lib/scheduleSync', () => ({
  refreshScheduleFromServer: vi.fn(),
}));

import type { ChatAction } from '../stores/aiStore';
import { syncAssistantActions, syncAssistantActionUndo } from '../lib/assistantActionSync';
import { removeServerNoteFromLocal, syncServerNoteIntoLocal } from '../lib/serverNotesSync';
import { refreshScheduleFromServer } from '../lib/scheduleSync';

const action = (patch: Partial<ChatAction>): ChatAction => ({
  id: 'a1',
  action_type: 'note',
  status: 'applied',
  title: '测试',
  target_id: '1',
  ...patch,
});

describe('assistantActionSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('便签页保存后按服务端 id 回填便签墙', () => {
    syncAssistantActions([action({ action_type: 'note', target_id: '7' })], 'sticky');
    expect(syncServerNoteIntoLocal).toHaveBeenCalledWith(7, 'sticky');
  });

  it('笔记页保存后回填 Markdown 笔记', () => {
    syncAssistantActions([action({ action_type: 'note', target_id: '9' })], 'md');
    expect(syncServerNoteIntoLocal).toHaveBeenCalledWith(9, 'md');
  });

  it('Todo 动作完成后刷新待办/日历/周历共用的 schedule 数据', () => {
    syncAssistantActions([action({ action_type: 'todo', target_id: 'todo-1' })], 'md');
    expect(refreshScheduleFromServer).toHaveBeenCalledTimes(1);
  });

  it('日历动作完成后同样刷新 schedule 数据', () => {
    syncAssistantActions([action({ action_type: 'calendar', target_id: 'event-1' })], 'md');
    expect(refreshScheduleFromServer).toHaveBeenCalledTimes(1);
  });

  it('多个 schedule 动作合并为一次刷新', () => {
    syncAssistantActions(
      [
        action({ id: 'a1', action_type: 'todo', target_id: 'todo-1' }),
        action({ id: 'a2', action_type: 'calendar', target_id: 'event-1' }),
      ],
      'md',
    );
    expect(refreshScheduleFromServer).toHaveBeenCalledTimes(1);
  });

  it('失败或未 applied 的动作不改页面数据', () => {
    syncAssistantActions([action({ action_type: 'todo', status: 'failed' })], 'md');
    syncAssistantActions([action({ action_type: 'note', status: 'undone' })], 'md');
    expect(refreshScheduleFromServer).not.toHaveBeenCalled();
    expect(syncServerNoteIntoLocal).not.toHaveBeenCalled();
  });

  it('撤回 Todo / 日历后重新对齐 schedule 数据', () => {
    syncAssistantActionUndo(action({ action_type: 'todo', target_id: 'todo-1' }));
    expect(refreshScheduleFromServer).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    syncAssistantActionUndo(action({ action_type: 'calendar', target_id: 'event-1' }));
    expect(refreshScheduleFromServer).toHaveBeenCalledTimes(1);
  });

  it('撤回笔记时清掉本地服务端副本', () => {
    syncAssistantActionUndo(action({ action_type: 'note', target_id: '12' }));
    expect(removeServerNoteFromLocal).toHaveBeenCalledWith(12);
  });
});
