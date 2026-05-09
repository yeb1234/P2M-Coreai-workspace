import { useState, useEffect } from 'react';
import { HashRouter } from 'react-router-dom';
import { AppLayout } from './components/layout';
import { AuthPage } from './components/auth/AuthPage';
import { useCrossModuleSync } from './hooks';
import { registerAllPlugins } from './plugins';
import { useAuthStore, useUIStore } from './stores';
import { THEME_PRESETS, applyTheme } from './lib/themes';
import { useRehydrateStores } from './hooks/useRehydrateStores';

registerAllPlugins();

function WelcomeScreen({ username, onDone }: { username: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 100);
    return () => clearTimeout(t);
  }, [onDone]);

  const hour = new Date().getHours();
  const greeting = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-body)' }}>
      <div className="text-center animate-pulse">
        <h1 className="text-4xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>灵境</h1>
        <p className="text-lg" style={{ color: 'var(--text-secondary)' }}>{greeting}，{username}</p>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>正在加载你的工作台...</p>
      </div>
    </div>
  );
}

function App() {
  const { currentUser, initialized, init } = useAuthStore();
  const [showWelcome, setShowWelcome] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    init();
  }, [init]);

  // Rehydrate all stores with user-prefixed keys after login
  useRehydrateStores(currentUser);

  // Apply theme when user logs in
  useEffect(() => {
    if (initialized && currentUser) {
      queueMicrotask(() => {
        setShowWelcome(true);
        setReady(false);
      });

      // Small delay to let stores rehydrate first
      const t = setTimeout(() => {
        const { themeId, customTheme } = useUIStore.getState();
        if (themeId === 'custom' && customTheme) {
          applyTheme('custom', customTheme);
        } else {
          const preset = THEME_PRESETS.find((th) => th.id === themeId);
          if (preset) applyTheme(preset.id, preset.vars);
        }
      }, 100);
      return () => clearTimeout(t);
    } else if (initialized && !currentUser) {
      queueMicrotask(() => setReady(true));
    }
  }, [initialized, currentUser]);

  useCrossModuleSync();

  if (!initialized) return null;

  return (
    <HashRouter>
      {!currentUser ? (
        <AuthPage />
      ) : showWelcome ? (
        <WelcomeScreen
          username={currentUser}
          onDone={() => {
            setShowWelcome(false);
            setReady(true);
          }}
        />
      ) : ready ? (
        <AppLayout />
      ) : null}
    </HashRouter>
  );
}

export default App;
