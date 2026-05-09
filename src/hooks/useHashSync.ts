import { useEffect } from 'react';
import { useUIStore } from '../stores';
import { PATH_VIEW } from '../config/pageRegistry';

export function useHashSync() {
  useEffect(() => {
    const syncFromURL = () => {
      const hash = window.location.hash.replace(/^#\/?/, '');
      const viewId = PATH_VIEW[hash];
      if (viewId) {
        useUIStore.setState({ activeView: viewId });
      }
    };

    syncFromURL();
    window.addEventListener('hashchange', syncFromURL);
    return () => window.removeEventListener('hashchange', syncFromURL);
  }, []);
}
