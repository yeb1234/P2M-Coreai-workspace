import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { AIChatPanel } from './AIChatPanel';
import { useUIStore } from '../../stores';
import { PAGES } from '../../config/pageRegistry';
import { useHashSync } from '../../hooks/useHashSync';

export const AppLayout: React.FC = () => {
  const { fontSize, compactMode } = useUIStore();
  useHashSync();

  return (
    <div className="flex flex-col h-screen" data-font-size={fontSize} data-compact={compactMode ? 'true' : 'false'}>
      {/* Wood outer frame */}
      <div className="flex-1 m-3 md:m-5 wood-texture rounded-xl p-3 md:p-4 overflow-hidden flex flex-col">
        {/* Paper inner surface */}
        <div className="flex-1 paper-surface flex flex-col overflow-hidden">
          <Header />
          <div className="flex flex-1 overflow-hidden">
            <Sidebar />
            <main className="app-main min-w-0 flex-1 overflow-y-auto">
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
            <AIChatPanel />
          </div>
        </div>
      </div>
    </div>
  );
};
