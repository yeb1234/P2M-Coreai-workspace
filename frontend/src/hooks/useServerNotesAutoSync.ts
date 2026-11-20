import { useEffect } from 'react';
import { syncAllServerNotesIntoLocal, type ServerNoteTarget } from '../lib/serverNotesSync';
import { useMdNotesStore } from '../stores/mdNotesStore';

// 同一页面可能在主窗口和独立笔记窗口中同时打开；用模块级时间戳做去重，
// 避免 focus 与 visibilitychange 连着触发两次全量同步。
const AUTO_SYNC_INTERVAL_MS = 5_000;
const lastSyncAt = new Map<ServerNoteTarget, number>();

/**
 * 便签页 / Markdown 笔记页打开或重新获得焦点时，把服务端 notes 表里
 * 属于当前功能面（surface）的记录增量导入本地 store。
 *
 * 聊天助手保存笔记时已按 noteTarget 回填，但有两种情况页面仍会落后：
 * 1. 保存发生在其他页面，当前功能页是后来才打开；
 * 2. 页面在独立窗口中打开，主窗口的 store 更新不到它。
 *
 * 这里不再让用户点“从服务端同步”按钮：进入页面、切回窗口都会静默对齐一次。
 * 同步失败保持静默，页面继续用本地数据，手动同步按钮仍保留作兜底。
 */
export function useServerNotesAutoSync(target: ServerNoteTarget): void {
  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let pending = false;

    const run = async (force = false) => {
      if (disposed) return;
      if (inFlight) {
        pending = true;
        return;
      }
      const now = Date.now();
      if (!force && now - (lastSyncAt.get(target) ?? 0) < AUTO_SYNC_INTERVAL_MS) return;
      lastSyncAt.set(target, now);
      inFlight = true;

      // 全量同步会依次 import 服务端笔记，import 会把 activeNoteId 指向新条目。
      // 页面已经打开一篇笔记时，不应该因为后台同步把正在看的内容切走。
      const previousActiveId = target === 'md' ? useMdNotesStore.getState().activeNoteId : null;
      try {
        await syncAllServerNotesIntoLocal(target);
        if (target === 'md' && previousActiveId) {
          const state = useMdNotesStore.getState();
          if (state.notes.some((note) => note.id === previousActiveId && !note.trashedAt)) {
            state.setActiveNote(previousActiveId);
          }
        }
      } catch {
        // 自动同步是增强路径，失败不打断编辑；手动按钮仍可重试。
      } finally {
        inFlight = false;
        if (pending && !disposed) {
          pending = false;
          void run();
        }
      }
    };

    void run(true);

    const handleFocus = () => {
      void run();
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void run();
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      disposed = true;
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [target]);
}
