import React, { Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { AIChatPanel } from './AIChatPanel';
import { MobileLayout } from './MobileLayout';
import { useUIStore } from '../../stores';
import { PAGES } from '../../config/pageRegistry';
import { useHashSync } from '../../hooks/useHashSync';
import { GlobalAmbientSoundController } from '../pomodoro/GlobalAmbientSoundController';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { TodoReminderPopup } from './TodoReminderPopup';
import { UnderConstructionBanner } from '../shared/UnderConstruction';

interface AppLayoutProps {
  storesReady?: boolean;
}

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

  if (isMobile) {
    return (
      <>
        <GlobalAmbientSoundController enabled={storesReady} />
        <TodoReminderPopup />
        <MobileLayout />
      </>
    );
  }

  return (
    <div className="flex flex-col h-screen" data-font-size={fontSize} data-compact={compactMode ? 'true' : 'false'}>
      <GlobalAmbientSoundController enabled={storesReady} />
      <TodoReminderPopup />
      <div className="flex-1 m-1 md:m-2 wood-texture rounded-lg p-1 md:p-2 overflow-hidden flex flex-col">
        <div className="flex-1 paper-surface flex flex-col overflow-hidden">
          <Header />
          <div className="flex flex-1 overflow-hidden">
            <Sidebar />
            <main className="app-main min-w-0 flex-1 overflow-y-auto">
              {currentPage?.dev && (
                <div className="px-3 pt-3 md:px-4">
                  <UnderConstructionBanner label={currentPage.label} />
                </div>
              )}
              <Suspense fallback={<div className="py-10 text-center text-sm text-[var(--text-muted)]">正在载入页面...</div>}>
                <Routes>
                  {PAGES.map((page) => (
                    <Route
                      key={page.id}
                      path={page.path === '' ? '/' : page.path}
                      element={<page.component />}
                    />
                  ))}
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </main>
            <AIChatPanel />
          </div>
        </div>
      </div>
    </div>
  );
};
