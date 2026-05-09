import { useEffect } from 'react';
import { PLAYER_SPEED_STEP, clampPlaybackRate } from './videoPlayerUtils';

interface UseVideoKeyboardShortcutsArgs {
  enabled: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  hasSubtitle: boolean;
  onSeekBy: (seconds: number) => void;
  onVolumeChange: (volume: number) => void;
  onTogglePlay: () => void;
  onPlaybackRateChange: (updater: (rate: number) => number) => void;
  onToggleMute: () => void;
  onToggleFullscreen: () => void;
  onTogglePip: () => void;
  onToggleSubtitles: () => void;
}

export function useVideoKeyboardShortcuts({
  enabled,
  videoRef,
  hasSubtitle,
  onSeekBy,
  onVolumeChange,
  onTogglePlay,
  onPlaybackRateChange,
  onToggleMute,
  onToggleFullscreen,
  onTogglePip,
  onToggleSubtitles,
}: UseVideoKeyboardShortcutsArgs) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video) return;
      const target = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return;

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          onSeekBy(-5);
          break;
        case 'ArrowRight':
          e.preventDefault();
          onSeekBy(5);
          break;
        case 'ArrowUp':
          e.preventDefault();
          onVolumeChange(video.volume + 0.1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          onVolumeChange(video.volume - 0.1);
          break;
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          onTogglePlay();
          break;
        case '[':
          e.preventDefault();
          onPlaybackRateChange((rate) => {
            const next = clampPlaybackRate(rate - PLAYER_SPEED_STEP);
            video.playbackRate = next;
            return next;
          });
          break;
        case ']':
          e.preventDefault();
          onPlaybackRateChange((rate) => {
            const next = clampPlaybackRate(rate + PLAYER_SPEED_STEP);
            video.playbackRate = next;
            return next;
          });
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          onToggleMute();
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          onToggleFullscreen();
          break;
        case 'i':
        case 'I':
          e.preventDefault();
          onTogglePip();
          break;
        case 'c':
        case 'C':
          if (hasSubtitle) {
            e.preventDefault();
            onToggleSubtitles();
          }
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    enabled,
    hasSubtitle,
    onPlaybackRateChange,
    onSeekBy,
    onToggleFullscreen,
    onToggleMute,
    onTogglePip,
    onTogglePlay,
    onToggleSubtitles,
    onVolumeChange,
    videoRef,
  ]);
}
