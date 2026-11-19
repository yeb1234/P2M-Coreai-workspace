import { StickyNote } from 'lucide-react';
import type { Plugin } from '../types/plugin';
import { RecentNotesSummary } from '../components/dashboard/summaries/RecentNotesSummary';

export const recentNotesPlugin: Plugin = {
  metadata: {
    id: 'recent-notes',
    name: '最近便签',
    icon: <StickyNote size={20} />,
    description: '最近编辑的便签',
    defaultPosition: 4,
    color: 'text-[var(--warn)]',
    defaultSize: 'small',
    summaryComponent: RecentNotesSummary,
  },
};
