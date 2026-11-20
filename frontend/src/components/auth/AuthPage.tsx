import React, { useState } from 'react';
import { LogIn, UserPlus, Loader2, Sparkles } from 'lucide-react';
import { useAuthStore } from '../../stores';
import { playInteractionSound } from '../../lib/sounds';
import { DEMO_CREDENTIALS, IS_DEMO } from '../../lib/demoMode';

// 只记住用户名。早期版本把明文密码也塞进 localStorage 实现「记住密码」——
// 那是把口令写在硬盘上，任何 XSS 或共享电脑都能直接读走。
// 密码交给浏览器自带的凭据管理器（下面的 autoComplete 属性），
// 它加密存储且与系统钥匙串绑定，比自建方案安全得多。
const REMEMBER_KEY = 'p2m-remember-username';

function loadRememberedUsername(): string {
  try {
    // 旧版本把 { username, password } 明文存在 p2m-remember 里；
    // 发现即清除，绝不让它继续留在共享浏览器中。
    localStorage.removeItem('p2m-remember');
    localStorage.removeItem('p2m-password');
    localStorage.removeItem('p2m-auth-token');

    const legacyLastUsername = localStorage.getItem('p2m-last-username');
    if (legacyLastUsername && !localStorage.getItem(REMEMBER_KEY)) {
      localStorage.setItem(REMEMBER_KEY, legacyLastUsername);
      localStorage.removeItem('p2m-last-username');
    }
    return localStorage.getItem(REMEMBER_KEY) || '';
  } catch {
    return '';
  }
}

export const AuthPage: React.FC = () => {
  const rememberedName = loadRememberedUsername();
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState(DEMO_CREDENTIALS?.username || rememberedName);
  const [password, setPassword] = useState(DEMO_CREDENTIALS?.password || '');
  const [remember, setRemember] = useState(!!(DEMO_CREDENTIALS?.username || rememberedName));
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  const { login, register, error, clearError } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    if (isRegister && password !== confirm) {
      useAuthStore.setState({ error: '两次密码不一致' });
      return;
    }
    setLoading(true);
    const fn = isRegister ? register : login;
    const ok = await fn(username, password);
    playInteractionSound(ok ? 'success' : 'error');
    // 只存用户名，绝不存密码
    if (ok && remember) {
      localStorage.setItem(REMEMBER_KEY, username);
    } else if (ok && !remember) {
      localStorage.removeItem(REMEMBER_KEY);
    }
    setLoading(false);
  };

  const toggleMode = () => {
    setIsRegister((v) => {
      const next = !v;
      clearError();
      setConfirm('');
      if (next) {
        setPassword('');
      } else if (DEMO_CREDENTIALS) {
        setUsername(DEMO_CREDENTIALS.username);
        setPassword(DEMO_CREDENTIALS.password);
      }
      return next;
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#f5f0e8] via-[#e8dfd2] to-[#d4c8b0] p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-[#3d2b1f] tracking-wide">灵境</h1>
          <p className="text-sm text-[#8b7355] mt-1">
            {IS_DEMO ? 'P2 Lite 演示环境' : 'CoreAI 个人工作站'}
          </p>
        </div>

        {/* Card */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-[var(--border-light)] p-6">
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
            {isRegister ? <UserPlus size={18} /> : <LogIn size={18} />}
            {isRegister ? '注册账号' : '登录'}
          </h2>

          {IS_DEMO && !isRegister && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-[var(--accent)]/25 bg-[var(--accent-bg)] px-3 py-2">
              <Sparkles size={14} className="mt-0.5 shrink-0 text-[var(--accent)]" />
              <div>
                <p className="text-xs font-medium text-[var(--text-primary)]">演示账号已填充</p>
                <p className="mt-0.5 text-[11px] leading-4 text-[var(--text-secondary)]">
                  {DEMO_CREDENTIALS && `账号 ${DEMO_CREDENTIALS.username} · 密码 ${DEMO_CREDENTIALS.password}`}
                </p>
                <p className="mt-0.5 text-[11px] leading-4 text-[var(--text-secondary)]">
                  直接点「登录」进入，演示数据可随意操作
                </p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label htmlFor="auth-username" className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">用户名</label>
              <input
                id="auth-username"
                type="text"
                value={username}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'auth-error' : undefined}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2.5 bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-lg text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/10 transition-colors"
                placeholder="输入用户名"
                autoFocus
                autoComplete="username"
              />
            </div>

            <div>
              <label htmlFor="auth-password" className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">密码</label>
              <input
                id="auth-password"
                type="password"
                value={password}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'auth-error' : undefined}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-lg text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/10 transition-colors"
                placeholder={isRegister ? '至少 8 位，含字母和数字' : '输入密码'}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
              />
            </div>

            {isRegister && (
              <div>
                <label htmlFor="auth-confirm" className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">确认密码</label>
                <input
                  id="auth-confirm"
                  type="password"
                  value={confirm}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? 'auth-error' : undefined}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full px-3 py-2.5 bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-lg text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/10 transition-colors"
                  placeholder="再次输入密码"
                  autoComplete="new-password"
                />
              </div>
            )}

            {!isRegister && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-[var(--border-medium)] text-[var(--accent)] focus:ring-[var(--accent)]/20"
                />
                <span className="text-xs text-[var(--text-secondary)]">记住账号</span>
              </label>
            )}

            {/* role="alert" 让读屏软件在错误出现时立刻播报，
                而不是等用户 Tab 到下一个元素才听到。
                id 供上面三个输入框的 aria-describedby 引用。 */}
            {error && (
              <p
                id="auth-error"
                role="alert"
                className="rounded-lg bg-[var(--danger-bg)] px-3 py-2 text-xs text-[var(--danger)]"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-white bg-[var(--accent)] rounded-lg hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : isRegister ? <UserPlus size={16} /> : <LogIn size={16} />}
              {isRegister ? '注册' : '登录'}
            </button>
          </form>

          <div className="mt-4 text-center">
            {IS_DEMO ? (
              <p className="text-[11px] text-[var(--text-muted)]">演示环境不开放注册</p>
            ) : (
              <button
                onClick={toggleMode}
                className="text-xs text-[#8b7355] hover:text-[var(--accent)] transition-colors"
              >
                {isRegister ? '已有账号？去登录' : '没有账号？去注册'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
