import { useCallback, useEffect, useRef, useState } from 'react';

const MIN_PLAYLIST_WIDTH = 280;
const MAX_PLAYLIST_WIDTH = 560;

export function usePlaylistResize(initialWidth = 360) {
  const resizeRef = useRef({ active: false, startX: 0, startWidth: initialWidth });
  const [width, setWidth] = useState(initialWidth);

  const startResize = useCallback((clientX: number) => {
    resizeRef.current = { active: true, startX: clientX, startWidth: width };
  }, [width]);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!resizeRef.current.active) return;
      const delta = resizeRef.current.startX - e.clientX;
      setWidth(Math.max(MIN_PLAYLIST_WIDTH, Math.min(MAX_PLAYLIST_WIDTH, resizeRef.current.startWidth + delta)));
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    };
    const handleUp = () => {
      resizeRef.current.active = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

  return { width, startResize };
}
