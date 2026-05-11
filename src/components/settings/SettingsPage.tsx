import React, { useState, useRef } from 'react';
import { useEffect } from 'react';
import { CheckCircle2, Settings, Timer, User, Bell, Palette, Shield, Database, Bot, Save, Download, Upload, AlertTriangle, XCircle, RefreshCw } from 'lucide-react';
import { PageTitle, ConfirmDialog } from '../shared';
import { usePomodoroStore, useUIStore, useNotificationStore, useTodoStore, useNotesStore, useCalendarStore, useAuthStore } from '../../stores';
import { getUser, hashPassword, idbStorage, upsertUser } from '../../lib/idbStorage';
import { fetchBackendHealth, type BackendHealthOut } from '../../lib/videoApi';
import { THEME_PRESETS, applyTheme, generateThemeCss, type ThemeVars } from '../../lib/themes';
import type { PomodoroConfig } from '../../types';
import { STORAGE_KEYS } from './types';
import { AISettings } from './AISettingsSection';
import { TranscriptionSettings } from './TranscriptionSettingsSection';
import { playInteractionSound } from '../../lib/sounds';

const SECTIONS = [
  { id: 'pomodoro', label: '番茄钟', icon: <Timer size={16} /> },
  { id: 'profile', label: '个人信息', icon: <User size={16} /> },
  { id: 'notifications', label: '通知', icon: <Bell size={16} /> },
  { id: 'appearance', label: '外观', icon: <Palette size={16} /> },
  { id: 'ai', label: '灵境小助手', icon: <Bot size={16} /> },
  { id: 'transcription', label: '转写设置', icon: <Database size={16} /> },
  { id: 'backend', label: '后端状态', icon: <CheckCircle2 size={16} /> },
  { id: 'privacy', label: '隐私', icon: <Shield size={16} /> },
  { id: 'data', label: '数据', icon: <Database size={16} /> },
] as const;

type SectionId = typeof SECTIONS[number]['id'];

/* ─── Pomodoro ─── */
function PomodoroSettings() {
  const config = usePomodoroStore((s) => s.config);
  const updateConfig = usePomodoroStore((s) => s.updateConfig);
  const clearHistory = usePomodoroStore((s) => s.clearHistory);
  const sessions = usePomodoroStore((s) => s.sessions);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({ ...config });

  const handleSave = () => {
    updateConfig(form);
    playInteractionSound('save');
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const sessionCount = Object.values(sessions).filter((s) => s.completed).length;
  const numberFields: Array<{ key: keyof Pick<PomodoroConfig, 'workDuration' | 'shortBreakDuration' | 'longBreakDuration' | 'longBreakInterval' | 'dailyGoal'>; label: string; min: number; max: number }> = [
    { key: 'workDuration', label: '专注时长（分钟）', min: 1, max: 120 },
    { key: 'shortBreakDuration', label: '短休息（分钟）', min: 1, max: 30 },
    { key: 'longBreakDuration', label: '长休息（分钟）', min: 1, max: 60 },
    { key: 'longBreakInterval', label: '长休息间隔（番茄数）', min: 1, max: 10 },
    { key: 'dailyGoal', label: '每日目标（番茄数）', min: 1, max: 20 },
  ];

  return (
    <div className="space-y-6">
      <div className="auto-grid-panels">
        {numberFields.map(({ key, label, min, max }) => (
          <div key={key}>
            <label className="block text-xs font-medium text-[#6b7280] mb-1.5">{label}</label>
            <input
              type="number"
              min={min}
              max={max}
              value={form[key]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: Number(e.target.value) }))}
              className="w-full px-3 py-2 bg-[#faf9f7] border border-[#e5e2dd] rounded-lg text-sm outline-none focus:border-[#c87d2f] focus:ring-2 focus:ring-[#c87d2f]/10"
            />
          </div>
        ))}
      </div>
      <div>
        <label className="block text-xs font-medium text-[#6b7280] mb-2">背景音模式</label>
        <div className="auto-grid-compact">
          {[
            { value: 'manual' as const, label: '手动', desc: '背景音由番茄钟面板手动开关。' },
            { value: 'focus' as const, label: '专注', desc: '只在专注阶段计时时自动播放。' },
          ].map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setForm((f) => ({ ...f, ambientPlaybackMode: item.value }))}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                (form.ambientPlaybackMode ?? 'manual') === item.value
                  ? 'border-[#c87d2f] bg-[#fff7ed] text-[#9a5a1e]'
                  : 'border-[#e5e2dd] bg-[#faf9f7] text-[#5f5a52] hover:border-[#c87d2f]/50'
              }`}
            >
              <p className="text-sm font-medium">{item.label}</p>
              <p className="mt-1 text-[10px] leading-4">{item.desc}</p>
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={handleSave} className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-[#c87d2f] rounded-lg hover:bg-[#b06d24] transition-colors">
          <Save size={14} /> 保存设置
        </button>
        {saved && <span className="text-xs text-[#16a34a]">已保存</span>}
      </div>
      <div className="border-t border-[#e5e2dd] pt-4">
        <h4 className="text-sm font-medium text-[#1a1a1a] mb-2">历史数据</h4>
        <p className="text-xs text-[#9ca3af] mb-3">共 {sessionCount} 个已完成的番茄记录</p>
        <button onClick={() => { if (window.confirm('确定清除所有番茄历史记录？此操作不可撤销。')) { clearHistory(); playInteractionSound('delete'); } }} className="theme-danger-button px-3 py-1.5 text-xs rounded-lg transition-colors">
          清除历史记录
        </button>
      </div>
    </div>
  );
}

/* ─── Profile ─── */
function ProfileSettings() {
  const displayName = useUIStore((s) => s.displayName);
  const setDisplayName = useUIStore((s) => s.setDisplayName);
  const currentUser = useAuthStore((s) => s.currentUser);
  const [name, setName] = useState(displayName);
  const [saved, setSaved] = useState(false);
  const [pwOld, setPwOld] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  const [pwError, setPwError] = useState(false);

  const handleSave = () => {
    setDisplayName(name.trim());
    playInteractionSound('save');
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleChangePassword = async () => {
    setPwMsg('');
    setPwError(false);
    if (!pwOld || !pwNew) { setPwMsg('请填写所有字段'); setPwError(true); return; }
    if (pwNew.length < 4) { setPwMsg('新密码至少4个字符'); setPwError(true); return; }
    if (pwNew !== pwConfirm) { setPwMsg('两次密码不一致'); setPwError(true); return; }
    const oldHash = await hashPassword(pwOld);
    const user = await getUser(currentUser!);
    if (!user || user.passwordHash !== oldHash) { setPwMsg('原密码错误'); setPwError(true); return; }
    const newHash = await hashPassword(pwNew);
    await upsertUser(currentUser!, newHash);
    playInteractionSound('success');
    setPwMsg('密码已修改');
    setPwError(false);
    setPwOld(''); setPwNew(''); setPwConfirm('');
  };

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-xs font-medium text-[#6b7280] mb-1.5">昵称</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="输入你的昵称"
          className="w-full px-3 py-2 bg-[#faf9f7] border border-[#e5e2dd] rounded-lg text-sm outline-none focus:border-[#c87d2f] focus:ring-2 focus:ring-[#c87d2f]/10"
        />
        <p className="text-[10px] text-[#b8b4ac] mt-1">将显示在侧边栏和工作台中</p>
      </div>
      <div>
        <label className="block text-xs font-medium text-[#6b7280] mb-1.5">语言</label>
        <div className="px-3 py-2 bg-[#f3f2ef] border border-[#e5e2dd] rounded-lg text-sm text-[#6b7280]">简体中文（内置）</div>
      </div>
      <div>
        <label className="block text-xs font-medium text-[#6b7280] mb-1.5">一周起始日</label>
        <div className="px-3 py-2 bg-[#f3f2ef] border border-[#e5e2dd] rounded-lg text-sm text-[#6b7280]">星期一（内置）</div>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={handleSave} className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-[#c87d2f] rounded-lg hover:bg-[#b06d24] transition-colors">
          <Save size={14} /> 保存设置
        </button>
        {saved && <span className="text-xs text-[#16a34a]">已保存</span>}
      </div>

      {/* Change password */}
      <div className="pt-4 border-t border-[#e5e2dd]">
        <h3 className="text-sm font-medium text-[#1a1a1a] mb-3">修改密码</h3>
        <div className="space-y-2">
          <input type="password" value={pwOld} onChange={(e) => setPwOld(e.target.value)} placeholder="原密码" className="w-full px-3 py-2 bg-[#faf9f7] border border-[#e5e2dd] rounded-lg text-sm outline-none focus:border-[#c87d2f]" />
          <input type="password" value={pwNew} onChange={(e) => setPwNew(e.target.value)} placeholder="新密码" className="w-full px-3 py-2 bg-[#faf9f7] border border-[#e5e2dd] rounded-lg text-sm outline-none focus:border-[#c87d2f]" />
          <input type="password" value={pwConfirm} onChange={(e) => setPwConfirm(e.target.value)} placeholder="确认新密码" className="w-full px-3 py-2 bg-[#faf9f7] border border-[#e5e2dd] rounded-lg text-sm outline-none focus:border-[#c87d2f]" />
        </div>
        <button onClick={handleChangePassword} className="mt-3 px-4 py-2 text-sm font-medium text-white bg-[#6b7280] rounded-lg hover:bg-[#4b5563] transition-colors">
          修改密码
        </button>
        {pwMsg && <p className={`mt-2 text-xs ${pwError ? 'text-[#dc3545]' : 'text-[#16a34a]'}`}>{pwMsg}</p>}
      </div>
    </div>
  );
}

/* ─── Notifications ─── */
function NotificationSettings() {
  const settings = useNotificationStore((s) => s.settings);
  const updateSettings = useNotificationStore((s) => s.updateSettings);
  const [draft, setDraft] = useState({ ...settings });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft({ ...settings });
  }, [settings]);

  const handleToggle = (key: keyof typeof settings) => {
    setDraft((current) => ({ ...current, [key]: !current[key] }));
  };

  const handleSave = () => {
    updateSettings(draft);
    playInteractionSound('save');
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const toggles: { key: keyof typeof settings; label: string; desc: string }[] = [
    { key: 'enablePomodoroNotif', label: '番茄钟通知', desc: '完成番茄钟时显示通知' },
    { key: 'enableTodoNotif', label: '待办通知', desc: '待办到期和提醒通知' },
    { key: 'enableSystemNotif', label: '系统通知', desc: '系统消息和更新提示' },
    { key: 'soundEnabled', label: '提示音', desc: '番茄钟完成时播放提示音' },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#6b7280]">管理各类通知的开关和提示音设置。</p>
      {toggles.map(({ key, label, desc }) => (
        <div key={key} className="flex items-center justify-between py-3 border-b border-[#e5e2dd] last:border-0">
          <div>
            <p className="text-sm font-medium text-[#1a1a1a]">{label}</p>
            <p className="text-xs text-[#9ca3af]">{desc}</p>
          </div>
          <button
            onClick={() => handleToggle(key)}
            className={`relative w-10 h-5 rounded-full transition-colors ${
              draft[key] ? 'bg-[#c87d2f]' : 'bg-[#d1cdc6]'
            }`}
          >
            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
              draft[key] ? 'left-[22px]' : 'left-0.5'
            }`} />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-3">
        <button onClick={handleSave} className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-[#c87d2f] rounded-lg hover:bg-[#b06d24] transition-colors">
          <Save size={14} /> 保存设置
        </button>
        {saved && <span className="text-xs text-[#16a34a]">已保存</span>}
      </div>
    </div>
  );
}

/* ─── Appearance ─── */
function AppearanceSettings() {
  const themeId = useUIStore((s) => s.themeId);
  const setTheme = useUIStore((s) => s.setTheme);
  const setCustomTheme = useUIStore((s) => s.setCustomTheme);
  const importRef = useRef<HTMLInputElement>(null);
  const builtInThemeIds = new Set(['warm-wood', 'morning', 'corporate', 'meadow', 'lavender', 'night']);
  const themeGroups = [
    { title: '主题风格', items: THEME_PRESETS.filter((theme) => builtInThemeIds.has(theme.id)) },
    { title: '自定义风格', items: THEME_PRESETS.filter((theme) => !builtInThemeIds.has(theme.id)) },
  ];

  const renderThemeButton = (t: (typeof THEME_PRESETS)[number]) => (
    <button
      key={t.id}
      onClick={() => {
        setTheme(t.id);
        applyTheme(t.id, t.vars);
      }}
      className={`relative px-3 py-3 rounded-lg text-left border transition-all ${
        themeId === t.id
          ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]/20'
          : 'border-[#e5e2dd] hover:border-[#d1cdc6]'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <div className="w-3 h-3 rounded-full" style={{ background: t.vars['--accent'] }} />
        <span className="text-xs font-medium text-[#1a1a1a]">{t.name}</span>
      </div>
      <p className="text-[10px] text-[#9ca3af]">{t.description}</p>
    </button>
  );

  const handleExportTheme = () => {
    const preset = THEME_PRESETS.find((t) => t.id === themeId);
    const vars = preset?.vars || THEME_PRESETS[0].vars;
    const blob = new Blob([generateThemeCss(themeId, vars)], { type: 'text/css;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `p2m-theme-${themeId}.css`;
    a.click();
    URL.revokeObjectURL(url);
    playInteractionSound('success');
  };

  const handleImportTheme = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? '');
        let vars: Partial<ThemeVars>;
        if (file.name.toLowerCase().endsWith('.css') || text.includes(':root')) {
          vars = {};
          const matches = text.matchAll(/(--[a-z-]+)\s*:\s*([^;]+);/g);
          for (const match of matches) {
            vars[match[1] as keyof ThemeVars] = match[2].trim();
          }
        } else {
          vars = JSON.parse(text) as ThemeVars;
        }
        if (vars['--bg-body'] && vars['--accent']) {
          setCustomTheme(vars as ThemeVars);
          applyTheme('custom', vars as ThemeVars);
          playInteractionSound('success');
        }
      } catch { /* ignore invalid */ }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="space-y-6">
      {/* Theme selection */}
      <div>
        <label className="block text-xs font-medium text-[#6b7280] mb-3">主题风格</label>
        <div className="space-y-5">
          {themeGroups.map((group) => (
            <section key={group.title} className="space-y-2">
              <div className="flex items-center gap-2">
                <h4 className="text-xs font-semibold text-[#1a1a1a]">{group.title}</h4>
                <span className="text-[10px] text-[#9ca3af]">{group.items.length} 个</span>
              </div>
              <div className="auto-grid-cards">
                {group.items.map(renderThemeButton)}
              </div>
            </section>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-3">
          <button onClick={handleExportTheme} className="text-xs text-[#6b7280] hover:text-[#c87d2f] transition-colors flex items-center gap-1">
            <Download size={12} /> 导出 CSS 样式
          </button>
          <button onClick={() => importRef.current?.click()} className="text-xs text-[#6b7280] hover:text-[#c87d2f] transition-colors flex items-center gap-1">
            <Upload size={12} /> 导入主题
          </button>
          <input ref={importRef} type="file" accept=".css,.json" onChange={handleImportTheme} className="hidden" />
        </div>
      </div>

    </div>
  );
}

/* ─── Privacy ─── */
function PrivacySettings() {
  const clearAllNotifications = useNotificationStore((s) => s.clearAll);
  const [showWipeConfirm, setShowWipeConfirm] = useState(false);
  const [cleared, setCleared] = useState('');

  const handleClearNotifications = () => {
    clearAllNotifications();
    playInteractionSound('delete');
    setCleared('通知');
    setTimeout(() => setCleared(''), 2000);
  };

  const handleWipeAll = async () => {
    for (const key of STORAGE_KEYS) {
      await idbStorage.removeItem(key);
    }
    playInteractionSound('delete');
    setShowWipeConfirm(false);
    window.location.reload();
  };

  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-sm font-medium text-[#1a1a1a] mb-2">清除通知数据</h4>
        <p className="text-xs text-[#9ca3af] mb-3">删除所有通知记录，不影响其他数据。</p>
        <button onClick={handleClearNotifications} className="px-3 py-1.5 text-xs text-[#c87d2f] border border-[#c87d2f]/30 rounded-lg hover:bg-[#c87d2f]/5 transition-colors">
          清除通知
        </button>
        {cleared && <span className="ml-2 text-xs text-[#16a34a]">已清除{cleared}</span>}
      </div>
      <div className="border-t border-[#e5e2dd] pt-4">
        <div className="flex items-start gap-2 mb-3">
          <AlertTriangle size={16} className="text-[#dc3545] mt-0.5 flex-shrink-0" />
          <div>
            <h4 className="text-sm font-medium text-[#dc3545]">清除所有数据</h4>
            <p className="text-xs text-[#9ca3af]">将删除所有待办、笔记、日历、番茄记录等数据。此操作不可撤销。</p>
          </div>
        </div>
        <button onClick={() => setShowWipeConfirm(true)} className="theme-danger-button px-3 py-1.5 text-xs rounded-lg transition-colors">
          清除所有数据
        </button>
      </div>
      <ConfirmDialog
        isOpen={showWipeConfirm}
        onClose={() => setShowWipeConfirm(false)}
        onConfirm={handleWipeAll}
        title="清除所有数据"
        message="确定要删除所有数据吗？这将清除所有待办、笔记、日历事件、番茄记录等，且无法恢复。"
        confirmText="确认清除"
      />
    </div>
  );
}

function BackendHealthSettings() {
  const [health, setHealth] = useState<BackendHealthOut | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadHealth = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await fetchBackendHealth();
      setHealth(result);
      playInteractionSound(result.ok ? 'success' : 'error');
    } catch (err) {
      setError(err instanceof Error ? err.message : '后端健康检查失败');
      playInteractionSound('error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    queueMicrotask(() => {
      void loadHealth();
    });
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={() => void loadHealth()}
          disabled={loading}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-[#1a1a1a] rounded-lg hover:bg-[#2f2f2f] disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          检测后端状态
        </button>
        {health && (
          <span className={`text-xs ${health.ok ? 'text-[#16a34a]' : 'text-[#dc3545]'}`}>
            {health.ok ? '核心服务正常' : '存在需要处理的项目'}
          </span>
        )}
        {error && <span className="text-xs text-[#dc3545]">{error}</span>}
      </div>

      <div className="auto-grid-panels">
        {(health?.checks ?? []).map((check) => (
          <div key={check.name} className="rounded-xl border border-[#e5e2dd] bg-[#faf9f7] p-3">
            <div className="flex items-start gap-2">
              {check.ok ? <CheckCircle2 size={16} className="mt-0.5 text-[#16a34a]" /> : <XCircle size={16} className="mt-0.5 text-[#dc3545]" />}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[#1a1a1a]">{check.name}</p>
                <p className="mt-1 text-xs leading-5 text-[#6b7280]">{check.message}</p>
                {Object.keys(check.details || {}).length > 0 && (
                  <pre className="mt-2 max-h-24 overflow-auto rounded-lg bg-white px-2 py-1.5 text-[10px] leading-4 text-[#6b7280]">
                    {JSON.stringify(check.details, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Data ─── */
function DataSettings() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [exported, setExported] = useState(false);
  const [imported, setImported] = useState(false);

  const todos = useTodoStore((s) => s.todos);
  const notes = useNotesStore((s) => s.notes);
  const events = useCalendarStore((s) => s.events);
  const sessions = usePomodoroStore((s) => s.sessions);

  const stats: Record<string, number> = {
    待办: Object.values(todos).length,
    笔记: notes.length,
    日历事件: Object.keys(events).length,
    番茄记录: Object.keys(sessions).length,
  };

  const handleExport = async () => {
    const data: Record<string, unknown> = {};
    for (const key of STORAGE_KEYS) {
      const raw = await idbStorage.getItem(key);
      if (raw) {
        try { data[key] = JSON.parse(raw); } catch { data[key] = raw; }
      }
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `p2m-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    playInteractionSound('success');
    setExported(true);
    setTimeout(() => setExported(false), 2000);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result as string);
        for (const [key, value] of Object.entries(data)) {
          if (STORAGE_KEYS.includes(key)) {
            await idbStorage.setItem(key, JSON.stringify(value));
          }
        }
        playInteractionSound('success');
        setImported(true);
        setTimeout(() => { setImported(false); window.location.reload(); }, 1000);
      } catch {
        playInteractionSound('error');
        alert('导入失败：文件格式不正确');
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-sm font-medium text-[#1a1a1a] mb-3">数据概览</h4>
        <div className="auto-grid-compact">
          {Object.entries(stats).map(([label, count]) => (
            <div key={label} className="bg-[#faf9f7] border border-[#e5e2dd] rounded-lg p-3 text-center">
              <p className="text-lg font-bold text-[#c87d2f]">{count}</p>
              <p className="text-xs text-[#9ca3af]">{label}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-[#e5e2dd] pt-4">
        <h4 className="text-sm font-medium text-[#1a1a1a] mb-3">导出 / 导入</h4>
        <div className="flex flex-wrap gap-3">
          <button onClick={handleExport} className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-[#c87d2f] rounded-lg hover:bg-[#b06d24] transition-colors">
            <Download size={14} /> 导出数据
          </button>
          <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-[#c87d2f] border border-[#c87d2f]/30 rounded-lg hover:bg-[#fef7ed] transition-colors">
            <Upload size={14} /> 导入数据
          </button>
          <input ref={fileInputRef} type="file" accept=".json" onChange={handleImport} className="hidden" />
        </div>
        {exported && <p className="text-xs text-[#16a34a] mt-2">已导出</p>}
        {imported && <p className="text-xs text-[#16a34a] mt-2">导入成功，正在刷新...</p>}
      </div>
    </div>
  );
}

/* ─── Main ─── */
export const SettingsPage: React.FC = () => {
  const [activeSection, setActiveSection] = useState<SectionId>('pomodoro');

  const renderSection = () => {
    switch (activeSection) {
      case 'pomodoro':
        return <div><h3 className="text-sm font-semibold text-[#1a1a1a] mb-4">番茄钟设置</h3><PomodoroSettings /></div>;
      case 'profile':
        return <div><h3 className="text-sm font-semibold text-[#1a1a1a] mb-4">个人信息</h3><ProfileSettings /></div>;
      case 'notifications':
        return <div><h3 className="text-sm font-semibold text-[#1a1a1a] mb-4">通知设置</h3><NotificationSettings /></div>;
      case 'appearance':
        return <div><h3 className="text-sm font-semibold text-[#1a1a1a] mb-4">外观设置</h3><AppearanceSettings /></div>;
      case 'ai':
        return <div><h3 className="text-sm font-semibold text-[#1a1a1a] mb-4">灵境小助手</h3><AISettings /></div>;
      case 'transcription':
        return <div><h3 className="text-sm font-semibold text-[#1a1a1a] mb-4">转写设置</h3><TranscriptionSettings /></div>;
      case 'backend':
        return <div><h3 className="text-sm font-semibold text-[#1a1a1a] mb-4">后端健康状态</h3><BackendHealthSettings /></div>;
      case 'privacy':
        return <div><h3 className="text-sm font-semibold text-[#1a1a1a] mb-4">隐私设置</h3><PrivacySettings /></div>;
      case 'data':
        return <div><h3 className="text-sm font-semibold text-[#1a1a1a] mb-4">数据管理</h3><DataSettings /></div>;
    }
  };

  return (
    <div className="w-full pt-2 space-y-6">
      <PageTitle
        title="设置"
        subtitle="管理你的偏好和配置"
        icon={<Settings size={22} />}
      />
      <div className="flex flex-col md:flex-row gap-6">
        <div className="md:w-48 flex md:flex-col gap-1 overflow-x-auto md:overflow-x-visible">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm whitespace-nowrap transition-all ${
                activeSection === s.id
                  ? 'bg-[#fef7ed] text-[#c87d2f] font-medium'
                  : 'text-[#6b7280] hover:bg-[#f3f2ef] hover:text-[#1a1a1a]'
              }`}
            >
              {s.icon}
              <span>{s.label}</span>
            </button>
          ))}
        </div>
        <div className="flex-1 bg-[#faf9f7] border border-[#e5e2dd] rounded-xl p-5">
          {renderSection()}
        </div>
      </div>
    </div>
  );
};
