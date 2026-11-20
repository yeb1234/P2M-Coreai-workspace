import { describe, expect, it } from 'vitest';
import { PAGES } from '../config/pageRegistry';
import { PLUGIN_VERSIONS, PLUGIN_STAGE_LABEL, isPluginVersion } from '../config/pluginVersions';

describe('plugin version ledger', () => {
  it('covers every internal page plugin', () => {
    for (const page of PAGES) {
      expect(PLUGIN_VERSIONS[page.id], `missing version for ${page.id}`).toBeTruthy();
    }
    // Ledger 也保留 Lite 专属演示页，完整版 PAGES 会裁掉它们；
    // 因此这里验证“可见页全覆盖”，不把台账条目数锁死成当前形态的页数。
    expect(Object.keys(PLUGIN_VERSIONS).length).toBeGreaterThanOrEqual(PAGES.length);
  });

  it('uses semver and a readable stage label', () => {
    for (const [id, meta] of Object.entries(PLUGIN_VERSIONS)) {
      expect(isPluginVersion(meta.version), `${id} version=${meta.version}`).toBe(true);
      expect(meta.summary.trim().length).toBeGreaterThan(0);
      expect(PLUGIN_STAGE_LABEL[meta.stage]).toBeTruthy();
    }
  });

  it('keeps dev pages marked as dev', () => {
    for (const page of PAGES) {
      if (page.dev) expect(PLUGIN_VERSIONS[page.id].stage).toBe('dev');
    }
  });
});
