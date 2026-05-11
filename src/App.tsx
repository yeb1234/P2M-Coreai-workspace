import { useState, useEffect } from 'react';
import { HashRouter } from 'react-router-dom';
import { AppLayout } from './components/layout';
import { AuthPage } from './components/auth/AuthPage';
import { useCrossModuleSync } from './hooks';
import { registerAllPlugins } from './plugins';
import { useAuthStore, useNotificationStore } from './stores';
import { useRehydrateStores } from './hooks/useRehydrateStores';
import { useApplyStoredTheme } from './hooks/useApplyStoredTheme';

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
  useApplyStoredTheme(initialized && Boolean(currentUser));

  useEffect(() => {
    if (initialized && currentUser) {
      queueMicrotask(() => {
        setShowWelcome(true);
        setReady(false);
      });
    } else if (initialized && !currentUser) {
      queueMicrotask(() => setReady(true));
    }
  }, [initialized, currentUser]);

  useCrossModuleSync();

  // Listen for token expiration events from authFetch
  useEffect(() => {
    const onExpired = () => {
      useNotificationStore.getState().addNotification({
        type: 'system',
        title: '登录已过期',
        message: '你的登录状态已失效，请重新登录',
      });
      useAuthStore.getState().logout();
    };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

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
