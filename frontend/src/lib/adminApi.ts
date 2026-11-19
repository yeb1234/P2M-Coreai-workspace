import { apiFetch } from './videoApi';

export interface AdminUser {
  id: number;
  username: string;
  display_name: string | null;
  role: 'admin' | 'member';
  is_active: boolean;
  last_login_at: string | null;
  created_at: string | null;
  watch_events: number;
  learning_paths: number;
}

export function fetchUsers(): Promise<AdminUser[]> {
  return apiFetch<AdminUser[]>('/api/admin/users');
}

export function createUser(username: string, password: string): Promise<{ id: number; username: string }> {
  return apiFetch('/api/auth/create-user', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export function updateUser(
  userId: number,
  patch: { role?: 'admin' | 'member'; is_active?: boolean; display_name?: string }
): Promise<AdminUser> {
  return apiFetch<AdminUser>(`/api/admin/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function resetUserPassword(
  userId: number,
  newPassword: string
): Promise<{ ok: boolean; message: string }> {
  return apiFetch(`/api/admin/users/${userId}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ new_password: newPassword }),
  });
}

export function deleteUser(userId: number): Promise<{ ok: boolean; deleted_user_id: number }> {
  return apiFetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
}
