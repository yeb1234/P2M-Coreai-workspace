import { useCallback } from 'react';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';

interface UseVideoPlaybackInput {
  videoRef: RefObject<HTMLVideoElement | null>;
  videoDuration: number;
  lastVolumeRef: MutableRefObject<number>;
  setProgress: Dispatch<SetStateAction<number>>;
  setVolume: Dispatch<SetStateAction<number>>;
  setIsMuted: Dispatch<SetStateAction<boolean>>;
  videoContainerRef: RefObject<HTMLDivElement | null>;
  setIsFullscreen: Dispatch<SetStateAction<boolean>>;
}

export function useVideoPlayback({
  videoRef,
  videoDuration,
  lastVolumeRef,
  setProgress,
  setVolume,
  setIsMuted,
  videoContainerRef,
  setIsFullscreen,
}: UseVideoPlaybackInput) {
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused || v.ended) {
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [videoRef]);

  const seekBy = useCallback((seconds: number) => {
    const v = videoRef.current;
    if (!v) return;
    const duration = Number.isFinite(v.duration) ? v.duration : videoDuration;
    const next = Math.max(0, Math.min(duration || 0, v.currentTime + seconds));
    v.currentTime = next;
    setProgress(next);
  }, [setProgress, videoDuration, videoRef]);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.muted || v.volume === 0) {
      const restored = lastVolumeRef.current > 0 ? lastVolumeRef.current : 0.6;
      v.volume = restored;
      v.muted = false;
      setVolume(restored);
      setIsMuted(false);
      return;
    }
    lastVolumeRef.current = v.volume;
    v.muted = true;
    setIsMuted(true);
  }, [lastVolumeRef, setIsMuted, setVolume, videoRef]);

  const handleVolumeChange = useCallback((val: number) => {
    const v = videoRef.current;
    if (!v) return;
    const next = Math.max(0, Math.min(1, val));
    v.volume = next;
    if (next > 0) {
      lastVolumeRef.current = next;
      v.muted = false;
    } else {
      v.muted = true;
    }
    setVolume(next);
    setIsMuted(v.muted);
  }, [lastVolumeRef, setIsMuted, setVolume, videoRef]);

  const togglePip = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await v.requestPictureInPicture();
      }
    } catch {
      // Browser may reject PiP requests when unsupported or not user initiated.
    }
  }, [videoRef]);

  const toggleFullscreen = useCallback(() => {
    const el = videoContainerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, [setIsFullscreen, videoContainerRef]);

  return {
    togglePlay,
    seekBy,
    toggleMute,
    handleVolumeChange,
    togglePip,
    toggleFullscreen,
  };
}
