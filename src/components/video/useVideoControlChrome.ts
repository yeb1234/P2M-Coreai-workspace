import { useCallback, useEffect, useRef, useState } from 'react';

export function useVideoControlChrome(isPlaying: boolean) {
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);

  const resetHideTimer = useCallback(() => {
    setShowControls(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 3000);
  }, [isPlaying]);

  useEffect(() => {
    if (!isPlaying) {
      queueMicrotask(() => setShowControls(true));
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    }
  }, [isPlaying]);

  useEffect(() => {
    const handler = (event: MouseEvent | TouchEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('[data-speed-menu]') && !target.closest('[data-speed-btn]')) {
        setShowSpeedMenu(false);
      }
      if (!target.closest('[data-subtitle-menu]') && !target.closest('[data-subtitle-btn]')) {
        setShowSubtitleMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, []);

  useEffect(() => () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
  }, []);

  return {
    showControls,
    setShowControls,
    showSpeedMenu,
    setShowSpeedMenu,
    showSubtitleMenu,
    setShowSubtitleMenu,
    resetHideTimer,
  };
}
