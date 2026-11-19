import Dexie from 'dexie';
import type { StateStorage } from 'zustand/middleware';
import { deleteUserData, getUserData, hasAuthToken, setUserData } from './authApi';

interface UserRow {
  username: string;
  passwordHash: string;
  displayName?: string;
}

class P2MDexie extends Dexie {
  kv!: Dexie.Table<{ key: string; value: string }, string>;
  users!: Dexie.Table<UserRow, string>;
  constructor() {
    super('P2MStorage');
    this.version(1).stores({ kv: 'key' });
    this.version(2).stores({ kv: 'key', users: 'username' });
  }
}

const hasIndexedDb = typeof indexedDB !== 'undefined';
const db = hasIndexedDb ? new P2MDexie() : null;
const memoryKv = new Map<string, string>();

export function setCurrentUser(_username: string | null) {
  // 旧的本地账号体系已废弃；这个标记没有读取方，而且会把上一个账号的
  // 显示名留在浏览器里跨账号可见。统一清掉，不再写。
  try {
    localStorage.removeItem('p2m-current-user');
  } catch {
    /* 隐私模式忽略 */
  }
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();
const pendingLocalWrites = new Map<string, ReturnType<typeof setTimeout>>();
const lastValues = new Map<string, string>();
const lastLocalValues = new Map<string, string>();
const lastLocalWriteAt = new Map<string, number>();
const DEBOUNCE_MS = 3000;
const LOCAL_MAX_WAIT_MS = 15000;
const IMMEDIATE_LOCAL_STORAGE_NAMES = new Set(['p2m-pomodoro-storage', 'p2m-notification-storage', 'p2m-plugin-storage', 'p2m-ui-storage']);

function scheduleWrite(name: string, value: string) {
  lastValues.set(name, value);
  const existing = pendingWrites.get(name);
  if (existing) clearTimeout(existing);
  pendingWrites.set(name, setTimeout(() => {
    pendingWrites.delete(name);
    doWrite(name, value);
  }, DEBOUNCE_MS));
}

async function doWrite(name: string, value: string) {
  if (hasAuthToken()) {
    try {
      await setUserData(name, value);
      return;
    } catch {
      // Fall through to local storage as fallback
    }
  }
  if (!db) { memoryKv.set(idbKey(name), value); return; }
  await db.kv.put({ key: idbKey(name), value });
}

function scheduleLocalWrite(name: string, value: string) {
  if (lastLocalValues.get(name) === value) return;
  lastLocalValues.set(name, value);
  const existing = pendingLocalWrites.get(name);
  if (existing) clearTimeout(existing);

  const now = Date.now();
  const lastWriteAt = lastLocalWriteAt.get(name) ?? now;
  if (now - lastWriteAt >= LOCAL_MAX_WAIT_MS) {
    lastLocalWriteAt.set(name, now);
    void doLocalWrite(name, value);
    pendingLocalWrites.delete(name);
    return;
  }

  pendingLocalWrites.set(name, setTimeout(() => {
    pendingLocalWrites.delete(name);
    lastLocalWriteAt.set(name, Date.now());
    doLocalWrite(name, value);
  }, DEBOUNCE_MS));
}

async function doLocalWrite(name: string, value: string) {
  if (!db) { memoryKv.set(idbKey(name), value); return; }
  await db.kv.put({ key: idbKey(name), value });
}

/** IndexedDB 的 key 加用户前缀。后端按 user_id 隔离，本地兜底也必须隔离。 */
function idbKey(name: string): string {
  const uid = localStorage.getItem('p2m-auth-user-id');
  return uid ? `u${uid}:${name}` : name;
}

function scopedLocalName(name: string): string {
  const uid = localStorage.getItem('p2m-auth-user-id');
  return uid ? `u${uid}:${name}` : name;
}

function baseLocalName(name: string): string {
  return name.includes(':') ? name.slice(name.lastIndexOf(':') + 1) : name;
}

function shouldWriteLocalImmediately(name: string): boolean {
  return IMMEDIATE_LOCAL_STORAGE_NAMES.has(baseLocalName(name));
}

function shouldWriteImmediately(name: string): boolean {
  return IMMEDIATE_LOCAL_STORAGE_NAMES.has(baseLocalName(name));
}

async function flushWrites(): Promise<void> {
  const jobs: Promise<unknown>[] = [];
  for (const [name, timer] of pendingWrites.entries()) {
    clearTimeout(timer);
    pendingWrites.delete(name);
    const value = lastValues.get(name);
    if (value !== undefined) jobs.push(doWrite(name, value));
  }
  await Promise.allSettled(jobs);
}

async function flushLocalWrites(): Promise<void> {
  const jobs: Promise<unknown>[] = [];
  for (const [name, timer] of pendingLocalWrites.entries()) {
    clearTimeout(timer);
    pendingLocalWrites.delete(name);
    const value = lastLocalValues.get(name);
    if (value !== undefined) {
      lastLocalWriteAt.set(name, Date.now());
      jobs.push(doLocalWrite(name, value));
    }
  }
  await Promise.allSettled(jobs);
}

/** 把 debounce 队列里的待写数据立刻落盘。登出与切账号前必须 await 它。 */
export async function flushAllPending(): Promise<void> {
  await Promise.allSettled([flushWrites(), flushLocalWrites()]);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { void flushAllPending(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushAllPending();
  });
}

export const idbStorage: StateStorage = {
  getItem: async (name: string) => {
    // 读取优先级：云端 > 本地兜底 > null（用 store 默认值）
    //
    // 之前是「登录态只读云端，拿不到就返回 null」，缺了回读本地这一步。
    // 后果：后端还没有这份数据时（首次登录、或者用户从没改过这个 store），
    // store 会以为「没有数据」而用默认值初始化。用户看到番茄钟配置变回默认、
    // 待办清空，然后一改就把默认值推上云端，把真数据覆盖掉。
    // 番茄钟「换设备折腾好久」就是这条路径。
    if (hasAuthToken()) {
      try {
        const result = await getUserData(name);
        if (result !== null && result !== undefined) return result;
      } catch {
        // 云端读失败，继续走本地兜底
      }
    }
    if (!db) return memoryKv.get(idbKey(name)) ?? null;
    const row = await db.kv.get(idbKey(name));
    return row?.value ?? null;
  },
  setItem: async (name: string, value: string) => {
    if (shouldWriteImmediately(name)) {
      const existing = pendingWrites.get(name);
      if (existing) { clearTimeout(existing); pendingWrites.delete(name); }
      await doWrite(name, value);
      return;
    }
    scheduleWrite(name, value);
  },
  removeItem: async (name: string) => {
    const existing = pendingWrites.get(name);
    if (existing) { clearTimeout(existing); pendingWrites.delete(name); }
    if (hasAuthToken()) {
      try {
        await deleteUserData(name);
        return;
      } catch {
        // Fall through to local storage
      }
    }
    if (!db) { memoryKv.delete(name); return; }
    await db.kv.delete(name);
  },
};

// Pure local storage — never touches backend API, always uses IndexedDB
export const localOnlyStorage: StateStorage = {
  getItem: async (name: string) => {
    if (hasAuthToken()) return null;
    const scopedName = scopedLocalName(name);
    if (!db) return memoryKv.get(scopedName) ?? memoryKv.get(name) ?? null;
    const row = await db.kv.get(scopedName) ?? await db.kv.get(name);
    if (row?.value !== undefined) lastLocalValues.set(scopedName, row.value);
    if (row?.value !== undefined) lastLocalWriteAt.set(scopedName, Date.now());
    return row?.value ?? null;
  },
  setItem: async (name: string, value: string) => {
    if (hasAuthToken()) return;
    const scopedName = scopedLocalName(name);
    if (shouldWriteLocalImmediately(scopedName)) {
      const existing = pendingLocalWrites.get(scopedName);
      if (existing) { clearTimeout(existing); pendingLocalWrites.delete(scopedName); }
      lastLocalValues.set(scopedName, value);
      lastLocalWriteAt.set(scopedName, Date.now());
      await doLocalWrite(scopedName, value);
      return;
    }
    scheduleLocalWrite(scopedName, value);
  },
  removeItem: async (name: string) => {
    if (hasAuthToken()) return;
    const scopedName = scopedLocalName(name);
    const existing = pendingLocalWrites.get(scopedName);
    if (existing) { clearTimeout(existing); pendingLocalWrites.delete(scopedName); }
    lastLocalValues.delete(scopedName);
    lastLocalWriteAt.delete(scopedName);
    if (!db) { memoryKv.delete(scopedName); return; }
    await db.kv.delete(scopedName);
  },
};

export async function clearIDBKvData(): Promise<void> {
  if (!db) { memoryKv.clear(); return; }
  await db.kv.clear();
}

/**
 * 首次登录时的存量同步。
 *
 * 场景：用户之前是本地模式（或从旧版本升级上来），IndexedDB 里有一批数据，
 * 但云端 user_data 还是空的。此时如果什么都不做，用户一改就会用新值覆盖，
 * 老数据白丢。
 *
 * 做法：把当前用户在本地存的每个 key，逐个检查云端；云端没有的推上去。
 * 云端已有的**不动** —— 云端优先，避免多设备场景下用旧设备覆盖新设备。
 */
export async function bootstrapLocalToRemote(): Promise<{ pushed: number; skipped: number }> {
  if (!hasAuthToken() || !db) return { pushed: 0, skipped: 0 };

  const uid = localStorage.getItem('p2m-auth-user-id');
  const prefix = uid ? `u${uid}:` : '';
  if (!prefix) return { pushed: 0, skipped: 0 };

  const rows = await db.kv.where('key').startsWith(prefix).toArray();
  let pushed = 0;
  let skipped = 0;

  for (const row of rows) {
    const name = row.key.slice(prefix.length);
    if (!name.startsWith('p2m-')) continue;
    try {
      const remote = await getUserData(name);
      if (remote !== null && remote !== undefined) {
        skipped += 1;
        continue;
      }
      await setUserData(name, row.value);
      pushed += 1;
    } catch {
      // 单个 key 失败不影响其它
    }
  }
  return { pushed, skipped };
}

/**
 * 登录后重新加载所有持久化 store。
 *
 * 为什么必须做
 * -----------
 * SPA 的加载顺序是：页面渲染 → store 初始化（此时还没登录，getItem 只能读到本地，
 * 新设备上是空的）→ 用户登录。登录完成后 store **不会**自动重读云端，
 * 于是页面继续显示默认值 —— 用户看到的是「我的待办没了」「番茄钟配置回到默认」。
 *
 * 番茄钟「换设备折腾好久」就是这条路径：数据其实在云端，只是没人去拿。
 *
 * 实现上要求每个 store 都用了 persist 中间件（有 .persist.rehydrate）。
 * 没用的会在 filter 里被跳过。
 */


// 临时诊断入口（跨设备加载排查用，定位完删）
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__p2mDebug = {
    getItem: idbStorage.getItem,
    hasAuthToken,
  };
}
