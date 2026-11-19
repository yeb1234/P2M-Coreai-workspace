import React, { useMemo } from 'react';
import { CalendarHeart, Gift, Star, Sun } from 'lucide-react';

interface ImportantDate {
  label: string;
  month: number;
  day: number;
  icon: React.ReactNode;
  color: string;
}

const IMPORTANT_DATES: ImportantDate[] = [
  { label: '元旦', month: 1, day: 1, icon: <Sun size={14} />, color: '#f59e0b' },
  { label: '情人节', month: 2, day: 14, icon: <CalendarHeart size={14} />, color: '#ec4899' },
  { label: '妇女节', month: 3, day: 8, icon: <Star size={14} />, color: '#8b5cf6' },
  { label: '劳动节', month: 5, day: 1, icon: <Sun size={14} />, color: '#16a34a' },
  { label: '儿童节', month: 6, day: 1, icon: <Gift size={14} />, color: '#2563eb' },
  { label: '建党节', month: 7, day: 1, icon: <Star size={14} />, color: '#dc3545' },
  { label: '中秋节', month: 9, day: 17, icon: <Sun size={14} />, color: '#f59e0b' },
  { label: '国庆节', month: 10, day: 1, icon: <Star size={14} />, color: '#dc3545' },
  { label: '平安夜', month: 12, day: 24, icon: <Gift size={14} />, color: '#16a34a' },
  { label: '圣诞节', month: 12, day: 25, icon: <Gift size={14} />, color: '#dc3545' },
];

function daysUntil(month: number, day: number): number {
  const now = new Date();
  const thisYear = now.getFullYear();
  let target = new Date(thisYear, month - 1, day);
  if (target < now) {
    target = new Date(thisYear + 1, month - 1, day);
  }
  return Math.ceil((target.getTime() - now.getTime()) / 86400000);
}

export const ImportantDates: React.FC = () => {
  const upcoming = useMemo(() => {
    return IMPORTANT_DATES
      .map((d) => ({ ...d, daysLeft: daysUntil(d.month, d.day) }))
      .sort((a, b) => a.daysLeft - b.daysLeft)
      .slice(0, 5);
  }, []);

  return (
    <div className="relative">
      {/* 右边缘渐隐只在窄屏加：桌面宽度够，五个节日放得下；
          移动端放不下，渐隐是「还能往右滑」的唯一提示 ——
          否则最后一项被硬切一半，看着像渲染 bug。 */}
      <span className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 rounded-r-[var(--r-2)] bg-gradient-to-l from-[var(--bg-elevated)] to-transparent md:hidden" />
      <div className="flex items-center gap-3 overflow-x-auto rounded-[var(--r-2)] border border-[var(--border-light)] bg-[var(--bg-elevated)] px-4 py-2.5">
        <span className="text-xs font-medium whitespace-nowrap text-[var(--text-muted)]">重要日子</span>
      <div className="h-3 w-px bg-[var(--border-light)]" />
      {upcoming.map((item) => (
        <div
          key={item.label}
          className="flex items-center gap-1.5 whitespace-nowrap"
        >
          <span style={{ color: item.color }}>{item.icon}</span>
          <span className="text-xs text-[var(--text-secondary)]">{item.label}</span>
          <span className={`text-xs font-medium ${
            item.daysLeft === 0 ? 'text-[var(--accent)]' : item.daysLeft <= 7 ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]'
          }`}>
            {item.daysLeft === 0 ? '今天' : `${item.daysLeft}天`}
          </span>
        </div>
        ))}
      </div>
    </div>
  );
};
