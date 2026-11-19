import React, { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { DesktopNav } from './DesktopNav';
import { AIChatPanel } from './AIChatPanel';
import { MobileLayout } from './MobileLayout';
import { useUIStore } from '../../stores';
import { PAGES } from '../../config/pageRegistry';
import { useHashSync } from '../../hooks/useHashSync';
import { GlobalAmbientSoundController } from '../pomodoro/GlobalAmbientSoundController';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { TodoReminderPopup } from './TodoReminderPopup';
import { UnderConstructionBanner } from '../shared/UnderConstruction';
import { IS_DESKTOP_CLIENT } from '../../lib/clientContext';

interface AppLayoutProps {
  storesReady?: boolean;
}

type PageDescriptor = (typeof PAGES)[number];

/**
 * 页面容器单独 memo。
 *
 * keep-alive 下，只要 AppLayout 因路由或 store 重渲染，所有已挂载页面都会跟着
 * 重渲染；字幕转录王、视频站这类页面数据量很大，隐藏页重算一次就能卡住主线程。
 * 这里按 page 和 isActive 做浅比较：切页时只让离开/进入的两页重渲染，其余隐藏页保持不动。
 */
const PageContent = React.memo(function PageContent({ page }: { page: PageDescriptor }) {
  const Page = page.component;
  return (
    <Suspense
      fallback={
        <div className="py-10 text-center text-sm text-[var(--text-muted)]">
          正在载入页面...
        </div>
      }
    >
      <Page />
    </Suspense>
  );
});

const PagePane: React.FC<{ page: PageDescriptor; isActive: boolean }> = ({ page, isActive }) => (
  <div style={{ display: isActive ? undefined : 'none' }}>
    <PageContent page={page} />
  </div>
);

export const AppLayout: React.FC<AppLayoutProps> = ({ storesReady = true }) => {
  const { fontSize, compactMode } = useUIStore();
  const isMobile = useIsMobile();
  const location = useLocation();
  useHashSync();

  // 当前路由对应的页面；标了 dev 的加一条「施工中」提示。
  // 侧边栏的小圆点只有 1.5px，进到页面里再提示一次才说得清
  // 「这页的数据可能不完整」。
  const currentPage = PAGES.find((page) => {
    const expected = page.path === '' ? '/' : `/${page.path}`;
    return location.pathname === expected;
  });

  /* ── keep-alive：访问过的页面保持挂载 ──
   *
   * 原来用 <Routes> + <Route element={<Page />}>，切 tab 时组件被卸载，
   * 再切回来是全新实例：滚动位置归零、展开的面板收起、填了一半的表单清空。
   * 用起来像「每次点菜单都在刷新页面」。
   *
   * 现在只挂载「访问过的」页面，切走时 display:none 而不是销毁 DOM。
   * 不一次性挂 29 个页面（那会把全部 lazy chunk 都拉下来），
   * 而是访问一个加一个 —— 首次进入的开销和原来一样。
   *
   * 副作用：页面的 setInterval / 事件订阅在隐藏后仍然活着。
   * 这是有意的 —— 计时器、任务轮询本来就应该跨页面继续跑，
   * 切走就停反而会让番茄钟中断。
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

  // 离场时记下滚动位置，入场时恢复。
  // 用 useLayoutEffect：在浏览器绘制前设好 scrollTop，避免闪一下顶部再跳。
  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    main.scrollTop = scrollByPath.current[activeKey] ?? 0;
    return () => {
      scrollByPath.current[activeKey] = main.scrollTop;
    };
  }, [activeKey]);

  if (isMobile && !IS_DESKTOP_CLIENT) {
    return (
      <>
        <GlobalAmbientSoundController enabled={storesReady} />
        <TodoReminderPopup />
        <MobileLayout />
      </>
    );
  }

  return (
    <div
      className="flex flex-col h-screen"
      data-font-size={fontSize}
      data-compact={compactMode ? 'true' : 'false'}
      data-client={IS_DESKTOP_CLIENT ? 'desktop-exe' : 'web'}
    >
      <GlobalAmbientSoundController enabled={storesReady} />
      <TodoReminderPopup />
      <div className="flex-1 m-1 md:m-2 wood-texture rounded-lg p-1 md:p-2 overflow-hidden flex flex-col">
        <div className="flex-1 paper-surface flex flex-col overflow-hidden">
          <Header />
          {IS_DESKTOP_CLIENT && <DesktopNav />}
          <div className="app-content-row flex flex-1 overflow-hidden">
            {!IS_DESKTOP_CLIENT && <Sidebar />}
            <main ref={mainRef} className="app-main min-w-0 flex-1 overflow-y-auto">
              {currentPage?.dev && (
                <div className="px-3 pt-3 md:px-4">
                  <UnderConstructionBanner label={currentPage.label} />
                </div>
              )}
              {!currentPage && <Navigate to="/" replace />}
              {mountedIds.map((id) => {
                const page = PAGES.find((p) => p.id === id);
                if (!page) return null;
                return <PagePane key={id} page={page} isActive={id === currentPage?.id} />;
              })}
            </main>
            <AIChatPanel />
          </div>
        </div>
      </div>
    </div>
  );
};
