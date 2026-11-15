import { create } from 'zustand';
import {
  clearSession,
  getMe,
  hasSession,
  loginUser,
  logoutUser,
  registerUser,
} from '../lib/authApi';
import { flushAllPending, setCurrentUser } from '../lib/idbStorage';

interface AuthState {
  currentUser: string | null;
  /** 仅用于界面显示（是否露出管理入口）。权限判断始终在服务端。 */
  role: string;
  initialized: boolean;
  error: string | null;
  init: () => Promise<void>;
  login: (username: string, password: string) => Promise<boolean>;
  register: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  clearError: () => void;
}

const ROLE_KEY = 'p2m-role';

function readRole(): string {
  try {
    return localStorage.getItem(ROLE_KEY) || 'member';
  } catch {
    return 'member';
  }
}

export const useAuthStore = create<AuthState>()((set) => ({
  currentUser: null,
  role: readRole(),
  initialized: false,
  error: null,

  init: async () => {
    // 只有本地有会话标记时才去问后端，避免每次打开都打一次 /me
    if (hasSession()) {
      try {
        const user = await getMe();
        const displayName = user.display_name || user.username;
        setCurrentUser(displayName);
        try {
          localStorage.setItem(ROLE_KEY, user.role || 'member');
        } catch {
          /* 隐私模式 */
        }
        set({ currentUser: displayName, role: user.role || 'member', initialized: true });
        return;
      } catch {
        // 会话已失效（过期 / 改密码 / 被停用）
        clearSession();
      }
    }
    setCurrentUser(null);
    set({ currentUser: null, role: 'member', initialized: true });
  },

  login: async (username, password) => {
    const normalized = username.trim().toLowerCase();
    if (!normalized || !password) {
      set({ error: '请输入用户名和密码' });
      return false;
    }
    try {
      const result = await loginUser(normalized, password);
      setCurrentUser(result.user.display_name || result.user.username);
      try {
        localStorage.setItem(ROLE_KEY, result.user.role || 'member');
      } catch {
        /* ignore */
      }
      // 必须整页重载：笔记、待办、番茄钟等 9 个 store 的内存状态都是上一个
      // 账号的，只换 authStore 的字段会留下一大堆脏数据。
      // 重载后 store 会按新的用户作用域重新水合。
      window.location.reload();
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : '登录失败，请稍后再试' });
      return false;
    }
  },

  register: async (username, password) => {
    const trimmed = username.trim();
    if (!trimmed || !password) {
      set({ error: '请输入用户名和密码' });
      return false;
    }
    if (trimmed.length < 2) {
      set({ error: '用户名至少 2 个字符' });
      return false;
    }
    if (password.length < 8) {
      set({ error: '密码至少 8 位，且要同时包含字母和数字' });
      return false;
    }
    try {
      const result = await registerUser(trimmed, password);
      setCurrentUser(result.user.display_name || result.user.username);
      try {
        localStorage.setItem(ROLE_KEY, result.user.role || 'member');
      } catch {
        /* ignore */
      }
      window.location.reload();
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : '注册失败，请稍后再试' });
      return false;
    }
  },

  logout: async () => {
    // 先把 debounce 队列里的编辑落盘（此时会话还有效），再清 Cookie。
    // 顺序反了的话，最后 3 秒内的改动会被当成离线数据写进 IndexedDB。
    try {
      await flushAllPending();
    } catch {
      /* 落盘失败不阻塞登出 */
    }
    await logoutUser();
    setCurrentUser(null);
    try {
      localStorage.removeItem(ROLE_KEY);
    } catch {
      /* ignore */
    }
    set({ currentUser: null, role: 'member', error: null, initialized: false });
    window.location.reload();
  },

  clearError: () => set({ error: null }),
}));

// 任何请求收到 401 都会广播这个事件（会话过期、改密码、被停用）
if (typeof window !== 'undefined') {
  window.addEventListener('p2m:auth-expired', () => {
    setCurrentUser(null);
    useAuthStore.setState({ currentUser: null, role: 'member', error: '登录已失效，请重新登录' });
  });
}
