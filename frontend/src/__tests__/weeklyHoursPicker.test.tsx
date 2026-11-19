import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_DAILY_HOURS,
  MAX_WEEKLY_HOURS,
  WeeklyHoursPicker,
} from '../components/shared/WeeklyHoursPicker';

describe('WeeklyHoursPicker', () => {
  it('keeps the original daily presets and extends to 10 hours', () => {
    const onChange = vi.fn();
    render(<WeeklyHoursPicker weeklyHours={42} onChange={onChange} />);

    for (const hours of [1, 2, 3, 4, 6, 8, 10]) {
      expect(screen.getByRole('button', { name: `${hours} 小时/天` })).toBeTruthy();
    }
    expect(MAX_DAILY_HOURS).toBe(10);
    expect(MAX_WEEKLY_HOURS).toBe(70);
  });

  it('converts the 10-hour preset into 70 weekly hours', () => {
    const onChange = vi.fn();
    render(<WeeklyHoursPicker weeklyHours={42} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '10 小时/天' }));
    expect(onChange).toHaveBeenCalledWith(70);
  });

  it('clamps manually typed weekly hours to 10 hours per day', () => {
    const onChange = vi.fn();
    render(<WeeklyHoursPicker weeklyHours={42} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('每周可投入小时'), { target: { value: '80' } });
    expect(onChange).toHaveBeenCalledWith(70);
  });
});
