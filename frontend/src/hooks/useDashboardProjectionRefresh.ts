import { useEffect } from 'react';
import { useCalendarStore, useScheduleStore } from '../stores';

/**
 * 工作台的数据保鲜。
 *
 * 摘要现在读的是 store 的实时状态，store 一变卡片就跟着变；但待办/日历的
 * 权威数据在后端（scheduleStore / calendarStore 不是 localStorage 持久化的
 * store），只靠登录时 load 一次的话，工作台挂久了看到的就是旧值。
 * 所以在工作台挂载时、以及页面重新可见时重新拉一次，保证"停留期间也同步"。
 */
export function useDashboardProjectionRefresh(enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const refresh = () => {
      void useScheduleStore.getState().loadItems();
      void useCalendarStore.getState().loadEvents();
    };

    refresh();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [enabled]);
}
