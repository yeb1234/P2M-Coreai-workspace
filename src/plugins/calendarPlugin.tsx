import { Calendar } from 'lucide-react';
import type { Plugin } from '../types/plugin';
import { CalendarSummary } from '../components/dashboard/summaries/CalendarSummary';

export const calendarPlugin: Plugin = {
  metadata: {
    id: 'calendar',
    name: '日历看板',
    icon: <Calendar size={20} />,
    description: '查看和管理您的日程',
    defaultPosition: 1,
    color: 'text-[#7c3aed]',
    defaultSize: 'small',
    summaryComponent: CalendarSummary,
  },
};
