import { describe, expect, it } from 'vitest';
import { generateThemeCss, parseThemeVarsText, THEME_PRESETS } from '../lib/themes';

describe('theme import and export', () => {
  it('round-trips exported css into complete theme variables', () => {
    const preset = THEME_PRESETS[0];
    const css = generateThemeCss(preset.id, preset.vars);
    const parsed = parseThemeVarsText(css);

    expect(parsed).toEqual(preset.vars);
    expect(css).toContain('分组：主题风格');
    expect(css).toContain('预览：页面');
  });

  it('parses json theme packages with vars', () => {
    const preset = THEME_PRESETS[1];
    const parsed = parseThemeVarsText(JSON.stringify({
      kind: 'p2m-theme',
      version: 1,
      themeId: preset.id,
      name: preset.name,
      vars: preset.vars,
    }));

    expect(parsed).toEqual(preset.vars);
  });

  it('fills optional missing css variables from the default theme', () => {
    const parsed = parseThemeVarsText(':root { --bg-body: #000; --bg-base: #111; --bg-card: #222; --text-primary: #eee; --accent: #fff; }');

    expect(parsed?.['--bg-body']).toBe('#000');
    expect(parsed?.['--accent']).toBe('#fff');
    expect(parsed?.['--bg-card']).toBe('#222');
    expect(parsed?.['--text-muted']).toBe(THEME_PRESETS[0].vars['--text-muted']);
  });

  it('rejects text without theme variables', () => {
    expect(parseThemeVarsText('body { color: red; }')).toBeNull();
  });
});
