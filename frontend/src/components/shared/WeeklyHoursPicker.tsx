import React from 'react';

/**
 * 学习投入时间选择器。
 *
 * 后端和档案里存的一直是「每周小时数」（weekly_hours），但用户实际是按天做计划的：
 * 「每天 2 小时」比「每周 14 小时」直观。这里用每天 1/2/3/4/6/8/10 小时的快捷档，
 * 选中后换算成每周存进去；下面的每周输入框保留，方便填非整档的值（比如 12.5）。
 */
export const DAILY_HOURS_PRESETS = [1, 2, 3, 4, 6, 8, 10] as const;
export const MAX_DAILY_HOURS = DAILY_HOURS_PRESETS[DAILY_HOURS_PRESETS.length - 1];
export const MAX_WEEKLY_HOURS = MAX_DAILY_HOURS * 7;

interface WeeklyHoursPickerProps {
  weeklyHours: number;
  onChange: (hours: number) => void;
  className?: string;
}

export const WeeklyHoursPicker: React.FC<WeeklyHoursPickerProps> = ({ weeklyHours, onChange, className }) => {
  const dailyHours = weeklyHours > 0 ? weeklyHours / 7 : 0;

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-1.5">
        {DAILY_HOURS_PRESETS.map((hours) => {
          const active = Math.abs(dailyHours - hours) < 0.01;
          return (
            <button
              key={hours}
              type="button"
              onClick={() => onChange(hours * 7)}
              className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                active
                  ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                  : 'border-[var(--border-light)] bg-white text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
              }`}
            >
              {hours} 小时/天
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--text-secondary)]">
        <span>≈ 每周</span>
        <input
          type="number"
          min={1}
          max={MAX_WEEKLY_HOURS}
          step={1}
          value={weeklyHours || ''}
          onChange={(event) => onChange(Math.min(MAX_WEEKLY_HOURS, Math.max(0, Number(event.target.value) || 0)))}
          className="w-16 rounded-md border border-[var(--border-light)] bg-white px-2 py-1 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          aria-label="每周可投入小时"
        />
        <span>小时</span>
        {dailyHours > 0 && (
          <span className="text-[var(--text-muted)]">（每天约 {Number(dailyHours.toFixed(1))} 小时）</span>
        )}
      </div>
    </div>
  );
};
