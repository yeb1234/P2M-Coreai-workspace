import React, { type ReactNode } from 'react';
import { ChevronDown, ChevronRight, SlidersHorizontal } from 'lucide-react';

interface CollapsibleToolPanelProps {
  collapsed: boolean;
  onToggle: () => void;
  title?: string;
  icon?: ReactNode;
  summary?: ReactNode;
  children: ReactNode;
}

export const CollapsibleToolPanel: React.FC<CollapsibleToolPanelProps> = ({
  collapsed,
  onToggle,
  title = '筛选设置',
  icon,
  summary,
  children,
}) => (
  <div>
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-2 py-1 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
    >
      {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
      {icon ?? <SlidersHorizontal size={13} />}
      <span>{title}</span>
      {collapsed && summary && <span className="text-[var(--text-muted)] font-normal truncate">{summary}</span>}
    </button>
    {!collapsed && <div className="space-y-2 mt-1">{children}</div>}
  </div>
);
