import Dexie from 'dexie';
import type { StateStorage } from 'zustand/middleware';
import { getUserData, setUserData, deleteUserData } from './authApi';

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

export const idbStorage: StateStorage = {
  getItem: async (name: string) => {
    try {
      const result = await getUserData(name);
      return result ?? null;
    } catch {
      if (!db) return memoryKv.get(name) ?? null;
      const row = await db.kv.get(name);
      return row?.value ?? null;
    }
  },
  setItem: async (name: string, value: string) => {
    try {
      await setUserData(name, value);
    } catch {
      if (!db) { memoryKv.set(name, value); return; }
      await db.kv.put({ key: name, value });
    }
  },
  removeItem: async (name: string) => {
    try {
      await deleteUserData(name);
    } catch {
      if (!db) { memoryKv.delete(name); return; }
      await db.kv.delete(name);
    }
  },
};
