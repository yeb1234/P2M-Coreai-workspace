import { BarChart3 } from 'lucide-react';
import type { Plugin } from '../types/plugin';
import { QuickStatsSummary } from '../components/dashboard/summaries/QuickStatsSummary';

export const quickStatsPlugin: Plugin = {
  metadata: {
    id: 'quick-stats',
    name: '今日概览',
    icon: <BarChart3 size={20} />,
    description: '今日工作数据一览',
    defaultPosition: 3,
    color: 'text-[#06b6d4]',
    defaultSize: 'small',
    summaryComponent: QuickStatsSummary,
  },
};
