import { beforeEach, describe, expect, it } from 'vitest';
import { SESSION_USER_KEY } from '../lib/authApi';
import {
  USER_SCOPED_STORAGE_KEYS,
  migrateLegacyUserScopedKeys,
  userScopedSessionStorage,
  userScopedStorage,
} from '../lib/userScopedStorage';

const KEY = 'p2m-custom-bookmarks-v1';

function useUser(userId: string | null): void {
  if (userId === null) localStorage.removeItem(SESSION_USER_KEY);
  else localStorage.setItem(SESSION_USER_KEY, userId);
}

describe('userScopedStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('writes and reads under the current numeric user scope', () => {
    useUser('1');
    userScopedStorage.setItem(KEY, 'A');
    expect(localStorage.getItem(`u1:${KEY}`)).toBe('A');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('does not expose user A data after switching to user B', () => {
    useUser('1');
    userScopedStorage.setItem(KEY, 'A');

    useUser('2');
    expect(userScopedStorage.getItem(KEY)).toBeNull();

    userScopedStorage.setItem(KEY, 'B');
    expect(localStorage.getItem(`u1:${KEY}`)).toBe('A');
    expect(localStorage.getItem(`u2:${KEY}`)).toBe('B');
  });

  it('migrates a legacy bare key into the current user and removes it', () => {
    useUser('1');
    localStorage.setItem(KEY, 'legacy-A');

    expect(userScopedStorage.getItem(KEY)).toBe('legacy-A');
    expect(localStorage.getItem(`u1:${KEY}`)).toBe('legacy-A');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('migrates all known bare keys to an explicit user before account switch', () => {
    useUser('1');
    USER_SCOPED_STORAGE_KEYS.forEach((key) => localStorage.setItem(key, `legacy-${key}`));

    migrateLegacyUserScopedKeys('1');

    USER_SCOPED_STORAGE_KEYS.forEach((key) => {
      expect(localStorage.getItem(`u1:${key}`)).toBe(`legacy-${key}`);
      expect(localStorage.getItem(key)).toBeNull();
    });
  });

  it('keeps session storage session ids separated by user', () => {
    useUser('1');
    userScopedSessionStorage.setItem('p2m_watch_session', 'session-A');

    useUser('2');
    expect(userScopedSessionStorage.getItem('p2m_watch_session')).toBeNull();
    userScopedSessionStorage.setItem('p2m_watch_session', 'session-B');

    useUser('1');
    expect(userScopedSessionStorage.getItem('p2m_watch_session')).toBe('session-A');
  });
});
