import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';

type ScrubPointEvent = React.MouseEvent<Element> | React.TouchEvent<Element> | MouseEvent | TouchEvent;

function getClientX(event: ScrubPointEvent): number | null {
  if ('touches' in event) {
    return event.touches[0]?.clientX ?? null;
  }

  return event.clientX;
}

function getRatioFromClientX(clientX: number, rect: DOMRect): number {
  if (rect.width <= 0) return 0;
  return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
}

interface UseVideoProgressScrubberOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoContainerRef: React.RefObject<HTMLDivElement | null>;
  duration: number;
  onProgressChange: (time: number) => void;
}

export function useVideoProgressScrubber({
  videoRef,
  videoContainerRef,
  duration,
  onProgressChange,
}: UseVideoProgressScrubberOptions) {
  const progressBarRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);
  const [playerWidth, setPlayerWidth] = useState(800);

  const seekToClientX = useCallback((clientX: number, rect: DOMRect) => {
    if (!duration || !videoRef.current) return;

    const next = getRatioFromClientX(clientX, rect) * duration;
    videoRef.current.currentTime = next;
    onProgressChange(next);
  }, [duration, onProgressChange, videoRef]);

  const startScrub = useCallback((event: React.MouseEvent<Element> | React.TouchEvent<Element>) => {
    event.stopPropagation();
    if ('preventDefault' in event) event.preventDefault();
    if (!duration) return;

    const clientX = getClientX(event);
    if (clientX === null) return;

    setDragging(true);
    seekToClientX(clientX, event.currentTarget.getBoundingClientRect());
  }, [duration, seekToClientX]);

  const updateHover = useCallback((event: React.MouseEvent<Element>) => {
    if (!duration) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const containerRect = videoContainerRef.current?.getBoundingClientRect();
    setHoverTime(getRatioFromClientX(event.clientX, rect) * duration);
    setPlayerWidth(containerRect?.width ?? 800);
    setHoverX(event.clientX - (containerRect?.left ?? 0));
  }, [duration, videoContainerRef]);

  const clearHover = useCallback(() => setHoverTime(null), []);

  useEffect(() => {
    if (!dragging) return;

    const handleMove = (event: MouseEvent | TouchEvent) => {
      event.preventDefault();
      const bar = progressBarRef.current;
      const clientX = getClientX(event);
      if (!bar || clientX === null) return;

      seekToClientX(clientX, bar.getBoundingClientRect());
    };
    const stopScrub = () => setDragging(false);

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', stopScrub);
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', stopScrub);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', stopScrub);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', stopScrub);
    };
  }, [dragging, seekToClientX]);

  return {
    progressBarRef,
    hoverTime,
    hoverX,
    playerWidth,
    startScrub,
    updateHover,
    clearHover,
  };
}
