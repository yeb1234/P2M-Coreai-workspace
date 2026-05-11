import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { THEME_PRESETS } from '../../src/lib/themes';

const repoRoot = process.cwd();

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf-8');
}

describe('regression contracts', () => {
  it('keeps responsive grids based on container width', () => {
    const css = readRepoFile('src/index.css');

    for (const className of ['auto-grid-cards', 'auto-grid-panels', 'auto-grid-wide', 'auto-grid-video', 'auto-grid-compact']) {
      const block = css.match(new RegExp(`\\.${className}\\s*\\{[\\s\\S]*?\\}`))?.[0] ?? '';

      expect(block, `${className} should exist`).toContain('display: grid');
      expect(block, `${className} should use minmax`).toContain('minmax');
      expect(block, `${className} should guard against narrow containers`).toContain('min(100%');
    }
  });

  it('keeps video card columns user-controlled and mobile-safe', () => {
    const css = readRepoFile('src/index.css');
    const block = css.match(/\.video-card-grid\s*\{[\s\S]*?\}/)?.[0] ?? '';

    expect(block).toContain('--video-grid-columns');
    expect(block).toContain('minmax(0, 1fr)');
    expect(block).toContain('justify-content: start');
    expect(css).toContain('@media (max-width: 640px)');
    expect(css).toContain('grid-template-columns: 1fr');
  });

  it('keeps desktop main padding at the tuned compact value', () => {
    const css = readRepoFile('src/index.css');
    const desktopMainBlock = css.match(/@media \(min-width: 768px\)\s*\{\s*\.app-main\s*\{[\s\S]*?\}\s*\}/)?.[0] ?? '';

    expect(desktopMainBlock).toContain('padding: 0.875rem');
  });

  it('keeps the ambient volume fill and thumb on a single ratio variable', () => {
    const pomodoroTimer = readRepoFile('src/components/pomodoro/PomodoroTimer.tsx');

    expect(pomodoroTimer).toContain('--ambient-volume-ratio');
    expect(pomodoroTimer).toContain('width: \'calc((100% - 12px) * var(--ambient-volume-ratio))\'');
    expect(pomodoroTimer).toContain('left: \'calc(6px + (100% - 12px) * var(--ambient-volume-ratio))\'');
    expect(pomodoroTimer).not.toContain('ambientVolume / 100})`');
  });

  it('keeps admin router as a thin HTTP layer', () => {
    const adminRouter = readRepoFile('backend/app/routers/admin.py');

    expect(adminRouter).toContain('from app.services import admin_ai_queue');
    expect(adminRouter).toContain('from app.services.admin_health import backend_health as collect_backend_health');
    expect(adminRouter).toContain('from app.services.admin_library import');
    expect(adminRouter).not.toContain('from app.models import AiJob');
    expect(adminRouter).not.toContain('requests.get');
    expect(adminRouter).not.toContain('threading.Thread');
    expect(adminRouter).not.toContain('db.query(AiJob)');
  });

  it('keeps dark themes on distinct layered surface colors', () => {
    const darkThemeIds = ['night', 'claude-ink', 'primer-dark', 'antigravity-dark', 'blue-night'];

    for (const id of darkThemeIds) {
      const theme = THEME_PRESETS.find((preset) => preset.id === id);
      expect(theme, `${id} exists`).toBeTruthy();
      const vars = theme!.vars;
      const surfaceColors = new Set([
        vars['--bg-body'].toLowerCase(),
        vars['--bg-base'].toLowerCase(),
        vars['--bg-card'].toLowerCase(),
        vars['--bg-elevated'].toLowerCase(),
      ]);

      expect(surfaceColors.size, `${id} should have body/base/card/elevated layers`).toBe(4);
      expect(vars['--text-primary'], `${id} should avoid pure white primary text`).not.toBe('#ffffff');
      expect(vars['--accent-bg'].toLowerCase(), `${id} accent bg should differ from card`).not.toBe(vars['--bg-card'].toLowerCase());
    }
  });
});
