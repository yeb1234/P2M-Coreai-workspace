import type { ChatAction } from '../stores/aiStore';
import { removeServerNoteFromLocal, syncServerNoteIntoLocal, type ServerNoteTarget } from './serverNotesSync';
import { refreshScheduleFromServer } from './scheduleSync';

const isAppliedScheduleAction = (action: ChatAction) =>
  (action.action_type === 'todo' || action.action_type === 'calendar') &&
  action.status === 'applied';

/**
 * 聊天 `done` 回执统一入口：
 * - note：按当前页面目标回填便签墙 / Markdown 笔记；
 * - todo / calendar：刷新待办、日历、周历共用的 scheduleStore。
 *
 * 只处理已 applied 的动作；确认卡之前的中断、失败动作都不应改动页面数据。
 */
export function syncAssistantActions(
  actions: ChatAction[] | undefined,
  noteTarget: ServerNoteTarget,
): void {
  if (!actions?.length) return;

  for (const action of actions) {
    if (action.action_type !== 'note' || action.status !== 'applied' || !action.target_id) {
      continue;
    }
    const noteId = Number(action.target_id);
    if (!Number.isFinite(noteId)) continue;
    void syncServerNoteIntoLocal(noteId, noteTarget);
  }

  if (actions.some(isAppliedScheduleAction)) {
    void refreshScheduleFromServer();
  }
}

/**
 * 撤回动作后的页面清理。后端撤回接口已经把 Todo / 日历软删，这里只需要让
 * 页面数据重新跟服务端对齐；笔记则还要把本地 `srv-<id>` 副本一起清掉。
 */
export function syncAssistantActionUndo(action: ChatAction): void {
  if (action.action_type === 'note' && action.target_id) {
    const noteId = Number(action.target_id);
    if (Number.isFinite(noteId)) {
      void removeServerNoteFromLocal(noteId);
    }
    return;
  }

  if (action.action_type === 'todo' || action.action_type === 'calendar') {
    void refreshScheduleFromServer();
  }
}
