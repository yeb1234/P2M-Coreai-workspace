import React, { useState, useRef } from 'react';
import { useEffect } from 'react';
import { Settings, Timer, User, Bell, Palette, Shield, Database, Bot, Save, Download, Upload, AlertTriangle } from 'lucide-react';
import { PageTitle, ConfirmDialog } from '../shared';
import { usePomodoroStore, useUIStore, useNotificationStore, useTodoStore, useNotesStore, useCalendarStore, useAuthStore, useAIStore, useTranscriptionStore, WHISPER_MODELS, DEFAULT_TRANSCRIPTION_SETTINGS } from '../../stores';
import { getUser, hashPassword, idbStorage, upsertUser } from '../../lib/idbStorage';
import { clearActiveAiJobs } from '../../lib/videoApi';
import { THEME_PRESETS, applyTheme, generateThemeCss, type ThemeVars } from '../../lib/themes';
import { buildAIRequestSystemPrompt } from '../../stores/aiStore';
import type { PomodoroConfig } from '../../types';

const SECTIONS = [
  { id: 'pomodoro', label: '番茄钟', icon: <Timer size={16} /> },
  { id: 'profile', label: '个人信息', icon: <User size={16} /> },
  { id: 'notifications', label: '通知', icon: <Bell size={16} /> },
  { id: 'appearance', label: '外观', icon: <Palette size={16} /> },
  { id: 'ai', label: 'AI 助手', icon: <Bot size={16} /> },
  { id: 'transcription', label: '转写设置', icon: <Database size={16} /> },
  { id: 'privacy', label: '隐私', icon: <Shield size={16} /> },
  { id: 'data', label: '数据', icon: <Database size={16} /> },
] as const;

type SectionId = typeof SECTIONS[number]['id'];
type NumberDrafts = Record<'wordLimit' | 'cpuThreads' | 'beamSize' | 'bestOf' | 'temperature', string>;

const STORAGE_KEYS = [
  'p2m-ui-storage',
  'p2m-pomodoro-storage',
  'p2m-todo-storage',
  'p2m-calendar-storage',
  'p2m-notes-storage',
  'p2m-plugin-storage',
  'p2m-notification-storage',
];

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
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const sessionCount = Object.values(sessions).filter((s) => s.completed).length;
  const numberFields: Array<{ key: keyof PomodoroConfig; label: string; min: number; max: number }> = [
    { key: 'workDuration', label: '专注时长（分钟）', min: 1, max: 120 },
    { key: 'shortBreakDuration', label: '短休息（分钟）', min: 1, max: 30 },
    { key: 'longBreakDuration', label: '长休息（分钟）', min: 1, max: 60 },
    { key: 'longBreakInterval', label: '长休息间隔（番茄数）', min: 1, max: 10 },
    { key: 'dailyGoal', label: '每日目标（番茄数）', min: 1, max: 20 },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
      <div className="flex items-center gap-3">
        <button onClick={handleSave} className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-[#c87d2f] rounded-lg hover:bg-[#b06d24] transition-colors">
          <Save size={14} /> 保存设置
        </button>
        {saved && <span className="text-xs text-[#16a34a]">已保存</span>}
      </div>
      <div className="border-t border-[#e5e2dd] pt-4">
        <h4 className="text-sm font-medium text-[#1a1a1a] mb-2">历史数据</h4>
        <p className="text-xs text-[#9ca3af] mb-3">共 {sessionCount} 个已完成的番茄记录</p>
        <button onClick={() => { if (window.confirm('确定清除所有番茄历史记录？此操作不可撤销。')) clearHistory(); }} className="theme-danger-button px-3 py-1.5 text-xs rounded-lg transition-colors">
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
  const [saved, setSaved] = useState(false);

  const handleToggle = (key: keyof typeof settings) => {
    updateSettings({ [key]: !settings[key] });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
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
              settings[key] ? 'bg-[#c87d2f]' : 'bg-[#d1cdc6]'
            }`}
          >
            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
              settings[key] ? 'left-[22px]' : 'left-0.5'
            }`} />
          </button>
        </div>
      ))}
      {saved && <p className="text-xs text-[#16a34a]">设置已更新</p>}
    </div>
  );
}

/* ─── Appearance ─── */
function AppearanceSettings() {
  const themeId = useUIStore((s) => s.themeId);
  const setTheme = useUIStore((s) => s.setTheme);
  const setCustomTheme = useUIStore((s) => s.setCustomTheme);
  const importRef = useRef<HTMLInputElement>(null);

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
          applyTheme('custom', vars as ThemeVars);
          setCustomTheme(vars as ThemeVars);
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
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {THEME_PRESETS.map((t) => (
            <button
              key={t.id}
              onClick={() => { setTheme(t.id); applyTheme(t.id, t.vars); }}
              className={`relative px-3 py-3 rounded-lg text-left border transition-all ${
                themeId === t.id
                  ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]/20'
                  : 'border-[#e5e2dd] hover:border-[#d1cdc6]'
              }`}
              style={{ background: t.vars['--bg-card'], color: t.vars['--text-primary'] }}
            >
              <div className="flex items-center gap-2 mb-1">
                <div className="w-3 h-3 rounded-full" style={{ background: t.vars['--accent'] }} />
                <span className="text-xs font-medium" style={{ color: t.vars['--text-primary'] }}>{t.name}</span>
              </div>
              <p className="text-[10px]" style={{ color: t.vars['--text-muted'] }}>{t.description}</p>
            </button>
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
    setCleared('通知');
    setTimeout(() => setCleared(''), 2000);
  };

  const handleWipeAll = async () => {
    for (const key of STORAGE_KEYS) {
      await idbStorage.removeItem(key);
    }
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

/* ─── AI ─── */
function AISettings() {
  const endpoint = useAIStore((s) => s.endpoint);
  const model = useAIStore((s) => s.model);
  const systemPrompt = useAIStore((s) => s.systemPrompt);
  const promptTemplates = useAIStore((s) => s.promptTemplates);
  const activeTemplateId = useAIStore((s) => s.activeTemplateId);
  const setEndpoint = useAIStore((s) => s.setEndpoint);
  const setModel = useAIStore((s) => s.setModel);
  const setSystemPrompt = useAIStore((s) => s.setSystemPrompt);
  const [testInput, setTestInput] = useState('你好，简单回复一句，说明你已经连接成功。');
  const [testReply, setTestReply] = useState('');
  const [testError, setTestError] = useState('');
  const [testing, setTesting] = useState(false);

  const activeTemplate = promptTemplates.find((template) => template.id === activeTemplateId) ?? promptTemplates[0];

  const handleTestAI = async () => {
    const text = testInput.trim();
    if (!text || testing) return;
    setTesting(true);
    setTestReply('');
    setTestError('');

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: true,
          messages: [
            { role: 'system', content: buildAIRequestSystemPrompt(systemPrompt, activeTemplate?.content ?? '') },
            { role: 'user', content: text },
          ],
        }),
      });
      if (!res.ok) throw new Error(`接口返回 ${res.status}`);

      if (!res.body) {
        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content || data?.message?.content || '';
        setTestReply(content || '本地 AI 已返回，但没有可显示的文本。');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n');
        buffer = chunks.pop() ?? '';

        for (const chunk of chunks) {
          const line = chunk.trim();
          if (!line || line === 'data: [DONE]' || !line.startsWith('data:')) continue;
          try {
            const json = JSON.parse(line.slice(5).trim());
            const delta = json?.choices?.[0]?.delta?.content || json?.choices?.[0]?.message?.content || json?.message?.content || '';
            if (delta) {
              finalText += delta;
              setTestReply(finalText);
            }
          } catch {
            // ignore malformed stream chunks
          }
        }
      }

      if (!finalText.trim()) setTestReply('本地 AI 已返回，但没有可显示的文本。');
    } catch (err) {
      setTestError(err instanceof Error ? err.message : '测试请求失败，请检查 LM Studio 是否已启动。');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4">
        <div>
          <label className="block text-xs font-medium text-[#6b7280] mb-1.5">接口地址</label>
          <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} className="w-full px-3 py-2 bg-[#faf9f7] border border-[#e5e2dd] rounded-lg text-sm" />
          <p className="text-[10px] text-[#9ca3af] mt-1">LM Studio 默认可用地址：<code>http://127.0.0.1:1234/v1/chat/completions</code></p>
        </div>
        <div>
          <label className="block text-xs font-medium text-[#6b7280] mb-1.5">模型名</label>
          <input value={model} onChange={(e) => setModel(e.target.value)} className="w-full px-3 py-2 bg-[#faf9f7] border border-[#e5e2dd] rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-[#6b7280] mb-1.5">系统提示词</label>
          <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} className="w-full min-h-24 px-3 py-2 bg-[#faf9f7] border border-[#e5e2dd] rounded-lg text-sm resize-y" />
        </div>
      </div>

      <div className="border-t border-[#e5e2dd] pt-4">
        <h4 className="text-sm font-medium text-[#1a1a1a] mb-2">当前提示词模板</h4>
        {activeTemplate ? (
          <div className="rounded-lg border border-[#e5e2dd] bg-[#faf9f7] p-3">
            <p className="text-sm font-medium text-[#1a1a1a]">{activeTemplate.name}</p>
            <p className="text-xs text-[#6b7280] mt-1 whitespace-pre-wrap">{activeTemplate.content}</p>
          </div>
        ) : (
          <p className="text-xs text-[#9ca3af]">暂无模板</p>
        )}
      </div>

      <div className="border-t border-[#e5e2dd] pt-4 space-y-3">
        <div>
          <h4 className="text-sm font-medium text-[#1a1a1a] mb-1">连接测试</h4>
          <p className="text-xs text-[#9ca3af]">这里不会保存对话，只用来确认本地 AI 接口是否能正常回复。</p>
        </div>
        <textarea
          value={testInput}
          onChange={(e) => setTestInput(e.target.value)}
          className="w-full min-h-20 px-3 py-2 bg-[#faf9f7] border border-[#e5e2dd] rounded-lg text-sm resize-y"
          placeholder="输入一句测试消息"
        />
        <div className="flex items-center gap-3">
          <button
            onClick={() => void handleTestAI()}
            disabled={testing || !testInput.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-[#c87d2f] rounded-lg hover:bg-[#b06d24] disabled:opacity-50 transition-colors"
          >
            {testing ? '测试中...' : '发送测试'}
          </button>
          {testError && <span className="text-xs text-[#dc3545]">{testError}</span>}
        </div>
        {testReply && (
          <div className="rounded-lg border border-[#e5e2dd] bg-[#faf9f7] p-3 text-sm leading-6 text-[#1a1a1a] whitespace-pre-wrap">
            {testReply}
          </div>
        )}
      </div>
    </div>
  );
}

function TranscriptionSettings() {
  const settings = useTranscriptionStore();
  const updateSettings = useTranscriptionStore((s) => s.updateSettings);
  const resetSettings = useTranscriptionStore((s) => s.resetSettings);
  const [saved, setSaved] = useState(false);
  const [clearingJobs, setClearingJobs] = useState(false);
  const [clearMsg, setClearMsg] = useState('');
  const [fieldHint, setFieldHint] = useState('');
  const [drafts, setDrafts] = useState<NumberDrafts>({
    wordLimit: String(settings.wordLimit),
    cpuThreads: String(settings.cpuThreads),
    beamSize: String(settings.beamSize),
    bestOf: String(settings.bestOf),
    temperature: String(settings.temperature),
  });

  useEffect(() => {
    queueMicrotask(() => {
      setDrafts({
        wordLimit: String(settings.wordLimit),
        cpuThreads: String(settings.cpuThreads),
        beamSize: String(settings.beamSize),
        bestOf: String(settings.bestOf),
        temperature: String(settings.temperature),
      });
    });
  }, [settings.wordLimit, settings.cpuThreads, settings.beamSize, settings.bestOf, settings.temperature]);

  const save = (updates: Partial<typeof settings>) => {
    updateSettings(updates);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const syncNumberDrafts = (updates: Partial<typeof settings>) => {
    setDrafts((current) => ({
      ...current,
      ...(updates.wordLimit !== undefined ? { wordLimit: String(updates.wordLimit) } : {}),
      ...(updates.cpuThreads !== undefined ? { cpuThreads: String(updates.cpuThreads) } : {}),
      ...(updates.beamSize !== undefined ? { beamSize: String(updates.beamSize) } : {}),
      ...(updates.bestOf !== undefined ? { bestOf: String(updates.bestOf) } : {}),
      ...(updates.temperature !== undefined ? { temperature: String(updates.temperature) } : {}),
    }));
  };

  const applyPreset = (updates: Partial<typeof settings>, hint: string) => {
    save(updates);
    syncNumberDrafts(updates);
    setFieldHint(hint);
  };

  const setNumberDraft = (key: keyof NumberDrafts, value: string) => {
    setDrafts((current) => ({ ...current, [key]: value }));
  };

  const commitNumber = (
    key: keyof NumberDrafts,
    storeKey: keyof Pick<typeof settings, 'wordLimit' | 'cpuThreads' | 'beamSize' | 'bestOf' | 'temperature'>,
    min: number,
    max: number,
    label: string,
    integer = true
  ) => {
    const raw = drafts[key].trim();
    const parsed = Number(raw);
    if (!raw || !Number.isFinite(parsed)) {
      setDrafts((current) => ({ ...current, [key]: String(settings[storeKey]) }));
      setFieldHint(`${label} 需要输入数字，已恢复为当前值。`);
      return;
    }
    const clamped = Math.max(min, Math.min(max, integer ? Math.round(parsed) : parsed));
    save({ [storeKey]: clamped });
    setDrafts((current) => ({ ...current, [key]: String(clamped) }));
    setFieldHint(clamped !== parsed ? `${label} 范围是 ${min}-${max}，已自动修正为 ${clamped}。` : '');
  };

  const handleNumberKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.currentTarget.blur();
    }
  };

  const clearJobs = async () => {
    setClearingJobs(true);
    setClearMsg('');
    try {
      const result = await clearActiveAiJobs();
      setClearMsg(`已清理 ${result.cleared} 个任务`);
    } catch (err) {
      setClearMsg(err instanceof Error ? err.message : '清理失败');
    } finally {
      setClearingJobs(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-xs font-medium text-[#6b7280] mb-1.5">Whisper 模型</label>
        <select
          value={settings.whisperModel}
          onChange={(e) => save({ whisperModel: e.target.value })}
          className="w-full px-3 py-2 bg-[#faf9f7] border border-[#e5e2dd] rounded-lg text-sm"
        >
          {WHISPER_MODELS.map((model) => (
            <option key={model.id} value={model.id}>{model.name} - {model.desc}</option>
          ))}
        </select>
        <p className="text-[10px] text-[#9ca3af] mt-1">常用推荐：`medium` 或 `large-v3`。越大越准，越慢，越吃内存。</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-[#6b7280] mb-1.5">识别语言</label>
          <input
            value={settings.language}
            onChange={(e) => save({ language: e.target.value })}
            className="w-full px-3 py-2 bg-[#faf9f7] border border-[#e5e2dd] rounded-lg text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[#6b7280] mb-1.5">总结字数</label>
          <input
            inputMode="numeric"
            value={drafts.wordLimit}
            onChange={(e) => setNumberDraft('wordLimit', e.target.value)}
            onBlur={() => commitNumber('wordLimit', 'wordLimit', 50, 2000, '总结字数')}
            onKeyDown={handleNumberKeyDown}
            className="w-full px-3 py-2 bg-[#faf9f7] border border-[#e5e2dd] rounded-lg text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[#6b7280] mb-1.5">CPU 线程</label>
          <input
            inputMode="numeric"
            value={drafts.cpuThreads}
            onChange={(e) => setNumberDraft('cpuThreads', e.target.value)}
            onBlur={() => commitNumber('cpuThreads', 'cpuThreads', 1, 128, 'CPU 线程')}
            onKeyDown={handleNumberKeyDown}
            className="w-full px-3 py-2 bg-[#faf9f7] border border-[#e5e2dd] rounded-lg text-sm"
          />
          <p className="text-[10px] text-[#9ca3af] mt-1">这个会直接传给转写任务。你改 `.env` 不生效时，通常是因为后端没重启。</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-[#6b7280] mb-1.5">compute_type</label>
          <select
            value={settings.computeType}
            onChange={(e) => save({ computeType: e.target.value })}
            className="w-full px-3 py-2 bg-[#faf9f7] border border-[#e5e2dd] rounded-lg text-sm"
          >
            {['int8', 'int8_float16', 'int16', 'float16', 'float32'].map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-[#6b7280] mb-1.5">beam_size</label>
          <input
            inputMode="numeric"
            value={drafts.beamSize}
            onChange={(e) => setNumberDraft('beamSize', e.target.value)}
            onBlur={() => commitNumber('beamSize', 'beamSize', 1, 10, 'beam_size')}
            onKeyDown={handleNumberKeyDown}
            className="w-full px-3 py-2 bg-[#faf9f7] border border-[#e5e2dd] rounded-lg text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[#6b7280] mb-1.5">best_of</label>
          <input
            inputMode="numeric"
            value={drafts.bestOf}
            onChange={(e) => setNumberDraft('bestOf', e.target.value)}
            onBlur={() => commitNumber('bestOf', 'bestOf', 1, 10, 'best_of')}
            onKeyDown={handleNumberKeyDown}
            className="w-full px-3 py-2 bg-[#faf9f7] border border-[#e5e2dd] rounded-lg text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[#6b7280] mb-1.5">temperature</label>
          <input
            inputMode="decimal"
            value={drafts.temperature}
            onChange={(e) => setNumberDraft('temperature', e.target.value)}
            onBlur={() => commitNumber('temperature', 'temperature', 0, 1, 'temperature', false)}
            onKeyDown={handleNumberKeyDown}
            className="w-full px-3 py-2 bg-[#faf9f7] border border-[#e5e2dd] rounded-lg text-sm"
          />
        </div>
        <div className="flex items-center justify-between py-2">
          <div>
            <p className="text-sm font-medium text-[#1a1a1a]">VAD 过滤</p>
            <p className="text-xs text-[#9ca3af]">去掉长静音，更稳一点</p>
          </div>
          <button
            onClick={() => save({ vadFilter: !settings.vadFilter })}
            className={`relative w-10 h-5 rounded-full transition-colors ${settings.vadFilter ? 'bg-[#c87d2f]' : 'bg-[#d1cdc6]'}`}
          >
            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${settings.vadFilter ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
        </div>
        <div className="flex items-center justify-between py-2">
          <div>
            <p className="text-sm font-medium text-[#1a1a1a]">字幕自动校对</p>
            <p className="text-xs text-[#9ca3af]">字幕生成后先过一遍本地 AI 修正</p>
          </div>
          <button
            onClick={() => save({ subtitleCorrectionEnabled: !settings.subtitleCorrectionEnabled })}
            className={`relative w-10 h-5 rounded-full transition-colors ${settings.subtitleCorrectionEnabled ? 'bg-[#c87d2f]' : 'bg-[#d1cdc6]'}`}
          >
            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${settings.subtitleCorrectionEnabled ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => applyPreset(
            {
              cpuThreads: 4,
              computeType: 'int8',
              beamSize: 1,
              bestOf: 1,
              temperature: 0,
              vadFilter: true,
              subtitleCorrectionEnabled: false,
            },
            '低占用模式：4 线程、低搜索参数、关闭字幕自动校对。'
          )}
          className="px-4 py-2 text-sm font-medium text-[#6b7280] border border-[#e5e2dd] rounded-lg hover:bg-[#f3f2ef]"
        >
          低占用模式
        </button>
        <button
          onClick={() => {
            const maxThreads = Math.max(1, Math.min(128, navigator.hardwareConcurrency || 8));
            applyPreset(
              {
                cpuThreads: maxThreads,
                computeType: 'int8',
                beamSize: 5,
                bestOf: 5,
                temperature: 0,
                vadFilter: true,
                subtitleCorrectionEnabled: true,
              },
              `高性能模式：使用浏览器检测到的 ${maxThreads} 个 CPU 逻辑线程。`
            );
          }}
          className="px-4 py-2 text-sm font-medium text-white bg-[#c87d2f] border border-[#c87d2f] rounded-lg hover:bg-[#b06d20]"
        >
          高性能模式
        </button>
        <button
          onClick={() => {
            resetSettings();
            syncNumberDrafts(DEFAULT_TRANSCRIPTION_SETTINGS);
            setFieldHint('已恢复默认转写设置。');
            setSaved(true);
          }}
          className="px-4 py-2 text-sm font-medium text-[#6b7280] border border-[#e5e2dd] rounded-lg hover:bg-[#f3f2ef]"
        >
          恢复默认
        </button>
        <button
          onClick={() => void clearJobs()}
          disabled={clearingJobs}
          className="px-4 py-2 text-sm font-medium text-[#dc3545] border border-[#fecaca] rounded-lg hover:bg-[#fef2f2] disabled:opacity-50"
        >
          {clearingJobs ? '清理中...' : '清理排队任务'}
        </button>
        {saved && <span className="text-xs text-[#16a34a]">已保存</span>}
        {fieldHint && <span className="text-xs text-[#c87d2f]">{fieldHint}</span>}
        {clearMsg && <span className="text-xs text-[#6b7280]">{clearMsg}</span>}
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
        setImported(true);
        setTimeout(() => { setImported(false); window.location.reload(); }, 1000);
      } catch {
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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
        return <div><h3 className="text-sm font-semibold text-[#1a1a1a] mb-4">AI 助手</h3><AISettings /></div>;
      case 'transcription':
        return <div><h3 className="text-sm font-semibold text-[#1a1a1a] mb-4">转写设置</h3><TranscriptionSettings /></div>;
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
