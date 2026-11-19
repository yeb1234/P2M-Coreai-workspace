import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, RefreshCw, Upload, XCircle } from 'lucide-react';
import { useCalendarStore, useNotesStore, useNotificationStore, usePomodoroStore, useScheduleStore } from '../../stores';
import { fetchBackendHealth, type BackendHealthOut } from '../../lib/videoApi';
import { idbStorage } from '../../lib/idbStorage';
import { STORAGE_KEYS } from './types';
import { ConfirmDialog } from '../shared';
import { playInteractionSound } from '../../lib/sounds';
import { SettingsButton, SettingsHint, SettingsSectionTitle } from './SettingsPrimitives';

export function PrivacySettings() {
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
        <SettingsSectionTitle>清除通知数据</SettingsSectionTitle>
        <SettingsHint className="mb-3 mt-2">删除所有通知记录，不影响其他数据。</SettingsHint>
        <SettingsButton variant="outline" onClick={handleClearNotifications} className="px-3 py-1.5 text-xs">
          清除通知
        </SettingsButton>
        {cleared && <span className="ml-2 text-xs text-[var(--success)]">已清除{cleared}</span>}
      </div>
      <div className="border-t border-[var(--border-light)] pt-4">
        <div className="mb-3 flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[var(--danger)]" />
          <div>
            <SettingsSectionTitle danger>清除所有数据</SettingsSectionTitle>
            <SettingsHint>将删除所有待办、便签、日历、番茄记录等数据。此操作不可撤销。</SettingsHint>
          </div>
        </div>
        <SettingsButton variant="danger" onClick={() => setShowWipeConfirm(true)} className="px-3 py-1.5 text-xs">
          清除所有数据
        </SettingsButton>
      </div>
      <ConfirmDialog
        isOpen={showWipeConfirm}
        onClose={() => setShowWipeConfirm(false)}
        onConfirm={handleWipeAll}
        title="清除所有数据"
        message="确定要删除所有数据吗？这将清除所有待办、便签、日历事件、番茄记录等，且无法恢复。"
        confirmText="确认清除"
      />
    </div>
  );
}

export function BackendHealthSettings() {
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
        <SettingsButton
          onClick={() => void loadHealth()}
          disabled={loading}
          variant="secondary"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          检测后端状态
        </SettingsButton>
        {health && (
          <span className={`text-xs ${health.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
            {health.ok ? '核心服务正常' : '存在需要处理的项目'}
          </span>
        )}
        {error && <span className="text-xs text-[var(--danger)]">{error}</span>}
      </div>

      <div className="auto-grid-panels">
        {(health?.checks ?? []).map((check) => (
          <div key={check.name} className="rounded-xl border border-[var(--border-light)] bg-[var(--bg-elevated)] p-3">
            <div className="flex items-start gap-2">
              {check.ok ? <CheckCircle2 size={16} className="mt-0.5 text-[var(--success)]" /> : <XCircle size={16} className="mt-0.5 text-[var(--danger)]" />}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[var(--text-primary)]">{check.name}</p>
                <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{check.message}</p>
                {Object.keys(check.details || {}).length > 0 && (
                  <pre className="mt-2 max-h-24 overflow-auto rounded-lg bg-[var(--bg-card)] px-2 py-1.5 text-xs leading-4 text-[var(--text-secondary)]">
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

export function DataSettings() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [exported, setExported] = useState(false);
  const [imported, setImported] = useState(false);

  // 同上：用真实的待办来源（后端表）统计，否则「清空待办」清的是本地残留数据。
  const scheduleItems = useScheduleStore((s) => s.items);
  const todos = Object.fromEntries(
    Object.entries(scheduleItems).filter(([, i]) => i.type === 'todo' && !i.deletedAt),
  );
  const notes = useNotesStore((s) => s.notes);
  const events = useCalendarStore((s) => s.events);
  const sessions = usePomodoroStore((s) => s.sessions);

  const stats: Record<string, number> = {
    待办: Object.values(todos).length,
    便签: notes.length,
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
        <SettingsSectionTitle>数据概览</SettingsSectionTitle>
        <div className="auto-grid-compact">
          {Object.entries(stats).map(([label, count]) => (
            <div key={label} className="rounded-lg border border-[var(--border-light)] bg-[var(--bg-elevated)] p-3 text-center">
              <p className="text-lg font-bold text-[var(--accent)]">{count}</p>
              <SettingsHint>{label}</SettingsHint>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-[var(--border-light)] pt-4">
        <SettingsSectionTitle>导出 / 导入</SettingsSectionTitle>
        <div className="flex flex-wrap gap-3">
          <SettingsButton onClick={handleExport}>
            <Download size={14} /> 导出数据
          </SettingsButton>
          <SettingsButton variant="outline" onClick={() => fileInputRef.current?.click()}>
            <Upload size={14} /> 导入数据
          </SettingsButton>
          <input ref={fileInputRef} type="file" accept=".json" onChange={handleImport} className="hidden" />
        </div>
        {exported && <p className="mt-2 text-xs text-[var(--success)]">已导出</p>}
        {imported && <p className="mt-2 text-xs text-[var(--success)]">导入成功，正在刷新...</p>}
      </div>
    </div>
  );
}
