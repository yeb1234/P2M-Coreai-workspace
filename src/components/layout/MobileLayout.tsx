import React, { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { MobileTabBar } from './MobileTabBar';
import { MobileNavSheet } from './MobileNavSheet';
import { AIChatPanel } from './AIChatPanel';
import { PAGES } from '../../config/pageRegistry';
import { useAIStore, useUIStore } from '../../stores';

export const MobileLayout: React.FC = () => {
  const location = useLocation();
  const { fontSize, compactMode } = useUIStore();
  const chatOpen = useAIStore((s) => s.chatOpen);
  const setChatOpen = useAIStore((s) => s.setChatOpen);
  const [navOpen, setNavOpen] = useState(false);

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
    // 桌面端可能把灵境小助手留在打开状态；手机是整屏浮层，
    // 沿用这个状态会让 App 一打开就被对话盖住，先收起来。
    if (useAIStore.getState().chatOpen) setChatOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!currentPage) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMountedIds((prev) =>
      prev.includes(currentPage.id) ? prev : [...prev, currentPage.id]
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage?.id]);

  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const scrollMap = scrollByPath.current;
    main.scrollTop = scrollMap[activeKey] ?? 0;
    return () => {
      scrollMap[activeKey] = main.scrollTop;
    };
  }, [activeKey]);

  const openAllPages = () => {
    setChatOpen(false);
    setNavOpen(true);
  };

  const toggleAI = () => {
    if (chatOpen) {
      setChatOpen(false);
      return;
    }
    setNavOpen(false);
    setChatOpen(true);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (chatOpen) {
        setChatOpen(false);
        return;
      }
      if (navOpen) setNavOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [chatOpen, navOpen, setChatOpen]);

  return (
    <div
      className="mobile-shell flex h-screen flex-col bg-[var(--bg-body)]"
      data-font-size={fontSize}
      data-compact={compactMode ? 'true' : 'false'}
      data-client="mobile-web"
    >
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
      <MobileTabBar
        allOpen={navOpen}
        chatOpen={chatOpen}
        onOpenAll={openAllPages}
        onToggleAI={toggleAI}
      />
      <MobileNavSheet open={navOpen} onClose={() => setNavOpen(false)} />
      {chatOpen && (
        <div className="mobile-ai-layer">
          <AIChatPanel mobile />
        </div>
      )}
    </div>
  );
};
