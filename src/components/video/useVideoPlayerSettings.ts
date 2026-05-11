import { useEffect, useMemo, useRef, useState } from 'react';
import { loadPlayerSettings, savePlayerSettings, type PlayerSettings } from './videoPlayerSettings';

export function useVideoPlayerSettings() {
  const initialSettings = useMemo(() => loadPlayerSettings(), []);
  const settingsRef = useRef<PlayerSettings>(initialSettings);
  const lastVolumeRef = useRef(initialSettings.volume || 1);
  const [showSubtitles, setShowSubtitles] = useState(initialSettings.showSubtitles);
  const [subtitleOpacity, setSubtitleOpacity] = useState(initialSettings.subtitleOpacity);
  const [subtitleSize, setSubtitleSize] = useState(initialSettings.subtitleSize);
  const [autoPlay, setAutoPlay] = useState(initialSettings.autoPlay);
  const [playbackRate, setPlaybackRate] = useState(initialSettings.playbackRate);
  const [volume, setVolume] = useState(initialSettings.volume);
  const [isMuted, setIsMuted] = useState(initialSettings.muted);

  useEffect(() => {
    settingsRef.current = {
      showSubtitles,
      subtitleOpacity,
      subtitleSize,
      autoPlay,
      playbackRate,
      volume,
      muted: isMuted,
    };
    savePlayerSettings(settingsRef.current);
  }, [showSubtitles, subtitleOpacity, subtitleSize, autoPlay, playbackRate, volume, isMuted]);

  return {
    showSubtitles,
    setShowSubtitles,
    subtitleOpacity,
    setSubtitleOpacity,
    subtitleSize,
    setSubtitleSize,
    autoPlay,
    setAutoPlay,
    playbackRate,
    setPlaybackRate,
    volume,
    setVolume,
    isMuted,
    setIsMuted,
    settingsRef,
    lastVolumeRef,
  };
}
