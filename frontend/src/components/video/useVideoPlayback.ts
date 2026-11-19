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
  onPlaybackError?: (message: string) => void;
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
  onPlaybackError,
}: UseVideoPlaybackInput) {
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused || v.ended) {
      void v.play().catch((error: unknown) => {
        const name = error instanceof DOMException ? error.name : '';
        const message = name === 'NotAllowedError'
          ? '播放被浏览器拦截，请再点一次播放按钮。'
          : name === 'AbortError'
            ? '播放已中断，请再点一次。'
            : '播放启动失败，请稍后重试。';
        onPlaybackError?.(message);
      });
    } else {
      v.pause();
    }
  }, [videoRef, onPlaybackError]);

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
    const video = videoRef.current as (HTMLVideoElement & {
      webkitEnterFullscreen?: () => void;
    }) | null;
    if (!el && !video) return;

    if (document.fullscreenElement) {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
      return;
    }

    // 标准 Fullscreen API：桌面 Chromium / Android Chrome 走这条。
    if (el?.requestFullscreen) {
      el.requestFullscreen()
        .then(() => setIsFullscreen(true))
        .catch(() => {
          // iOS Safari 对普通容器不支持，退到 video 元素的原生全屏。
          if (video?.webkitEnterFullscreen) {
            try {
              setIsFullscreen(true);
              video.webkitEnterFullscreen();
            } catch {
              setIsFullscreen(false);
            }
          }
        });
      return;
    }

    // iPhone Safari 没有容器级 requestFullscreen，只能让 video 自己进原生播放器。
    if (video?.webkitEnterFullscreen) {
      try {
        setIsFullscreen(true);
        video.webkitEnterFullscreen();
      } catch {
        setIsFullscreen(false);
      }
    }
  }, [setIsFullscreen, videoContainerRef, videoRef]);

  return {
    togglePlay,
    seekBy,
    toggleMute,
    handleVolumeChange,
    togglePip,
    toggleFullscreen,
  };
}
