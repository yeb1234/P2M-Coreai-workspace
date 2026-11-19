import React, { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useUIStore } from '../../stores';
import { PAGES } from '../../config/pageRegistry';

/**
 * 桌面壳的顶部快捷导航。
 *
 * 桌面模式不再显示侧边栏，但入口必须覆盖所有已经交付的真实页面，
 * 否则新增功能在桌面端只能靠手输 URL 才能进。
 * dev: true 的施工中页面仍然排除；等页面去掉 dev 标记后会自动出现在这里。
 * 仍然走同一个 activeView/hash 路由，所以和浏览器版完全同源同逻辑。
 */
export const DesktopNav: React.FC = () => {
  const activeView = useUIStore((s) => s.activeView);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const navOrder = useUIStore((s) => s.navOrder);
  const hiddenNavItems = useUIStore((s) => s.hiddenNavItems);
  const location = useLocation();

  const items = useMemo(() => {
    const available = PAGES.filter(
      (page) => !page.dev && !hiddenNavItems.includes(page.id),
    );
    const ordered = navOrder
      .map((id) => available.find((page) => page.id === id))
      .filter((page): page is (typeof PAGES)[number] => Boolean(page));
    const tail = available.filter((page) => !navOrder.includes(page.id));
    return [...ordered, ...tail];
  }, [hiddenNavItems, navOrder]);

  return (
    <nav
      aria-label="桌面快捷导航"
      className="shrink-0 overflow-x-auto border-b border-[var(--border-light)] bg-[var(--bg-card)] px-3 py-2 md:px-4"
    >
      <div className="flex min-w-max items-center gap-1">
        {items.map((page) => {
          const isActive = activeView === page.id || location.pathname === `/${page.path}`;
          return (
            <button
              key={page.id}
              type="button"
              onClick={() => setActiveView(page.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-[var(--accent-bg)] text-[var(--accent)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-accent)] hover:text-[var(--text-primary)]'
              }`}
            >
              <span className={isActive ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}>
                {page.icon}
              </span>
              {page.label}
            </button>
          );
        })}
        <span className="ml-1 select-none rounded border border-[var(--border-light)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
          TOP
        </span>
      </div>
    </nav>
  );
};
