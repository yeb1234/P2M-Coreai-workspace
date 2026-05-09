import { create } from 'zustand';
import { addUser, getUser, hashPassword, normalizeUsername, restoreUser, setCurrentUser } from '../lib/idbStorage';

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

  init: () => {
    const user = restoreUser();
    set({ currentUser: user, initialized: true });
  },

  login: async (username, password) => {
    const normalized = normalizeUsername(username);
    if (!normalized || !password) {
      set({ error: '请输入用户名和密码' });
      return false;
    }

    const user = await getUser(normalized);
    if (!user) {
      set({ error: '用户不存在' });
      return false;
    }

    const hash = await hashPassword(password);
    if (user.passwordHash !== hash) {
      set({ error: '密码错误' });
      return false;
    }

    const displayName = user.displayName || user.username;
    setCurrentUser(displayName);
    set({ currentUser: displayName, error: null });
    return true;
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
  },

  logout: () => {
    setCurrentUser(null);
    set({ currentUser: null, error: null });
  },

  clearError: () => set({ error: null }),
}));
