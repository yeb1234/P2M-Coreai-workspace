import React, { useState } from 'react';
import { LogIn, UserPlus, Loader2 } from 'lucide-react';
import { useAuthStore } from '../../stores';
import { playInteractionSound } from '../../lib/sounds';

// 只记住用户名。早期版本把明文密码也塞进 localStorage 实现「记住密码」——
// 那是把口令写在硬盘上，任何 XSS 或共享电脑都能直接读走。
// 密码交给浏览器自带的凭据管理器（下面的 autoComplete 属性），
// 它加密存储且与系统钥匙串绑定，比自建方案安全得多。
const REMEMBER_KEY = 'p2m-remember-username';

function loadRememberedUsername(): string {
  try {
    return localStorage.getItem(REMEMBER_KEY) || '';
  } catch {
    return '';
  }
}

export const AuthPage: React.FC = () => {
  const rememberedName = loadRememberedUsername();
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState(rememberedName);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(!!rememberedName);
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
    setIsRegister((v) => !v);
    clearError();
    setConfirm('');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#f5f0e8] via-[#e8dfd2] to-[#d4c8b0] p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-[#3d2b1f] tracking-wide">灵境</h1>
          <p className="text-sm text-[#8b7355] mt-1">CoreAI 个人工作站</p>
        </div>

        {/* Card */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-[#e5e2dd] p-6">
          <h2 className="text-lg font-semibold text-[#1a1a1a] mb-4 flex items-center gap-2">
            {isRegister ? <UserPlus size={18} /> : <LogIn size={18} />}
            {isRegister ? '注册账号' : '登录'}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-[#6b7280] mb-1">用户名</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2.5 bg-[#faf9f7] border border-[#e5e2dd] rounded-lg text-sm outline-none focus:border-[#c87d2f] focus:ring-2 focus:ring-[#c87d2f]/10 transition-colors"
                placeholder="输入用户名"
                autoFocus
                autoComplete="username"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#6b7280] mb-1">密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 bg-[#faf9f7] border border-[#e5e2dd] rounded-lg text-sm outline-none focus:border-[#c87d2f] focus:ring-2 focus:ring-[#c87d2f]/10 transition-colors"
                placeholder={isRegister ? '至少 8 位，含字母和数字' : '输入密码'}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
              />
            </div>

            {isRegister && (
              <div>
                <label className="block text-xs font-medium text-[#6b7280] mb-1">确认密码</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full px-3 py-2.5 bg-[#faf9f7] border border-[#e5e2dd] rounded-lg text-sm outline-none focus:border-[#c87d2f] focus:ring-2 focus:ring-[#c87d2f]/10 transition-colors"
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
                  className="w-3.5 h-3.5 rounded border-[#d1cdc6] text-[#c87d2f] focus:ring-[#c87d2f]/20"
                />
                <span className="text-xs text-[#6b7280]">记住密码</span>
              </label>
            )}

            {error && (
              <p className="text-xs text-[#dc3545] bg-[#dc3545]/5 px-3 py-2 rounded-lg">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-white bg-[#c87d2f] rounded-lg hover:bg-[#b06d20] disabled:opacity-50 transition-colors"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : isRegister ? <UserPlus size={16} /> : <LogIn size={16} />}
              {isRegister ? '注册' : '登录'}
            </button>
          </form>

          <div className="mt-4 text-center">
            <button
              onClick={toggleMode}
              className="text-xs text-[#8b7355] hover:text-[#c87d2f] transition-colors"
            >
              {isRegister ? '已有账号？去登录' : '没有账号？去注册'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
