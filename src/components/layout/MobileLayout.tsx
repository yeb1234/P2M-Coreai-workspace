import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { MobileTabBar } from './MobileTabBar';
import { PAGES } from '../../config/pageRegistry';

export const MobileLayout: React.FC = () => {
  return (
    <div className="flex flex-col h-screen bg-[#f5f0e8]">
      <main className="flex-1 overflow-y-auto px-3">
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
      </main>
      <MobileTabBar />
    </div>
  );
};
