import { create } from 'zustand';
import {
  loginUser,
  registerUser,
  getMe,
  migrateFromIDB,
} from '../lib/authApi';
import {
  addUser,
  clearIDBData,
  getAllIDBKvData,
  getAllIDBUsers,
  getUser,
  hashPassword,
  normalizeUsername,
  restoreUser,
  setCurrentUser,
} from '../lib/idbStorage';

interface AuthState {
  currentUser: string | null;
  initialized: boolean;
  error: string | null;
  init: () => void;
  login: (username: string, password: string) => Promise<boolean>;
  register: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  currentUser: null,
  initialized: false,
  error: null,

  init: async () => {
    const token = localStorage.getItem('p2m-auth-token');
    if (token) {
      try {
        const user = await getMe();
        const displayName = user.display_name || user.username;
        setCurrentUser(displayName);
        set({ currentUser: displayName, initialized: true });
        return;
      } catch {
        localStorage.removeItem('p2m-auth-token');
      }
    }
    const saved = restoreUser();
    set({ currentUser: saved, initialized: true });
  },

  login: async (username, password) => {
    const normalized = normalizeUsername(username);
    if (!normalized || !password) {
      set({ error: '请输入用户名和密码' });
      return false;
    }

    try {
      const result = await loginUser(normalized, password);
      localStorage.setItem('p2m-auth-token', result.access_token);
      const displayName = result.user.display_name || result.user.username;
      setCurrentUser(displayName);
      set({ currentUser: displayName, error: null });
      return true;
    } catch {
      // Backend failed — try IndexedDB fallback + auto-migrate
      const idbUser = await getUser(normalized);
      if (!idbUser) {
        set({ error: '用户不存在' });
        return false;
      }
      const hash = await hashPassword(password);
      if (idbUser.passwordHash !== hash) {
        set({ error: '密码错误' });
        return false;
      }

      try {
        const kvData = await getAllIDBKvData(normalized);
        const allUsers = await getAllIDBUsers();
        await migrateFromIDB(
          allUsers.map((u) => ({
            username: u.username,
            passwordHash: u.passwordHash,
            displayName: u.displayName,
          })),
          kvData,
        );
        const result = await loginUser(normalized, password);
        localStorage.setItem('p2m-auth-token', result.access_token);
        await clearIDBData();
        const displayName = result.user.display_name || result.user.username;
        setCurrentUser(displayName);
        set({ currentUser: displayName, error: null });
        return true;
      } catch {
        // Migration also failed — use IndexedDB directly
        const displayName = idbUser.displayName || idbUser.username;
        setCurrentUser(displayName);
        set({ currentUser: displayName, error: null });
        return true;
      }
    }
  },

  register: async (username, password) => {
    const trimmed = username.trim();
    const normalized = normalizeUsername(username);
    if (!normalized || !password) {
      set({ error: '请输入用户名和密码' });
      return false;
    }
    if (trimmed.length < 2) {
      set({ error: '用户名至少 2 个字符' });
      return false;
    }
    if (password.length < 4) {
      set({ error: '密码至少 4 个字符' });
      return false;
    }

    try {
      const result = await registerUser(trimmed, password);
      localStorage.setItem('p2m-auth-token', result.access_token);
      const displayName = result.user.display_name || result.user.username;
      setCurrentUser(displayName);
      set({ currentUser: displayName, error: null });
      return true;
    } catch {
      // Fallback: register in IndexedDB
      const existing = await getUser(normalized);
      if (existing) {
        set({ error: '用户名已存在，请直接登录' });
        return false;
      }
      const hash = await hashPassword(password);
      await addUser(trimmed, hash);
      setCurrentUser(trimmed);
      set({ currentUser: trimmed, error: null });
      return true;
    }
  },

  logout: () => {
    localStorage.removeItem('p2m-auth-token');
    setCurrentUser(null);
    set({ currentUser: null, error: null });
  },

  clearError: () => set({ error: null }),
}));
