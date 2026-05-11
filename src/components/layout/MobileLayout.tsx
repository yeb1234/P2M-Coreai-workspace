import React, { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { MobileTabBar } from './MobileTabBar';
import { PAGES } from '../../config/pageRegistry';

export const MobileLayout: React.FC = () => {
  return (
    <div className="flex h-screen flex-col bg-[var(--bg-body)]">
      <main className="mobile-app-main flex-1 overflow-y-auto">
        <Suspense fallback={<div className="py-8 text-center text-sm text-[var(--text-muted)]">正在载入页面...</div>}>
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
      <MobileTabBar />
    </div>
  );
};
