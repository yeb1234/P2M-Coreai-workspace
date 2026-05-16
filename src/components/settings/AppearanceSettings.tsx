import React, { useRef, useState } from 'react';
import { Download, Upload, Plus, Trash2, Clock, CalendarDays } from 'lucide-react';
import { useUIStore } from '../../stores';
import {
  BUILT_IN_THEME_IDS,
  THEME_PRESETS,
  applyTheme,
  generateThemeCss,
  parseThemeVarsText,
  themeGroupLabel,
  type ThemeScheduleRule,
  WEEKDAY_LABELS,
  formatScheduleRuleTime,
  formatScheduleRuleWeekdays,
} from '../../lib/themes';
import { playInteractionSound } from '../../lib/sounds';
import { ToggleSwitch, SettingsHint } from './SettingsPrimitives';

export function AppearanceSettings() {
  const themeId = useUIStore((s) => s.themeId);
  const setTheme = useUIStore((s) => s.setTheme);
  const setCustomTheme = useUIStore((s) => s.setCustomTheme);
  const themeScheduleEnabled = useUIStore((s) => s.themeScheduleEnabled);
  const setThemeScheduleEnabled = useUIStore((s) => s.setThemeScheduleEnabled);
  const themeScheduleRules = useUIStore((s) => s.themeScheduleRules);
  const setThemeScheduleRules = useUIStore((s) => s.setThemeScheduleRules);
  const importRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState('');
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);

  const handleThemeClick = (id: string, vars: typeof THEME_PRESETS[number]['vars']) => {
    setTheme(id);
    applyTheme(id, vars);
  };
  const themeGroups = [
    { title: '主题风格', items: THEME_PRESETS.filter((theme) => BUILT_IN_THEME_IDS.has(theme.id)) },
    { title: '自定义风格', items: THEME_PRESETS.filter((theme) => !BUILT_IN_THEME_IDS.has(theme.id)) },
  ];

  const handleExportTheme = () => {
    const preset = THEME_PRESETS.find((t) => t.id === themeId);
    const vars = preset?.vars || THEME_PRESETS[0].vars;
    const blob = new Blob([generateThemeCss(themeId, vars)], { type: 'text/css;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${themeGroupLabel(themeId)}-${(preset?.name || themeId).replace(/\s+/g, '-')}.css`;
    a.click();
    URL.revokeObjectURL(url);
    playInteractionSound('success');
  };

  const handleExportThemeJson = () => {
    const preset = THEME_PRESETS.find((t) => t.id === themeId);
    const vars = preset?.vars || THEME_PRESETS[0].vars;
    // JSON keeps metadata with the variables; CSS stays human-editable and comment-heavy.
    const payload = {
      kind: 'p2m-theme',
      version: 1,
      group: themeGroupLabel(themeId),
      themeId,
      name: preset?.name || themeId,
      description: preset?.description || '',
      vars,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${themeGroupLabel(themeId)}-${(preset?.name || themeId).replace(/\s+/g, '-')}.json`;
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
        // Keep parsing centralized in themes.ts so CSS and JSON formats evolve together.
        const vars = parseThemeVarsText(text);
        if (!vars) {
          setImportStatus('未识别出有效主题变量');
          playInteractionSound('error');
          return;
        }
        setCustomTheme(vars);
        applyTheme('custom', vars);
        setImportStatus('主题已导入');
        playInteractionSound('success');
      } catch {
        setImportStatus('导入失败');
        playInteractionSound('error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const renderThemeButton = (t: (typeof THEME_PRESETS)[number]) => (
    <button
      key={t.id}
      onClick={() => handleThemeClick(t.id, t.vars)}
      className={`theme-card relative rounded-lg px-3 py-3 text-left transition-all ${
        themeId === t.id
          ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]/20'
          : 'hover:border-[var(--border-medium)]'
      }`}
    >
      <div className="mb-2 flex h-7 overflow-hidden rounded-md border border-[var(--border-light)]">
        <span className="flex-1" style={{ background: t.vars['--bg-base'] }} />
        <span className="flex-1" style={{ background: t.vars['--bg-card'] }} />
        <span className="flex-1" style={{ background: t.vars['--accent'] }} />
      </div>
      <div className="mb-1 flex items-center gap-2">
        <div className="h-3 w-3 rounded-full" style={{ background: t.vars['--accent'] }} />
        <span className="text-xs font-medium text-[var(--text-primary)]">{t.name}</span>
      </div>
      <p className="text-[10px] leading-4 text-[var(--text-muted)]">{t.description}</p>
    </button>
  );

  const handleAddRule = () => {
    const newRule: ThemeScheduleRule = {
      id: `rule-${Date.now()}`,
      name: '新规则',
      weekdays: [1, 2, 3, 4, 5],
      startTime: '09:00',
      endTime: '17:00',
      themeId: 'corporate',
      enabled: true,
    };
    setThemeScheduleRules([...themeScheduleRules, newRule]);
    setEditingRuleId(newRule.id);
  };

  const handleDeleteRule = (id: string) => {
    setThemeScheduleRules(themeScheduleRules.filter((r) => r.id !== id));
    if (editingRuleId === id) setEditingRuleId(null);
  };

  const handleUpdateRule = (id: string, patch: Partial<ThemeScheduleRule>) => {
    setThemeScheduleRules(
      themeScheduleRules.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
  };

  const toggleRuleWeekday = (ruleId: string, day: number) => {
    const rule = themeScheduleRules.find((r) => r.id === ruleId);
    if (!rule) return;
    const has = rule.weekdays.includes(day);
    const next = has ? rule.weekdays.filter((d) => d !== day) : [...rule.weekdays, day].sort((a, b) => a - b);
    handleUpdateRule(ruleId, { weekdays: next });
  };

  return (
    <div className="space-y-6">
      {/* 主题选择 */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <label className="block text-xs font-medium text-[var(--text-secondary)]">主题风格</label>
          {themeScheduleEnabled && (
            <span className="rounded-md bg-[var(--accent-bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--accent)]">
              自动调度中
            </span>
          )}
        </div>
        <div className="space-y-5">
          {themeGroups.map((group) => (
            <section key={group.title} className="space-y-2">
              <div className="flex items-center gap-2">
                <h4 className="text-xs font-semibold text-[var(--text-primary)]">{group.title}</h4>
                <span className="text-[10px] text-[var(--text-muted)]">{group.items.length} 个</span>
              </div>
              <div className="auto-grid-cards">
                {group.items.map(renderThemeButton)}
              </div>
            </section>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={handleExportTheme} className="flex items-center gap-1 text-xs text-[var(--text-secondary)] transition-colors hover:text-[var(--accent)]">
            <Download size={12} /> 导出 CSS 样式
          </button>
          <button onClick={handleExportThemeJson} className="flex items-center gap-1 text-xs text-[var(--text-secondary)] transition-colors hover:text-[var(--accent)]">
            <Download size={12} /> 导出 JSON 包
          </button>
          <button onClick={() => importRef.current?.click()} className="flex items-center gap-1 text-xs text-[var(--text-secondary)] transition-colors hover:text-[var(--accent)]">
            <Upload size={12} /> 导入主题
          </button>
          <input ref={importRef} type="file" accept=".css,.json" onChange={handleImportTheme} className="hidden" />
        </div>
        {importStatus && <p className="mt-2 text-[11px] text-[var(--text-muted)]">{importStatus}</p>}
      </div>

      {/* 自动主题调度 */}
      <div className="rounded-xl border border-[var(--border-light)] bg-[var(--bg-card)] p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold text-[var(--text-primary)]">自动主题切换</h4>
            <SettingsHint className="mt-0.5">按时间表自动切换不同主题</SettingsHint>
          </div>
          <ToggleSwitch
            checked={themeScheduleEnabled}
            onClick={() => setThemeScheduleEnabled(!themeScheduleEnabled)}
          />
        </div>

        {themeScheduleEnabled && (
          <div className="space-y-3">
            <SettingsHint>后面的规则优先级更高，冲突时后面的规则覆盖前面的规则。</SettingsHint>
            {themeScheduleRules.map((rule) => {
              const isEditing = editingRuleId === rule.id;
              const themeName = THEME_PRESETS.find((t) => t.id === rule.themeId)?.name ?? rule.themeId;
              return (
                <div
                  key={rule.id}
                  className={`rounded-lg border p-3 transition-all ${
                    rule.enabled ? 'border-[var(--border-light)] bg-[var(--bg-elevated)]' : 'border-[var(--border-light)]/50 bg-[var(--bg-elevated)]/50 opacity-60'
                  }`}
                >
                  {isEditing ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <input
                          value={rule.name}
                          onChange={(e) => handleUpdateRule(rule.id, { name: e.target.value })}
                          className="flex-1 rounded-md border border-[var(--border-light)] bg-[var(--bg-base)] px-2 py-1 text-xs outline-none focus:border-[var(--accent)]"
                          placeholder="规则名称"
                        />
                        <select
                          value={rule.themeId}
                          onChange={(e) => handleUpdateRule(rule.id, { themeId: e.target.value })}
                          className="rounded-md border border-[var(--border-light)] bg-[var(--bg-base)] px-2 py-1 text-xs outline-none focus:border-[var(--accent)]"
                        >
                          {THEME_PRESETS.map((t) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-[var(--text-muted)]">时间</span>
                        <input
                          type="time"
                          value={rule.startTime}
                          onChange={(e) => handleUpdateRule(rule.id, { startTime: e.target.value })}
                          className="rounded-md border border-[var(--border-light)] bg-[var(--bg-base)] px-2 py-1 text-xs outline-none"
                        />
                        <span className="text-[var(--text-muted)]">~</span>
                        <input
                          type="time"
                          value={rule.endTime}
                          onChange={(e) => handleUpdateRule(rule.id, { endTime: e.target.value })}
                          className="rounded-md border border-[var(--border-light)] bg-[var(--bg-base)] px-2 py-1 text-xs outline-none"
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        {WEEKDAY_LABELS.map((label, day) => (
                          <button
                            key={day}
                            onClick={() => toggleRuleWeekday(rule.id, day)}
                            className={`h-6 w-6 rounded-md text-[10px] font-medium transition-colors ${
                              rule.weekdays.includes(day)
                                ? 'bg-[var(--accent)] text-white'
                                : 'border border-[var(--border-light)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleUpdateRule(rule.id, { enabled: !rule.enabled })}
                          className="text-[10px] text-[var(--text-secondary)] hover:text-[var(--accent)]"
                        >
                          {rule.enabled ? '禁用' : '启用'}
                        </button>
                        <button
                          onClick={() => setEditingRuleId(null)}
                          className="text-[10px] text-[var(--accent)] hover:underline"
                        >
                          完成
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs font-medium text-[var(--text-primary)]">{rule.name}</span>
                          <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
                            <span className="flex items-center gap-1">
                              <CalendarDays size={10} />
                              {formatScheduleRuleWeekdays(rule)}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock size={10} />
                              {formatScheduleRuleTime(rule)}
                            </span>
                            <span className="rounded bg-[var(--bg-accent)] px-1 py-0.5 text-[var(--accent)]">{themeName}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setEditingRuleId(rule.id)}
                          className="text-[10px] text-[var(--text-secondary)] hover:text-[var(--accent)]"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => handleDeleteRule(rule.id)}
                          className="text-[var(--text-muted)] transition-colors hover:text-[var(--danger)]"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <button
              onClick={handleAddRule}
              className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-[var(--border-medium)] py-2 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              <Plus size={14} /> 添加规则
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
