import { useEffect } from 'react';
import { useUIStore } from '../stores';
import { PATH_VIEW } from '../config/pageRegistry';

export function useHashSync() {
  useEffect(() => {
    const syncFromURL = () => {
      const hash = window.location.hash.replace(/^#\/?/, '').split('?')[0];
      const viewId = PATH_VIEW[hash];
      if (viewId) {
        useUIStore.setState({ activeView: viewId });
        return;
      }
      // Lite 裁掉的页面或旧书签：不要让用户停在空白路由，回工作台。
      if (
        hash &&
        !hash.startsWith('mdnotes-window') &&
        !hash.startsWith('asset-registry')
      ) {
        window.location.hash = '/';
      }
    };

    syncFromURL();
    window.addEventListener('hashchange', syncFromURL);
    return () => window.removeEventListener('hashchange', syncFromURL);
  }, []);
}
