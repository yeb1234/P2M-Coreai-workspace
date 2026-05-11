import { useEffect } from 'react';
import { THEME_PRESETS, applyTheme } from '../lib/themes';
import { useUIStore } from '../stores';

export function useApplyStoredTheme(enabled: boolean) {
  const themeId = useUIStore((state) => state.themeId);
  const customTheme = useUIStore((state) => state.customTheme);

  useEffect(() => {
    if (!enabled) return;

    if (themeId === 'custom' && customTheme) {
      applyTheme('custom', customTheme);
      return;
    }

    const preset = THEME_PRESETS.find((theme) => theme.id === themeId) ?? THEME_PRESETS[0];
    applyTheme(preset.id, preset.vars);
  }, [customTheme, enabled, themeId]);
}
