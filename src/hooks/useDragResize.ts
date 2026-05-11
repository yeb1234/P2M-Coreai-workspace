import { useCallback, useEffect, useRef, useState } from 'react';

interface UseDragResizeOptions {
  initialWidth: number;
  minWidth: number;
  maxWidth: number;
  /** 'left' = resize from left edge (panel on right side), 'right' = resize from right edge (panel on left side) */
  side: 'left' | 'right';
  onWidthChange?: (width: number) => void;
  onResizeEnd?: (width: number) => void;
}

export function useDragResize({ initialWidth, minWidth, maxWidth, side, onWidthChange, onResizeEnd }: UseDragResizeOptions) {
  const dragRef = useRef({ active: false, startX: 0, startWidth: initialWidth });
  const frameRef = useRef<number | null>(null);
  const liveRef = useRef(initialWidth);
  const rawLiveRef = useRef(initialWidth);
  const [width, setWidth] = useState(initialWidth);

  useEffect(() => {
    setWidth(initialWidth);
    liveRef.current = initialWidth;
  }, [initialWidth]);

  const startResize = useCallback((clientX: number) => {
    dragRef.current = { active: true, startX: clientX, startWidth: liveRef.current };
  }, []);

  useEffect(() => {
    const getClientX = (e: MouseEvent | TouchEvent) => {
      if ('touches' in e) return e.touches[0]?.clientX ?? e.changedTouches[0]?.clientX ?? 0;
      return e.clientX;
    };
    const handleMove = (e: MouseEvent | TouchEvent) => {
      if (!dragRef.current.active) return;
      e.preventDefault();
      const clientX = getClientX(e);
      const delta = side === 'left'
        ? dragRef.current.startX - clientX
        : clientX - dragRef.current.startX;
      rawLiveRef.current = Math.round(dragRef.current.startWidth + delta);
      liveRef.current = Math.max(minWidth, Math.min(maxWidth, rawLiveRef.current));
      if (frameRef.current === null) {
        frameRef.current = window.requestAnimationFrame(() => {
          frameRef.current = null;
          setWidth(liveRef.current);
        });
      }
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    };
    const handleUp = () => {
      dragRef.current.active = false;
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      setWidth(liveRef.current);
      onWidthChange?.(liveRef.current);
      onResizeEnd?.(rawLiveRef.current);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleUp);
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [minWidth, maxWidth, side, onWidthChange, onResizeEnd]);

  return { width, startResize };
}
