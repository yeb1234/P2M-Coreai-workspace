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
  const bodySelectRef = useRef<{ applied: boolean; previous: string }>({
    applied: false,
    previous: '',
  });
  const [width, setWidth] = useState(initialWidth);

  useEffect(() => {
    const id = setTimeout(() => {
      setWidth(initialWidth);
      liveRef.current = initialWidth;
    }, 0);
    return () => clearTimeout(id);
  }, [initialWidth]);

  const startResize = useCallback((clientX: number) => {
    if (!dragRef.current.active) {
      // 记录拖动前的 body 状态，结束时原样恢复；不能直接写空字符串，
      // 否则会把别的组件（如笔记页）留下的 user-select 状态覆盖掉。
      bodySelectRef.current = {
        applied: false,
        previous: document.body.style.userSelect,
      };
    }
    dragRef.current = { active: true, startX: clientX, startWidth: liveRef.current };
  }, []);

  const restoreBodyState = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    document.body.style.cursor = '';
    if (bodySelectRef.current.applied) {
      document.body.style.userSelect = bodySelectRef.current.previous;
      bodySelectRef.current = { applied: false, previous: '' };
    }
  }, []);

  useEffect(() => {
    const getClientX = (e: MouseEvent | TouchEvent) => {
      if ('touches' in e) return e.touches[0]?.clientX ?? e.changedTouches[0]?.clientX ?? 0;
      return e.clientX;
    };
    const handleUp = () => {
      if (!dragRef.current.active && !bodySelectRef.current.applied) return;
      dragRef.current.active = false;
      setWidth(liveRef.current);
      onWidthChange?.(liveRef.current);
      onResizeEnd?.(rawLiveRef.current);
      restoreBodyState();
    };
    const handleMove = (e: MouseEvent | TouchEvent) => {
      if (!dragRef.current.active) return;
      // 鼠标在窗口外松开时，window 收不到 mouseup；下一次 mousemove 的
      // buttons=0 就是最可靠的“已经松开”信号。触摸同理，touches 为空即结束。
      if ('buttons' in e && e.buttons === 0) {
        handleUp();
        return;
      }
      if ('touches' in e && e.touches.length === 0) {
        handleUp();
        return;
      }
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
      if (!bodySelectRef.current.applied) {
        bodySelectRef.current.applied = true;
        document.body.style.userSelect = 'none';
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') handleUp();
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    window.addEventListener('blur', handleUp);
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', handleUp);
    window.addEventListener('touchcancel', handleUp);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
      window.removeEventListener('blur', handleUp);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleUp);
      window.removeEventListener('touchcancel', handleUp);
      document.removeEventListener('visibilitychange', handleVisibility);
      restoreBodyState();
    };
  }, [minWidth, maxWidth, side, onWidthChange, onResizeEnd, restoreBodyState]);

  return { width, startResize };
}
