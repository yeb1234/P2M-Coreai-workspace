import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_TITLE, APP_VERSION, pageTitle } from '../config/appMeta';

describe('app meta', () => {
  it('exposes a versioned product title', () => {
    expect(APP_VERSION).toBe('7.1');
    expect(APP_TITLE).toBe('SiteYeb 7.1 · 灵境工作台');
  });

  it('prefixes page titles without losing the release version', () => {
    expect(pageTitle('笔记')).toBe('笔记 · SiteYeb 7.1');
    expect(pageTitle()).toBe(APP_TITLE);
  });

  it('keeps index.html and package.json on the same release', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    const pkg = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as { version: string };

    expect(html).toContain(`<title>${APP_TITLE}</title>`);
    expect(html).toContain(`lang="zh-CN"`);
    expect(pkg.version.startsWith(`${APP_VERSION}.`)).toBe(true);
  });
});
