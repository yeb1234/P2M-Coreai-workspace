import React, { useState } from 'react';
import { Settings, Timer, User, Bell, Palette, Shield, Database, Save } from 'lucide-react';
import { PageTitle } from '../shared';
import { usePomodoroStore } from '../../stores';

const SECTIONS = [
  { id: 'pomodoro', label: '番茄钟', icon: <Timer size={16} /> },
  { id: 'profile', label: '个人信息', icon: <User size={16} /> },
  { id: 'notifications', label: '通知', icon: <Bell size={16} /> },
  { id: 'appearance', label: '外观', icon: <Palette size={16} /> },
  { id: 'privacy', label: '隐私', icon: <Shield size={16} /> },
  { id: 'data', label: '数据', icon: <Database size={16} /> },
] as const;

type SectionId = typeof SECTIONS[number]['id'];

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

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-[#6b7280] mb-1.5">专注时长（分钟）</label>
          <input
            type="number"
            min={1}
            max={120}
            value={form.workDuration}
            onChange={(e) => setForm((f) => ({ ...f, workDuration: Number(e.target.value) }))}
            className="w-full px-3 py-2 bg-[#faf9f7] border border-[#e5e2dd] rounded-lg text-sm outline-none focus:border-[#c87d2f] focus:ring-2 focus:ring-[#c87d2f]/10"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[#6b7280] mb-1.5">短休息（分钟）</label>
          <input
            type="number"
            min={1}
            max={30}
            value={form.shortBreakDuration}
            onChange={(e) => setForm((f) => ({ ...f, shortBreakDuration: Number(e.target.value) }))}
            className="w-full px-3 py-2 bg-[#faf9f7] border border-[#e5e2dd] rounded-lg text-sm outline-none focus:border-[#c87d2f] focus:ring-2 focus:ring-[#c87d2f]/10"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[#6b7280] mb-1.5">长休息（分钟）</label>
          <input
            type="number"
            min={1}
            max={60}
            value={form.longBreakDuration}
            onChange={(e) => setForm((f) => ({ ...f, longBreakDuration: Number(e.target.value) }))}
            className="w-full px-3 py-2 bg-[#faf9f7] border border-[#e5e2dd] rounded-lg text-sm outline-none focus:border-[#c87d2f] focus:ring-2 focus:ring-[#c87d2f]/10"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[#6b7280] mb-1.5">长休息间隔（番茄数）</label>
          <input
            type="number"
            min={1}
            max={10}
            value={form.longBreakInterval}
            onChange={(e) => setForm((f) => ({ ...f, longBreakInterval: Number(e.target.value) }))}
            className="w-full px-3 py-2 bg-[#faf9f7] border border-[#e5e2dd] rounded-lg text-sm outline-none focus:border-[#c87d2f] focus:ring-2 focus:ring-[#c87d2f]/10"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[#6b7280] mb-1.5">每日目标（番茄数）</label>
          <input
            type="number"
            min={1}
            max={20}
            value={form.dailyGoal}
            onChange={(e) => setForm((f) => ({ ...f, dailyGoal: Number(e.target.value) }))}
            className="w-full px-3 py-2 bg-[#faf9f7] border border-[#e5e2dd] rounded-lg text-sm outline-none focus:border-[#c87d2f] focus:ring-2 focus:ring-[#c87d2f]/10"
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-[#c87d2f] rounded-lg hover:bg-[#b06d24] transition-colors"
        >
          <Save size={14} />
          保存设置
        </button>
        {saved && <span className="text-xs text-[#16a34a]">已保存</span>}
      </div>

      <div className="border-t border-[#e5e2dd] pt-4">
        <h4 className="text-sm font-medium text-[#1a1a1a] mb-2">历史数据</h4>
        <p className="text-xs text-[#9ca3af] mb-3">共 {sessionCount} 个已完成的番茄记录</p>
        <button
          onClick={() => {
            if (window.confirm('确定清除所有番茄历史记录？此操作不可撤销。')) {
              clearHistory();
            }
          }}
          className="px-3 py-1.5 text-xs text-[#dc3545] border border-[#dc3545]/30 rounded-lg hover:bg-[#dc3545]/5 transition-colors"
        >
          清除历史记录
        </button>
      </div>
    </div>
  );
}

function PlaceholderSection({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-[#6b7280]">{description}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[1, 2].map((i) => (
          <div key={i}>
            <div className="w-20 h-3 bg-[#e5e2dd] rounded mb-1.5" />
            <div className="w-full h-10 bg-[#faf9f7] border border-[#e5e2dd] rounded-lg" />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-2">
        <div className="w-24 h-8 bg-[#e5e2dd] rounded-lg" />
        <span className="text-[10px] text-[#b8b4ac]">即将上线</span>
      </div>
    </div>
  );
}

export const SettingsPage: React.FC = () => {
  const [activeSection, setActiveSection] = useState<SectionId>('pomodoro');

  const renderSection = () => {
    switch (activeSection) {
      case 'pomodoro':
        return (
          <div>
            <h3 className="text-sm font-semibold text-[#1a1a1a] mb-4">番茄钟设置</h3>
            <PomodoroSettings />
          </div>
        );
      case 'profile':
        return (
          <div>
            <h3 className="text-sm font-semibold text-[#1a1a1a] mb-4">个人信息</h3>
            <PlaceholderSection title="个人信息" description="管理你的个人资料、头像和账号信息。" />
          </div>
        );
      case 'notifications':
        return (
          <div>
            <h3 className="text-sm font-semibold text-[#1a1a1a] mb-4">通知设置</h3>
            <PlaceholderSection title="通知" description="配置番茄钟提醒、待办到期通知和系统消息推送。" />
          </div>
        );
      case 'appearance':
        return (
          <div>
            <h3 className="text-sm font-semibold text-[#1a1a1a] mb-4">外观设置</h3>
            <PlaceholderSection title="外观" description="自定义主题颜色、字体大小和界面布局偏好。" />
          </div>
        );
      case 'privacy':
        return (
          <div>
            <h3 className="text-sm font-semibold text-[#1a1a1a] mb-4">隐私设置</h3>
            <PlaceholderSection title="隐私" description="管理数据隐私选项和第三方授权。" />
          </div>
        );
      case 'data':
        return (
          <div>
            <h3 className="text-sm font-semibold text-[#1a1a1a] mb-4">数据管理</h3>
            <PlaceholderSection title="数据" description="导出/导入数据备份，清除缓存和本地存储。" />
          </div>
        );
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
        {/* Section nav */}
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

        {/* Section content */}
        <div className="flex-1 bg-[#faf9f7] border border-[#e5e2dd] rounded-xl p-5">
          {renderSection()}
        </div>
      </div>
    </div>
  );
};
