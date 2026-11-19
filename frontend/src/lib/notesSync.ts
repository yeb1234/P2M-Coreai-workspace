import { getUserData, hasAuthToken, setUserData } from './authApi';
import type { Note, TrashedNote } from '../stores/notesStore';

/**
 * 笔记的云端同步。
 *
 * 为什么需要
 * ---------
 * 前端笔记原来是纯本地（IndexedDB），两个后果：
 *   1. 换设备/换浏览器就没了
 *   2. 多个用户共用一台机器时，笔记会串台（IndexedDB 是浏览器级的，不是用户级的）
 *
 * 第 2 点在多用户系统里是硬伤 —— 用户 A 写的笔记，用户 B 登录后还能看见。
 *
 * 为什么走 user-data 而不是 /api/notes
 * -----------------------------------
 * /api/notes 对应的是**视频转写的 markdown 笔记**（shared/private 那套）。
 * 前端便签是另一套东西：结构不同（有颜色、置顶、标签），也不绑定视频。
 * 硬塞进 notes 表要改表结构，收益不大。
 *
 * user-data 是 key-value，天然适合存整份快照，番茄钟就是这么做的。
 *
 * 冲突策略
 * -------
 * 采用「后写覆盖」，不做合并。理由：备注是单人编辑场景，多端并发编辑同一张便签
 * 的概率极低，做 CRDT 属于过度设计。真要冲突了，以最后一次保存为准。
 *
 * 但有个保护：**本地是初始种子数据时，优先用远端覆盖**。
 * 否则新设备打开会把自己那几条示例便签当成用户数据推上去，把云端的真数据冲掉。
 */

export const NOTES_REMOTE_KEY = 'p2m-notes-v1';

export interface NotesSnapshot {
  kind: 'notes-v1';
  notes: Note[];
  trash: Record<string, TrashedNote>;
  updatedAt: string;
}

let syncing = false;
let timer: number | null = null;

export async function pushNotes(snapshot: NotesSnapshot): Promise<void> {
  if (!hasAuthToken()) return; // 未登录不同步
  if (syncing) return;         // 防止写入触发的订阅回调再触发写入
  syncing = true;
  try {
    await setUserData(NOTES_REMOTE_KEY, JSON.stringify(snapshot));
  } catch {
    // 同步失败不影响本地使用，下次变更会再试
  } finally {
    syncing = false;
  }
}

export async function pullNotes(): Promise<NotesSnapshot | null> {
  if (!hasAuthToken()) return null;
  try {
    const raw = await getUserData(NOTES_REMOTE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as NotesSnapshot;
    if (!Array.isArray(data?.notes)) return null;
    return data;
  } catch {
    return null;
  }
}

/** 防抖推送：连续编辑时只在停下来 2 秒后推一次。 */
export function scheduleNotesPush(getSnapshot: () => NotesSnapshot): void {
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = null;
    void pushNotes(getSnapshot());
  }, 2000);
}
