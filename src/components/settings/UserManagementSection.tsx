import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, KeyRound, Plus, RefreshCw, Shield, Trash2, UserX, UserCheck } from 'lucide-react';
import {
  createUser,
  deleteUser,
  fetchUsers,
  resetUserPassword,
  updateUser,
  type AdminUser,
} from '../../lib/adminApi';
import { useAuthStore } from '../../stores';
import { SettingsButton, SettingsFieldLabel, SettingsHint, SettingsSectionTitle, SettingsTextInput } from './SettingsPrimitives';

function formatDate(value: string | null): string {
  if (!value) return '从未登录';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export const UserManagementSection: React.FC = () => {
  const currentUser = useAuthStore((s) => s.currentUser);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

  const [newName, setNewName] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setUsers(await fetchUsers());
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(''), 3000);
  };

  const handleCreate = async () => {
    setError('');
    if (!newName.trim()) return setError('请填写用户名');
    if (newPassword.length < 8) return setError('密码至少 8 位，且要同时包含字母和数字');
    try {
      await createUser(newName.trim(), newPassword);
      setNewName('');
      setNewPassword('');
      flash('账号已创建');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    }
  };

  const handleToggleActive = async (user: AdminUser) => {
    setBusyId(user.id);
    setError('');
    try {
      await updateUser(user.id, { is_active: !user.is_active });
      flash(user.is_active ? `已停用 ${user.username}` : `已启用 ${user.username}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleRole = async (user: AdminUser) => {
    setBusyId(user.id);
    setError('');
    try {
      await updateUser(user.id, { role: user.role === 'admin' ? 'member' : 'admin' });
      flash(user.role === 'admin' ? `${user.username} 已降为普通成员` : `${user.username} 已设为管理员`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusyId(null);
    }
  };

  const handleResetPassword = async (user: AdminUser) => {
    const next = window.prompt(`给 ${user.username} 设置新密码（至少 8 位，含字母和数字）`);
    if (!next) return;
    setBusyId(user.id);
    setError('');
    try {
      const res = await resetUserPassword(user.id, next);
      flash(res.message || '密码已重置');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '重置失败');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (user: AdminUser) => {
    const ok = window.confirm(
      `删除 ${user.username}？\n\n该账号的学习记录、笔记、路径会被一并删除，不可恢复。\n视频库与字幕不受影响。`
    );
    if (!ok) return;
    setBusyId(user.id);
    setError('');
    try {
      await deleteUser(user.id);
      flash(`已删除 ${user.username}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <SettingsSectionTitle>新建账号</SettingsSectionTitle>
        <SettingsHint>
          注册入口默认关闭，新用户由这里开通。登录密码在服务端以 PBKDF2 存储，创建后不可读取，只能重置。
        </SettingsHint>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-[160px] flex-1">
            <SettingsFieldLabel>用户名</SettingsFieldLabel>
            <SettingsTextInput
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="小写字母、数字、下划线"
            />
          </div>
          <div className="min-w-[180px] flex-1">
            <SettingsFieldLabel>初始密码</SettingsFieldLabel>
            <SettingsTextInput
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="至少 8 位，含字母和数字"
            />
          </div>
          <SettingsButton variant="primary" onClick={() => void handleCreate()} className="flex items-center gap-1.5">
            <Plus size={14} /> 创建
          </SettingsButton>
        </div>
      </div>

      {error && (
        <p className="flex items-start gap-1.5 text-xs text-[var(--danger)]">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
      {notice && <p className="text-xs text-[var(--success)]">{notice}</p>}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <SettingsSectionTitle>账号列表（{users.length}）</SettingsSectionTitle>
          <SettingsButton variant="ghost" onClick={() => void load()} className="flex items-center gap-1 text-xs">
            <RefreshCw size={13} /> 刷新
          </SettingsButton>
        </div>

        {loading ? (
          <p className="py-6 text-center text-xs text-[var(--text-muted)]">加载中…</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--border-light)]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
                <tr>
                  <th className="px-3 py-2 font-medium">账号</th>
                  <th className="px-3 py-2 font-medium">角色</th>
                  <th className="px-3 py-2 font-medium">状态</th>
                  <th className="px-3 py-2 font-medium">最近登录</th>
                  <th className="px-3 py-2 font-medium">数据</th>
                  <th className="px-3 py-2 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const isSelf = user.username === currentUser || user.display_name === currentUser;
                  const busy = busyId === user.id;
                  return (
                    <tr key={user.id} className="border-t border-[#f0ede8]">
                      <td className="px-3 py-2">
                        <span className="font-medium text-[var(--text-primary)]">{user.username}</span>
                        {isSelf && <span className="ml-1.5 text-[10px] text-[var(--text-muted)]">(你)</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[10px] ${
                            user.role === 'admin'
                              ? 'border-[#f0dcc0] bg-[var(--bg-accent)] text-[var(--accent)]'
                              : 'border-[var(--border-light)] bg-[var(--bg-base)] text-[var(--text-secondary)]'
                          }`}
                        >
                          {user.role === 'admin' ? '管理员' : '成员'}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={user.is_active ? 'text-[var(--success)]' : 'text-[var(--danger)]'}>
                          {user.is_active ? '启用' : '已停用'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[var(--text-secondary)]">{formatDate(user.last_login_at)}</td>
                      <td className="px-3 py-2 text-[var(--text-muted)]">
                        {user.watch_events} 条观看 / {user.learning_paths} 条路径
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            disabled={busy || isSelf}
                            onClick={() => void handleToggleRole(user)}
                            title={user.role === 'admin' ? '降为成员' : '设为管理员'}
                            className="rounded p-1 text-[var(--text-secondary)] transition hover:bg-[var(--bg-base)] hover:text-[var(--accent)] disabled:opacity-30"
                          >
                            <Shield size={13} />
                          </button>
                          <button
                            type="button"
                            disabled={busy || isSelf}
                            onClick={() => void handleToggleActive(user)}
                            title={user.is_active ? '停用' : '启用'}
                            className="rounded p-1 text-[var(--text-secondary)] transition hover:bg-[var(--bg-base)] hover:text-[var(--accent)] disabled:opacity-30"
                          >
                            {user.is_active ? <UserX size={13} /> : <UserCheck size={13} />}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleResetPassword(user)}
                            title="重置密码"
                            className="rounded p-1 text-[var(--text-secondary)] transition hover:bg-[var(--bg-base)] hover:text-[var(--info)] disabled:opacity-30"
                          >
                            <KeyRound size={13} />
                          </button>
                          <button
                            type="button"
                            disabled={busy || isSelf}
                            onClick={() => void handleDelete(user)}
                            title="删除账号"
                            className="rounded p-1 text-[var(--text-secondary)] transition hover:bg-[#fdf2f2] hover:text-[var(--danger)] disabled:opacity-30"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <SettingsHint>
          停用或重置密码会立即使该用户已签发的登录凭证失效；管理员不能停用、降级或删除自己，
          系统也始终保留至少一个启用的管理员。
        </SettingsHint>
      </div>
    </div>
  );
};
