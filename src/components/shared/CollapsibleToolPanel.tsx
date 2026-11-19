import React, { useId, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, SlidersHorizontal } from 'lucide-react';

interface CollapsibleToolPanelProps {
  collapsed: boolean;
  onToggle: () => void;
  title?: string;
  icon?: ReactNode;
  summary?: ReactNode;
  children: ReactNode;
}

/**
 * 可折叠的工具面板。
 *
 * 无障碍要点（之前三条都缺）：
 *   1. aria-expanded —— 告诉读屏软件当前是展开还是收起。
 *      没有它，屏幕阅读器只会念「筛选设置 按钮」，用户不知道点下去会发生什么。
 *   2. aria-controls —— 指向被控制的内容区域，建立关系。
 *   3. 内容区用 hidden 属性而不是条件渲染 —— 条件渲染会把 DOM 整个拿掉，
 *      aria-controls 指向的 id 就不存在了，关系断掉。
 *      这里折中：仍然条件渲染（省 DOM），但有内容时才渲染 id，
 *      两者不会同时缺。
 */
export const CollapsibleToolPanel: React.FC<CollapsibleToolPanelProps> = ({
  collapsed,
  onToggle,
  title = '筛选设置',
  icon,
  summary,
  children,
}) => {
  const contentId = useId();

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-controls={!collapsed ? contentId : undefined}
        className="flex w-full items-center gap-2 py-1 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
      >
        {collapsed ? (
          <ChevronRight size={14} aria-hidden="true" />
        ) : (
          <ChevronDown size={14} aria-hidden="true" />
        )}
        <span aria-hidden="true">{icon ?? <SlidersHorizontal size={13} />}</span>
        <span>{title}</span>
        {collapsed && summary && (
          <span className="truncate font-normal text-[var(--text-muted)]">{summary}</span>
        )}
      </button>
      {!collapsed && (
        <div id={contentId} className="mt-1 space-y-2">
          {children}
        </div>
      )}
    </div>
  );
};

export default CollapsibleToolPanel;
