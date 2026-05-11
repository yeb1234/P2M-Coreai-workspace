import React, { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { useUIStore } from '../../stores';
import { BUILT_IN_THEME_IDS, THEME_PRESETS, applyTheme, generateThemeCss, parseThemeVarsText, themeGroupLabel } from '../../lib/themes';
import { playInteractionSound } from '../../lib/sounds';

export function AppearanceSettings() {
  const themeId = useUIStore((s) => s.themeId);
  const setTheme = useUIStore((s) => s.setTheme);
  const setCustomTheme = useUIStore((s) => s.setCustomTheme);
  const importRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState('');
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
      onClick={() => {
        setTheme(t.id);
        applyTheme(t.id, t.vars);
      }}
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

  return (
    <div className="space-y-6">
      <div>
        <label className="mb-3 block text-xs font-medium text-[var(--text-secondary)]">主题风格</label>
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
    </div>
  );
}
