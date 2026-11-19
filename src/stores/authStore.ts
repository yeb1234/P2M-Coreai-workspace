import { create } from 'zustand';
import {
  SESSION_USER_KEY,
  clearSession,
  getMe,
  hasSession,
  loginUser,
  logoutUser,
  registerUser,
} from '../lib/authApi';
import { flushAllPending, setCurrentUser } from '../lib/idbStorage';
import { migrateLegacyUserScopedKeys, userScopedStorage } from '../lib/userScopedStorage';

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
    return userScopedStorage.getItem(ROLE_KEY) || 'member';
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
      // 旧版本的裸 key 归当前账号，避免首次升级时读不到自己的本地状态
      migrateLegacyUserScopedKeys();
      try {
        const user = await getMe();
        const displayName = user.display_name || user.username;
        setCurrentUser(displayName);
        userScopedStorage.setItem(ROLE_KEY, user.role || 'member');
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
      // 切换账号前，把旧账号遗留的裸 key 先归到旧账号名下。
      // 必须在 loginUser/markSession 之前执行，否则新用户会接手旧数据。
      migrateLegacyUserScopedKeys();
      const result = await loginUser(normalized, password);
      setCurrentUser(result.user.display_name || result.user.username);
      userScopedStorage.setItem(ROLE_KEY, result.user.role || 'member');
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
      // 注册新账号同样可能发生在旧账号的登录态里，先迁移旧数据再切分区。
      migrateLegacyUserScopedKeys();
      const result = await registerUser(trimmed, password);
      setCurrentUser(result.user.display_name || result.user.username);
      userScopedStorage.setItem(ROLE_KEY, result.user.role || 'member');
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
    // 清 Cookie 前把裸 key 归到当前账号，否则下一个账号会捡到上一手的数据
    migrateLegacyUserScopedKeys();
    await logoutUser();
    setCurrentUser(null);
    userScopedStorage.removeItem(ROLE_KEY);
    set({ currentUser: null, role: 'member', error: null, initialized: false });
    window.location.reload();
  },

  clearError: () => set({ error: null }),
}));

// 同浏览器多标签页：Cookie 是共享的，另一个标签登录 / 登出 / 会话失效后，
// 本标签如果继续渲染旧账号，后续写入会按新的 p2m-auth-user-id 落到错误分区。
// 这里监听跨标签的账号标记变化，直接重载，避免旧标签把数据写进新账号。
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === SESSION_USER_KEY && event.newValue !== event.oldValue) {
      window.location.reload();
    }
  });
}

// 任何请求收到 401 都会广播这个事件（会话过期、改密码、被停用）
if (typeof window !== 'undefined') {
  window.addEventListener('p2m:auth-expired', (event) => {
    const expiredUserId = (event as CustomEvent<{ userId?: string }>).detail?.userId;
    if (expiredUserId) migrateLegacyUserScopedKeys(expiredUserId);
    userScopedStorage.removeItem(ROLE_KEY);
    setCurrentUser(null);
    useAuthStore.setState({ currentUser: null, role: 'member', error: '登录已失效，请重新登录' });
  });
}
