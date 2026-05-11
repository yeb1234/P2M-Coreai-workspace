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
const memoryUsers = new Map<string, UserRow>();

let currentUser: string | null = null;

export function setCurrentUser(username: string | null) {
  currentUser = username;
  if (username) {
    localStorage.setItem('p2m-current-user', username);
  } else {
    localStorage.removeItem('p2m-current-user');
  }
}

export function getCurrentUser(): string | null {
  return currentUser;
}

export function restoreUser(): string | null {
  const saved = localStorage.getItem('p2m-current-user');
  currentUser = saved;
  return saved;
}

export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export async function getUser(username: string): Promise<UserRow | undefined> {
  const normalized = normalizeUsername(username);
  if (!normalized) return undefined;
  if (!db) return memoryUsers.get(normalized) ?? memoryUsers.get(username.trim());

  const normalizedUser = await db.users.get(normalized);
  if (normalizedUser) return normalizedUser;

  const legacyUser = await db.users.get(username.trim());
  if (!legacyUser) return undefined;

  await db.users.put({
    username: normalized,
    passwordHash: legacyUser.passwordHash,
    displayName: legacyUser.displayName || legacyUser.username,
  });
  return db.users.get(normalized);
}

export async function addUser(username: string, passwordHash: string): Promise<void> {
  const normalized = normalizeUsername(username);
  if (!normalized) return;
  if (!db) {
    if (memoryUsers.has(normalized)) throw new Error('User already exists');
    memoryUsers.set(normalized, { username: normalized, passwordHash, displayName: username.trim() });
    return;
  }
  await db.users.add({ username: normalized, passwordHash, displayName: username.trim() });
}

export async function upsertUser(username: string, passwordHash: string): Promise<void> {
  const normalized = normalizeUsername(username);
  if (!normalized) return;
  if (!db) {
    memoryUsers.set(normalized, { username: normalized, passwordHash, displayName: username.trim() });
    return;
  }
  await db.users.put({ username: normalized, passwordHash, displayName: username.trim() });
}

export async function getAllIDBUsers(): Promise<UserRow[]> {
  if (!db) return Array.from(memoryUsers.values());
  return db.users.toArray();
}

export async function getAllIDBKvData(username: string): Promise<Record<string, string>> {
  const prefix = `${username}:`;
  if (!db) {
    const result: Record<string, string> = {};
    for (const [key, value] of memoryKv.entries()) {
      if (key.startsWith(prefix)) {
        result[key.slice(prefix.length)] = value;
      }
    }
    return result;
  }
  const rows = await db.kv.where('key').startsWith(prefix).toArray();
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key.slice(prefix.length)] = row.value;
  }
  return result;
}

export async function clearIDBData(): Promise<void> {
  if (!db) {
    memoryKv.clear();
    memoryUsers.clear();
    return;
  }
  await db.kv.clear();
  await db.users.clear();
}

const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();
const pendingLocalWrites = new Map<string, ReturnType<typeof setTimeout>>();
const lastLocalValues = new Map<string, string>();
const lastLocalWriteAt = new Map<string, number>();
const DEBOUNCE_MS = 3000;
const LOCAL_MAX_WAIT_MS = 15000;
const IMMEDIATE_LOCAL_STORAGE_NAMES = new Set(['p2m-pomodoro-storage']);

function scheduleWrite(name: string, value: string) {
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
      // Fall through to local storage
    }
  }
  if (!db) { memoryKv.set(name, value); return; }
  await db.kv.put({ key: name, value });
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
  if (!db) { memoryKv.set(name, value); return; }
  await db.kv.put({ key: name, value });
}

function scopedLocalName(name: string): string {
  return currentUser ? `${currentUser}:${name}` : name;
}

function baseLocalName(name: string): string {
  return name.includes(':') ? name.slice(name.lastIndexOf(':') + 1) : name;
}

function shouldWriteLocalImmediately(name: string): boolean {
  return IMMEDIATE_LOCAL_STORAGE_NAMES.has(baseLocalName(name));
}

function flushLocalWrites() {
  for (const [name, timer] of pendingLocalWrites.entries()) {
    clearTimeout(timer);
    pendingLocalWrites.delete(name);
    const value = lastLocalValues.get(name);
    if (value !== undefined) {
      lastLocalWriteAt.set(name, Date.now());
      void doLocalWrite(name, value);
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushLocalWrites);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushLocalWrites();
  });
}

export const idbStorage: StateStorage = {
  getItem: async (name: string) => {
    if (hasAuthToken()) {
      try {
        const result = await getUserData(name);
        return result ?? null;
      } catch {
        // Fall through to local storage
      }
    }
    if (!db) return memoryKv.get(name) ?? null;
    const row = await db.kv.get(name);
    return row?.value ?? null;
  },
  setItem: async (name: string, value: string) => {
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
    const scopedName = scopedLocalName(name);
    if (!db) return memoryKv.get(scopedName) ?? memoryKv.get(name) ?? null;
    const row = await db.kv.get(scopedName) ?? await db.kv.get(name);
    if (row?.value !== undefined) lastLocalValues.set(scopedName, row.value);
    if (row?.value !== undefined) lastLocalWriteAt.set(scopedName, Date.now());
    return row?.value ?? null;
  },
  setItem: async (name: string, value: string) => {
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
    const scopedName = scopedLocalName(name);
    const existing = pendingLocalWrites.get(scopedName);
    if (existing) { clearTimeout(existing); pendingLocalWrites.delete(scopedName); }
    lastLocalValues.delete(scopedName);
    lastLocalWriteAt.delete(scopedName);
    if (!db) { memoryKv.delete(scopedName); return; }
    await db.kv.delete(scopedName);
  },
};
