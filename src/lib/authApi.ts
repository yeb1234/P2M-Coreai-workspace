import { API_BASE, resolveApiPath } from './apiBase';

/**
 * 会话说明
 * --------
 * 令牌放在 httpOnly Cookie 里，JS 读不到 —— 即使页面被注入脚本，
 * 也没法把会话带出去。这里只存一个「当前是谁」的数字 id，用于本地存储分区，
 * 它不是凭证，被看到也没有危害。
 */
export const SESSION_USER_KEY = 'p2m-auth-user-id';
const LEGACY_TOKEN_KEY = 'p2m-auth-token';

// 同源部署用 same-origin；跨域（VITE_API_BASE_URL 指向别的域名）必须 include
const CREDENTIAL_MODE: RequestCredentials = API_BASE ? 'include' : 'same-origin';

export function getSessionUserId(): string | null {
  try {
    return localStorage.getItem(SESSION_USER_KEY);
  } catch {
    return null;
  }
}

export function hasSession(): boolean {
  return !!getSessionUserId();
}

/** 历史名字保留：判断是否处于登录态。真正的凭证在 Cookie 里。 */
export function hasAuthToken(): boolean {
  return hasSession();
}

export function markSession(userId: number): void {
  // 新会话开始，重置 401 去重标记
  authExpiredHandled = false;
  try {
    localStorage.setItem(SESSION_USER_KEY, String(userId));
    // 升级前把令牌存在 localStorage 的，必须清掉：
    // 不改的话旧令牌还留在 JS 可读的地方，等于换了个位置继续暴露
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    /* 隐私模式写不进去，退化为不分区 */
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_USER_KEY);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

// 401 只处理一次。
//
// 为什么要这个 flag：登录后 useRehydrateStores 会并发重载 8 个 store，
// 每个都发一次 getUserData。如果 cookie 恰好失效，8 个请求同时 401，
// 原来每个都调 clearSession() + dispatch 事件 —— 变成 8 次连锁清理，
// 用户看到的是「突然被踢回登录页 + 一堆报错弹窗」。
//
// 现在只认第一次，后面的静默忽略。登录成功时重置。
let authExpiredHandled = false;

export async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(resolveApiPath(path), {
    ...init,
    credentials: CREDENTIAL_MODE,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  if (res.status === 401 && !authExpiredHandled) {
    authExpiredHandled = true;
    clearSession();
    window.dispatchEvent(new CustomEvent('p2m:auth-expired'));
  }
  return res;
}

/** 登录成功后调用，重置 401 去重标记。 */
export interface AuthUser {
  id: number;
  username: string;
  display_name: string | null;
  role?: string;
}

export interface AuthResult {
  access_token: string;
  user: AuthUser;
}

async function readAuthError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    return body?.error?.message || body?.detail || fallback;
  } catch {
    return fallback;
  }
}

export async function loginUser(username: string, password: string): Promise<AuthResult> {
  const res = await fetch(resolveApiPath('/api/auth/login'), {
    method: 'POST',
    credentials: CREDENTIAL_MODE,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    throw new Error(await readAuthError(res, '用户名或密码错误'));
  }
  const data = (await res.json()) as AuthResult;
  markSession(data.user.id);
  return data;
}

export async function registerUser(username: string, password: string): Promise<AuthResult> {
  const res = await fetch(resolveApiPath('/api/auth/register'), {
    method: 'POST',
    credentials: CREDENTIAL_MODE,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    throw new Error(await readAuthError(res, '注册失败'));
  }
  const data = (await res.json()) as AuthResult;
  markSession(data.user.id);
  return data;
}

export async function logoutUser(): Promise<void> {
  try {
    await fetch(resolveApiPath('/api/auth/logout'), {
      method: 'POST',
      credentials: CREDENTIAL_MODE,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    /* 网络失败也要清本地状态，否则用户会卡在假的登录态里 */
  }
  clearSession();
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<string> {
  const res = await authFetch('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
  if (!res.ok) {
    throw new Error(await readAuthError(res, '修改失败'));
  }
  const data = (await res.json()) as { message?: string };
  return data.message || '密码已更新';
}

export async function getMe(): Promise<AuthUser> {
  const res = await authFetch('/api/auth/me');
  if (!res.ok) throw new Error('not authenticated');
  return (await res.json()) as AuthUser;
}

export async function getUserData(storeKey: string): Promise<string | null> {
  const res = await authFetch(`/api/user-data/${encodeURIComponent(storeKey)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('failed to get user data');
  const data = (await res.json()) as { value: string };
  return data.value;
}

export async function setUserData(storeKey: string, value: string): Promise<void> {
  const res = await authFetch(`/api/user-data/${encodeURIComponent(storeKey)}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  });
  if (!res.ok) throw new Error('failed to set user data');
}

export async function deleteUserData(storeKey: string): Promise<void> {
  const res = await authFetch(`/api/user-data/${encodeURIComponent(storeKey)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('failed to delete user data');
}
