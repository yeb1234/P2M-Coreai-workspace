import React, { useState } from 'react';
import { CheckCircle2, Settings, Timer, User, Bell, Palette, Shield, Database, Bot, Save, Users } from 'lucide-react';
import { PageTitle } from '../shared';
import { usePomodoroStore, useUIStore, useNotificationStore, useAuthStore } from '../../stores';
import { changePassword } from '../../lib/authApi';
import type { PomodoroConfig } from '../../types';
import { AISettings } from './AISettingsSection';
import { TranscriptionSettings } from './TranscriptionSettingsSection';
import { UserManagementSection } from './UserManagementSection';
import { AppearanceSettings } from './AppearanceSettings';
import { SettingsNav } from './SettingsNav';
import { SettingsButton, SettingsFieldLabel, SettingsHint, SettingsPanelTitle, SettingsSectionTitle, SettingsTextInput, ToggleSwitch } from './SettingsPrimitives';
import { AMBIENT_SOUNDS, playInteractionSound } from '../../lib/sounds';
import { PrivacySettings, DataSettings, BackendHealthSettings } from './PrivacyDataSettings';

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

// 用户管理只对管理员显示，不放进公共 SECTIONS 里
const ADMIN_SECTION = { id: 'users', label: '用户管理', icon: <Users size={16} /> } as const;

type SectionId = (typeof SECTIONS)[number]['id'] | 'users';

/* ─── Pomodoro ─── */
type PomodoroSettingsForm = Pick<
  PomodoroConfig,
  | 'workDuration'
  | 'shortBreakDuration'
  | 'longBreakDuration'
  | 'longBreakInterval'
  | 'dailyGoal'
  | 'ambientPlaybackMode'
  | 'ambientSound'
>;

function createPomodoroSettingsForm(config: PomodoroConfig): PomodoroSettingsForm {
  return {
    workDuration: config.workDuration,
    shortBreakDuration: config.shortBreakDuration,
    longBreakDuration: config.longBreakDuration,
    longBreakInterval: config.longBreakInterval,
    dailyGoal: config.dailyGoal,
    ambientPlaybackMode: config.ambientPlaybackMode,
    ambientSound: config.ambientSound,
  };
}

function PomodoroSettings() {
  const config = usePomodoroStore((s) => s.config);
  const updateConfig = usePomodoroStore((s) => s.updateConfig);
  const clearHistory = usePomodoroStore((s) => s.clearHistory);
  const sessions = usePomodoroStore((s) => s.sessions);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState<PomodoroSettingsForm>(() => createPomodoroSettingsForm(config));

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
            <SettingsFieldLabel>{label}</SettingsFieldLabel>
            <SettingsTextInput
              type="number"
              min={min}
              max={max}
              value={form[key]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: Number(e.target.value) }))}
            />
          </div>
        ))}
      </div>
      <div>
        <SettingsFieldLabel>背景音模式</SettingsFieldLabel>
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
      <div>
        <SettingsFieldLabel>默认背景音</SettingsFieldLabel>
        <select
          value={form.ambientSound ?? 'none'}
          onChange={(e) => setForm((f) => ({ ...f, ambientSound: e.target.value as PomodoroConfig['ambientSound'] }))}
          className="w-full rounded-lg border border-[#e5e2dd] bg-[#faf9f7] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[#c87d2f]"
        >
          <option value="none">不播放</option>
          {Object.entries(AMBIENT_SOUNDS).map(([value, item]) => (
            <option key={value} value={value}>{item.name}</option>
          ))}
        </select>
        <SettingsHint className="mt-1">随专注计时时，新一轮专注会按这里保存的声音自动判断是否播放。</SettingsHint>
      </div>
      <div className="flex items-center gap-3">
        <SettingsButton onClick={handleSave}>
          <Save size={14} /> 保存设置
        </SettingsButton>
        {saved && <span className="text-xs text-[#16a34a]">已保存</span>}
      </div>
      <div className="border-t border-[#e5e2dd] pt-4">
        <SettingsSectionTitle>历史数据</SettingsSectionTitle>
        <SettingsHint className="mb-3 mt-2">共 {sessionCount} 个已完成的番茄记录</SettingsHint>
        <SettingsButton variant="danger" onClick={() => { if (window.confirm('确定清除所有番茄历史记录？此操作不可撤销。')) { clearHistory(); playInteractionSound('delete'); } }} className="px-3 py-1.5 text-xs">
          清除历史记录
        </SettingsButton>
      </div>
    </div>
  );
}

/* ─── Profile ─── */
function ProfileSettings() {
  const displayName = useUIStore((s) => s.displayName);
  const setDisplayName = useUIStore((s) => s.setDisplayName);
  const noteEnterBehavior = useUIStore((s) => s.noteEnterBehavior);
  const setNoteEnterBehavior = useUIStore((s) => s.setNoteEnterBehavior);
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
    if (pwNew.length < 8) { setPwMsg('新密码至少 8 位，且要同时包含字母和数字'); setPwError(true); return; }
    if (pwNew !== pwConfirm) { setPwMsg('两次密码不一致'); setPwError(true); return; }
    if (pwOld === pwNew) { setPwMsg('新密码不能与原密码相同'); setPwError(true); return; }

    // 早期实现只改了浏览器 IndexedDB 里的哈希，后端根本不知道，
    // 结果「改完密码下次还能用旧密码登录」。这里必须走后端。
    try {
      const message = await changePassword(pwOld, pwNew);
      playInteractionSound('success');
      setPwMsg(`${message}，即将返回登录页`);
      setPwError(false);
      setPwOld(''); setPwNew(''); setPwConfirm('');
      // 服务端已经把 token_version +1 并清了 Cookie，当前会话必然失效
      window.setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      playInteractionSound('error');
      setPwMsg(err instanceof Error ? err.message : '修改失败，请稍后再试');
      setPwError(true);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <SettingsFieldLabel>昵称</SettingsFieldLabel>
        <SettingsTextInput
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="输入你的昵称"
        />
        <p className="mt-1 text-[10px] text-[var(--text-muted)]">将显示在侧边栏和工作台中</p>
      </div>
      <div>
        <SettingsFieldLabel>语言</SettingsFieldLabel>
        <div className="px-3 py-2 bg-[#f3f2ef] border border-[#e5e2dd] rounded-lg text-sm text-[#6b7280]">简体中文（内置）</div>
      </div>
      <div>
        <SettingsFieldLabel>一周起始日</SettingsFieldLabel>
        <div className="px-3 py-2 bg-[#f3f2ef] border border-[#e5e2dd] rounded-lg text-sm text-[#6b7280]">星期一（内置）</div>
      </div>
      <div className="flex items-center gap-3">
        <SettingsButton onClick={handleSave}>
          <Save size={14} /> 保存设置
        </SettingsButton>
        {saved && <span className="text-xs text-[#16a34a]">已保存</span>}
      </div>

      <div className="pt-4 border-t border-[#e5e2dd]">
        <SettingsSectionTitle>编辑偏好</SettingsSectionTitle>
        <div className="mt-3 flex items-center justify-between gap-4 rounded-lg border border-[#e5e2dd] bg-[#faf9f7] px-3 py-3">
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">编辑回车行为</p>
            <SettingsHint>
              {noteEnterBehavior === 'enter_save'
                ? 'Enter 保存笔记/待办，Alt+Enter 在正文里换行。'
                : 'Enter 在正文里换行，Alt+Enter 保存笔记/待办。'}
            </SettingsHint>
          </div>
          <ToggleSwitch
            checked={noteEnterBehavior === 'enter_newline'}
            onClick={() => {
              setNoteEnterBehavior(noteEnterBehavior === 'enter_save' ? 'enter_newline' : 'enter_save');
              playInteractionSound('tap');
            }}
          />
        </div>
      </div>

      {/* Change password */}
      <div className="pt-4 border-t border-[#e5e2dd]">
        <SettingsSectionTitle>修改密码</SettingsSectionTitle>
        <div className="space-y-2">
          <SettingsTextInput type="password" value={pwOld} onChange={(e) => setPwOld(e.target.value)} placeholder="原密码" />
          <SettingsTextInput type="password" value={pwNew} onChange={(e) => setPwNew(e.target.value)} placeholder="新密码" />
          <SettingsTextInput type="password" value={pwConfirm} onChange={(e) => setPwConfirm(e.target.value)} placeholder="确认新密码" />
        </div>
        <SettingsButton variant="secondary" onClick={handleChangePassword} className="mt-3">
          修改密码
        </SettingsButton>
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
      <p className="text-sm text-[var(--text-secondary)]">管理各类通知的开关和提示音设置。</p>
      {toggles.map(({ key, label, desc }) => (
        <div key={key} className="flex items-center justify-between py-3 border-b border-[#e5e2dd] last:border-0">
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">{label}</p>
            <SettingsHint>{desc}</SettingsHint>
          </div>
          <ToggleSwitch checked={Boolean(draft[key])} onClick={() => handleToggle(key)} />
        </div>
      ))}
      <div className="flex items-center gap-3">
        <SettingsButton onClick={handleSave}>
          <Save size={14} /> 保存设置
        </SettingsButton>
        {saved && <span className="text-xs text-[#16a34a]">已保存</span>}
      </div>
    </div>
  );
}

/* ─── Main ─── */
export const SettingsPage: React.FC = () => {
  const [activeSection, setActiveSection] = useState<SectionId>('pomodoro');
  const role = useAuthStore((s) => s.role);
  const visibleSections = role === 'admin' ? [...SECTIONS, ADMIN_SECTION] : [...SECTIONS];

  const renderSection = () => {
    switch (activeSection) {
      case 'pomodoro':
        return <div><SettingsPanelTitle>番茄钟设置</SettingsPanelTitle><PomodoroSettings /></div>;
      case 'profile':
        return <div><SettingsPanelTitle>个人信息</SettingsPanelTitle><ProfileSettings /></div>;
      case 'notifications':
        return <div><SettingsPanelTitle>通知设置</SettingsPanelTitle><NotificationSettings /></div>;
      case 'appearance':
        return <div><SettingsPanelTitle>外观设置</SettingsPanelTitle><AppearanceSettings /></div>;
      case 'ai':
        return <div><SettingsPanelTitle>灵境小助手</SettingsPanelTitle><AISettings /></div>;
      case 'transcription':
        return <div><SettingsPanelTitle>转写设置</SettingsPanelTitle><TranscriptionSettings /></div>;
      case 'backend':
        return <div><SettingsPanelTitle>后端健康状态</SettingsPanelTitle><BackendHealthSettings /></div>;
      case 'privacy':
        return <div><SettingsPanelTitle>隐私设置</SettingsPanelTitle><PrivacySettings /></div>;
      case 'data':
        return <div><SettingsPanelTitle>数据管理</SettingsPanelTitle><DataSettings /></div>;
      case 'users':
        return <div><SettingsPanelTitle>用户管理</SettingsPanelTitle><UserManagementSection /></div>;
    }
  };

  return (
    <div className="w-full pt-2 space-y-6">
      <PageTitle
        title="设置"
        subtitle="管理你的偏好和配置"
        icon={<Settings size={22} />}
      />
      <div className="flex flex-col gap-4 md:flex-row md:gap-6">
        <SettingsNav sections={visibleSections} activeSection={activeSection} onSelect={(id) => setActiveSection(id as SectionId)} />
        <div className="flex-1 rounded-xl border border-[var(--border-light)] bg-[var(--bg-elevated)] p-4 md:p-5">
          {renderSection()}
        </div>
      </div>
    </div>
  );
};
