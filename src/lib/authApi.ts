const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('p2m-auth-token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...init?.headers,
    },
  });
  if (res.status === 401) {
    localStorage.removeItem('p2m-auth-token');
  }
  return res;
}

export async function loginUser(username: string, password: string) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error('login failed');
  return res.json() as Promise<{ access_token: string; user: { id: number; username: string; display_name: string | null } }>;
}

export async function registerUser(username: string, password: string) {
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error('register failed');
  return res.json() as Promise<{ access_token: string; user: { id: number; username: string; display_name: string | null } }>;
}

export async function getMe() {
  const res = await authFetch('/api/auth/me');
  if (!res.ok) throw new Error('not authenticated');
  return res.json() as Promise<{ id: number; username: string; display_name: string | null }>;
}

export async function migrateFromIDB(users: { username: string; passwordHash: string; displayName?: string }[], kvData: Record<string, string>) {
  const res = await fetch(`${API_BASE}/api/auth/migrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ users, kv_data: kvData }),
  });
  if (!res.ok) throw new Error('migration failed');
  return res.json() as Promise<{ migrated_users: number; kv_imported: number }>;
}

export async function getUserData(storeKey: string): Promise<string | null> {
  const res = await authFetch(`/api/user-data/${encodeURIComponent(storeKey)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('failed to get user data');
  const data = await res.json() as { value: string };
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
