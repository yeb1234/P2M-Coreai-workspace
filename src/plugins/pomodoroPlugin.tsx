import { Timer } from 'lucide-react';
import type { Plugin } from '../types/plugin';
import { PomodoroSummary } from '../components/dashboard/summaries/PomodoroSummary';

export const pomodoroPlugin: Plugin = {
  metadata: {
    id: 'pomodoro',
    name: '番茄钟',
    icon: <Timer size={20} />,
    description: '专注工作，高效休息',
    defaultPosition: 2,
    color: 'text-[var(--accent)]',
    defaultSize: 'small',
    summaryComponent: PomodoroSummary,
  },
};
