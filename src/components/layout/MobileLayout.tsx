import React, { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { MobileTabBar } from './MobileTabBar';
import { PAGES } from '../../config/pageRegistry';

export const MobileLayout: React.FC = () => {
  const location = useLocation();

  const currentPage = PAGES.find((page) => {
    const expected = page.path === '' ? '/' : `/${page.path}`;
    return location.pathname === expected;
  });

  /* keep-alive，和 AppLayout 同一套逻辑。
   *
   * 移动端尤其需要：底部 tab 就是主要导航，来回切是最高频操作。
   * 每次切都重新挂载的话，列表滚动位置、展开项、输入到一半的内容全丢，
   * 在手机上比桌面更难忍（重新滚回原来的位置要划好几下）。
   *
   * 只挂载访问过的页面，不是一次性挂 29 个 —— 首次进入的开销和原来一样。
   */
  const [mountedIds, setMountedIds] = useState<string[]>(() =>
    currentPage ? [currentPage.id] : []
  );
  const mainRef = useRef<HTMLElement | null>(null);
  const scrollByPath = useRef<Record<string, number>>({});
  const activeKey = currentPage?.path ?? '';

  useEffect(() => {
    if (!currentPage) return;
    setMountedIds((prev) =>
      prev.includes(currentPage.id) ? prev : [...prev, currentPage.id]
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage?.id]);

  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    main.scrollTop = scrollByPath.current[activeKey] ?? 0;
    return () => {
      scrollByPath.current[activeKey] = main.scrollTop;
    };
  }, [activeKey]);

  return (
    <div className="flex h-screen flex-col bg-[var(--bg-body)]">
      <main ref={mainRef} className="mobile-app-main flex-1 overflow-y-auto">
        {!currentPage && <Navigate to="/" replace />}
        {mountedIds.map((id) => {
          const page = PAGES.find((p) => p.id === id);
          if (!page) return null;
          const Page = page.component;
          const isActive = id === currentPage?.id;
          return (
            <div key={id} style={{ display: isActive ? undefined : 'none' }}>
              <Suspense
                fallback={
                  <div className="py-8 text-center text-sm text-[var(--text-muted)]">
                    正在载入页面...
                  </div>
                }
              >
                <Page />
              </Suspense>
            </div>
          );
        })}
      </main>
      <MobileTabBar />
    </div>
  );
};
