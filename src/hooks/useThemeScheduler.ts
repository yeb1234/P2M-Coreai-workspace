import { useEffect, useRef } from 'react';
import { THEME_PRESETS, applyTheme, findActiveScheduleRule, type ThemeScheduleRule } from '../lib/themes';
import { useUIStore } from '../stores';

/** 计算下一个需要触发评估的时间点（所有规则未来7天内的开始/结束时间） */
function getNextTriggerDate(rules: ThemeScheduleRule[], now = new Date()): Date | null {
  const candidates: number[] = [];
  const base = new Date(now);
  base.setHours(0, 0, 0, 0);

  for (const rule of rules) {
    if (!rule.enabled) continue;
    for (let offset = 0; offset < 8; offset++) {
      const d = new Date(base);
      d.setDate(d.getDate() + offset);

      if (rule.weekdays.includes(d.getDay())) {
        const [sh, sm] = rule.startTime.split(':').map(Number);
        const start = new Date(d);
        start.setHours(sh, sm, 0, 0);
        if (start > now) candidates.push(start.getTime());

        const [eh, em] = rule.endTime.split(':').map(Number);
        const end = new Date(d);
        end.setHours(eh, em, 0, 0);
        if (end > now) candidates.push(end.getTime());
      }
    }
  }

  if (candidates.length === 0) return null;
  return new Date(Math.min(...candidates));
}

export function useThemeScheduler(enabled: boolean) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 记录当前由调度控制的主题 ID；null 表示当前是用户手动控制 */
  const schedulerRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      if (schedulerRef.current !== null) {
        // 调度关闭时恢复到用户保存的主题
        const state = useUIStore.getState();
        const { themeId, customTheme } = state;
        if (themeId === 'custom' && customTheme) {
          applyTheme('custom', customTheme);
        } else {
          const preset = THEME_PRESETS.find((t) => t.id === themeId) ?? THEME_PRESETS[0];
          applyTheme(preset.id, preset.vars);
        }
        schedulerRef.current = null;
      }
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    const evaluateAndApply = () => {
      const state = useUIStore.getState();
      const rules = state.themeScheduleRules.filter((r) => r.enabled);
      const activeRule = findActiveScheduleRule(rules);

      if (activeRule) {
        // 有规则生效：如果调度主题跟当前已应用的不同，就切换
        if (schedulerRef.current === activeRule.themeId) return;
        const preset = THEME_PRESETS.find((t) => t.id === activeRule.themeId);
        if (preset) {
          applyTheme(preset.id, preset.vars);
          schedulerRef.current = activeRule.themeId;
        }
      } else {
        // 无规则生效：如果当前还在调度状态，恢复用户保存的主题
        if (schedulerRef.current === null) return;
        const { themeId, customTheme } = state;
        if (themeId === 'custom' && customTheme) {
          applyTheme('custom', customTheme);
        } else {
          const preset = THEME_PRESETS.find((t) => t.id === themeId) ?? THEME_PRESETS[0];
          applyTheme(preset.id, preset.vars);
        }
        schedulerRef.current = null;
      }
    };

    const scheduleNext = () => {
      const state = useUIStore.getState();
      const rules = state.themeScheduleRules.filter((r) => r.enabled);
      const next = getNextTriggerDate(rules);

      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (!next) return;

      const delay = next.getTime() - Date.now();
      timerRef.current = setTimeout(() => {
        evaluateAndApply();
        scheduleNext();
      }, Math.max(0, delay));
    };

    // 启动时先评估当前状态，然后精确休眠到下一个触发点
    evaluateAndApply();
    scheduleNext();

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled]);
}
