/**
 * 按用户隔离的浏览器存储封装。
 *
 * 背景：项目里有一批配置直接写裸 key（`p2m_current_video_id`、
 * `p2.interview.progress.v1`、`p2m-custom-bookmarks-v1`……），key 里没有用户标识。
 * 同一浏览器换账号登录时，B 会读到 A 的偏好 / 学习状态，表现为「数据串了」。
 *
 * 这里统一加 `u{userId}:` 前缀（与 idbStorage 的 IndexedDB 分区保持一致），
 * 并在首次读取旧裸 key 时把它搬进当前用户域后删除裸 key。
 * 登出 / 切换账号前会调用 migrateLegacyUserScopedKeys(oldUserId)，
 * 把尚未被访问过的裸 key 也归到上一个账号，避免它们落到下一个账号。
 */
import { getSessionUserId } from './authApi';

/** 所有需要按用户隔离的持久化 key。新增裸 key 时必须同步加进这里。 */
export const USER_SCOPED_STORAGE_KEYS = [
  'p2m-role',
  'p2.interview.progress.v1',
  'p2.interview.knowledge.read.v1',
  'p2m-custom-bookmarks-v1',
  'p2m_current_video_id',
  'p2m_video_nav_state',
  'p2m_pending_recommended_video_id',
  'p2m_pending_seek_sec',
  'p2m_pending_autoplay_video_id',
  'p2m-video-player-settings',
  'p2m-video-player-settings-auto-play-default-v1',
  'p2m-ambient-playback-state-v1',
  'p2m-timecenter-layout',
  'p2m_video_grid_columns',
] as const;

function scopedKeyForUser(userId: string, name: string): string {
  return `u${userId}:${name}`;
}

function currentScopedKey(name: string): string | null {
  const userId = getSessionUserId();
  return userId ? scopedKeyForUser(userId, name) : null;
}

/**
 * 把旧版的无前缀 key 归入指定用户域。
 *
 * 只在明确知道这些数据属于谁时调用（登出前、切换账号前、启动时已有会话标记）。
 * 不覆盖已经存在的用户域值，只补写缺失项；旧裸 key 无论是否迁移都删除。
 */
export function migrateLegacyUserScopedKeys(userId: string | null | undefined = getSessionUserId()): void {
  if (typeof localStorage === 'undefined' || !userId) return;
  for (const name of USER_SCOPED_STORAGE_KEYS) {
    try {
      const legacy = localStorage.getItem(name);
      if (legacy === null) continue;
      const scoped = scopedKeyForUser(userId, name);
      if (localStorage.getItem(scoped) === null) {
        localStorage.setItem(scoped, legacy);
      }
      localStorage.removeItem(name);
    } catch {
      /* 隐私模式或配额失败时不要阻塞页面 */
    }
  }
}

export const userScopedStorage = {
  getItem(name: string): string | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const scoped = currentScopedKey(name);
      if (!scoped) return localStorage.getItem(name);

      const value = localStorage.getItem(scoped);
      if (value !== null) return value;

      // 兼容历史：把裸 key 的值迁进当前用户域，然后删掉裸 key。
      // 只在当前用户已确定时迁移，避免把数据落到无主状态后被别人读到。
      const legacy = localStorage.getItem(name);
      if (legacy !== null) {
        localStorage.setItem(scoped, legacy);
        localStorage.removeItem(name);
        return legacy;
      }
      return null;
    } catch {
      return null;
    }
  },

  setItem(name: string, value: string): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const scoped = currentScopedKey(name);
      if (!scoped) {
        localStorage.setItem(name, value);
        return;
      }
      localStorage.setItem(scoped, value);
      // 写新值后不再保留可能被其他账号读到的裸 key
      localStorage.removeItem(name);
    } catch {
      /* 隐私模式或配额失败时调用方按默认值继续 */
    }
  },

  removeItem(name: string): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const scoped = currentScopedKey(name);
      if (scoped) localStorage.removeItem(scoped);
      localStorage.removeItem(name);
    } catch {
      /* ignore */
    }
  },
};

/**
 * sessionStorage 里的观看会话 id 也是浏览器级的。
 * 它不像学习进度那样需要跨账号保留，直接按用户分区即可；
 * 没有会话标记时退回裸 key，方便登录页 / 测试使用。
 */
export const userScopedSessionStorage = {
  getItem(name: string): string | null {
    if (typeof sessionStorage === 'undefined') return null;
    try {
      const scoped = currentScopedKey(name);
      if (!scoped) return sessionStorage.getItem(name);
      return sessionStorage.getItem(scoped);
    } catch {
      return null;
    }
  },

  setItem(name: string, value: string): void {
    if (typeof sessionStorage === 'undefined') return;
    try {
      const scoped = currentScopedKey(name);
      if (!scoped) {
        sessionStorage.setItem(name, value);
        return;
      }
      sessionStorage.setItem(scoped, value);
      sessionStorage.removeItem(name);
    } catch {
      /* 隐私模式下 sessionStorage 可能不可用 */
    }
  },

  removeItem(name: string): void {
    if (typeof sessionStorage === 'undefined') return;
    try {
      const scoped = currentScopedKey(name);
      if (scoped) sessionStorage.removeItem(scoped);
      sessionStorage.removeItem(name);
    } catch {
      /* ignore */
    }
  },
};
