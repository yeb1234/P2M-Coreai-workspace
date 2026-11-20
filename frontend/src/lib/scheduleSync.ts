import { useScheduleStore } from '../stores/scheduleStore';

/**
 * 聊天写动作（Todo / 日历）落库后，把待办、日历、周历共用的 schedule 数据重新拉一遍。
 *
 * 这些页面读的是 localStorage/IndexedDB 之上的 scheduleStore，而 AI 工具直接写
 * 服务端 `schedule_items`。没有这一步，聊天里显示“已创建”，页面却要等下次刷新
 * 或重新进入才出现。多个写动作同时回来时共用同一个请求，避免重复刷新。
 */
let refreshInFlight: Promise<void> | null = null;

export function refreshScheduleFromServer(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = useScheduleStore
    .getState()
    .loadItems()
    .catch(() => undefined)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}
