import { describe, expect, it } from 'vitest';
import {
  ALLOWED_POMODORO_ROUNDS,
  clampToAllowedRounds,
  getAllowedPomodoroRounds,
  getPlannedMinutesForRounds,
  inferAllowedRoundsFromDuration,
} from '../lib/pomodoroPlanning';

const configs = [
  { name: '默认 25/5/15/4', c: { workDuration: 25, shortBreakDuration: 5, longBreakDuration: 15, longBreakInterval: 4 } },
  { name: '50/10/30/4', c: { workDuration: 50, shortBreakDuration: 10, longBreakDuration: 30, longBreakInterval: 4 } },
  { name: '25/5/15/2', c: { workDuration: 25, shortBreakDuration: 5, longBreakDuration: 15, longBreakInterval: 2 } },
  { name: '25/5/15/6', c: { workDuration: 25, shortBreakDuration: 5, longBreakDuration: 15, longBreakInterval: 6 } },
  { name: '30/5/20/5', c: { workDuration: 30, shortBreakDuration: 5, longBreakDuration: 20, longBreakInterval: 5 } },
];

/**
 * 这两个函数是「改时间推数量」和「改数量推时间」的两条腿。
 * 它们必须互为逆运算 —— 否则用户在两个输入之间来回动一次，
 * 数值就会漂移（选 6 个 → 时间算出来 → 又推回 4 个）。
 */
describe('番茄钟轮次与时长互逆', () => {
  for (const { name, c } of configs) {
    it(`${name}: 每个可选轮次往返后不变`, () => {
      const bad: string[] = [];
      for (const rounds of getAllowedPomodoroRounds(c.longBreakInterval)) {
        const planned = getPlannedMinutesForRounds(rounds, c);
        const back = inferAllowedRoundsFromDuration(planned, c);
        if (back !== rounds) bad.push(`${rounds}个(${planned}分) -> ${back}个`);
      }
      expect(bad, bad.join('; ')).toEqual([]);
    });
  }

  it('默认配置下可选档位与历史行为一致 [1,2,3,4,6,7,8]', () => {
    expect(getAllowedPomodoroRounds(4)).toEqual([1, 2, 3, 4, 6, 7, 8]);
    expect(ALLOWED_POMODORO_ROUNDS).toEqual([1, 2, 3, 4, 6, 7, 8]);
  });

  it('跳过「长休息间隔 + 1」这一档（避免不完整周期）', () => {
    for (let interval = 1; interval <= 10; interval += 1) {
      const allowed = getAllowedPomodoroRounds(interval);
      expect(allowed, `interval=${interval}`).not.toContain(interval + 1);
      for (let n = 1; n <= interval; n += 1) {
        expect(allowed, `interval=${interval} 缺 ${n}`).toContain(n);
      }
    }
  });

  it('任意 longBreakInterval 的初始值都能落在下拉列表里', () => {
    // 「新建待办时番茄钟数量显示空白」那个 bug 的回归测试：
    // 初始值取 longBreakInterval，而下拉原本硬编码 [1,2,3,4,6,7,8]，
    // interval=5/9/10 时初始值不在列表里。
    const missing: string[] = [];
    for (let interval = 1; interval <= 10; interval += 1) {
      const allowed = getAllowedPomodoroRounds(interval);
      const initial = clampToAllowedRounds(interval, interval);
      if (!allowed.includes(initial)) missing.push(`interval=${interval} 初始值 ${initial}`);
    }
    expect(missing, missing.join('; ')).toEqual([]);
  });

  it('clampToAllowedRounds 把任意值收到不超过它的最大档位', () => {
    expect(clampToAllowedRounds(5, 4)).toBe(4);
    expect(clampToAllowedRounds(9, 4)).toBe(8);
    expect(clampToAllowedRounds(0, 4)).toBe(1);
    expect(clampToAllowedRounds(100, 4)).toBe(8);
  });
});
