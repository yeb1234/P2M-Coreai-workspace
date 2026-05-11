import React, { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
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

export const AppLayout: React.FC = () => {
  const { fontSize, compactMode } = useUIStore();
  const isMobile = useIsMobile();
  useHashSync();

  if (isMobile) {
    return (
      <>
        <GlobalAmbientSoundController />
        <TodoReminderPopup />
        <MobileLayout />
      </>
    );
  }

  return (
    <div className="flex flex-col h-screen" data-font-size={fontSize} data-compact={compactMode ? 'true' : 'false'}>
      <GlobalAmbientSoundController />
      <TodoReminderPopup />
      <div className="flex-1 m-1 md:m-2 wood-texture rounded-lg p-1 md:p-2 overflow-hidden flex flex-col">
        <div className="flex-1 paper-surface flex flex-col overflow-hidden">
          <Header />
          <div className="flex flex-1 overflow-hidden">
            <Sidebar />
            <main className="app-main min-w-0 flex-1 overflow-y-auto">
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
