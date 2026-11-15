import { useCallback } from 'react';
import type React from 'react';
import type { MutableRefObject, RefObject } from 'react';
import type { VideoItem } from '../../lib/videoApi';

function getVideoErrorLabel(code: number | undefined): string {
  if (code === 1) return '加载被中止';
  if (code === 2) return '网络错误';
  if (code === 3) return '解码失败';
  if (code === 4) return '格式不支持或文件不可用';
  return '未知错误';
}

interface UseVideoElementEventsOptions {
  currentVideo: VideoItem | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  playbackRate: number;
  volume: number;
  isMuted: boolean;
  subtitleUrl: string | null;
  playAfterLoadRef: MutableRefObject<boolean>;
  lastVolumeRef: MutableRefObject<number>;
  setVideoDuration: (duration: number) => void;
  setProgress: (progress: number) => void;
  setVolume: (volume: number) => void;
  setIsMuted: (muted: boolean) => void;
  setMediaError: (message: string) => void;
  setShowControls: (visible: boolean) => void;
  hideCurrentTextTracks: () => void;
}

export function useVideoElementEvents({
  currentVideo,
  videoRef,
  playbackRate,
  volume,
  isMuted,
  subtitleUrl,
  playAfterLoadRef,
  lastVolumeRef,
  setVideoDuration,
  setProgress,
  setVolume,
  setIsMuted,
  setMediaError,
  setShowControls,
  hideCurrentTextTracks,
}: UseVideoElementEventsOptions) {
  const videoDuration = currentVideo?.duration ?? null;
  const watchProgress = currentVideo?.watch_progress ?? null;
  const handleCanPlay = useCallback(() => setMediaError(''), [setMediaError]);

  const handleError = useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    const code = event.currentTarget.error?.code;
    setMediaError(`视频播放失败：${getVideoErrorLabel(code)}${code ? `（${code}）` : ''}`);
  }, [setMediaError]);

  const handleLoadedMetadata = useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    if (!currentVideo) return;

    const video = event.currentTarget;
    const detectedDuration = Number.isFinite(video.duration) ? video.duration : 0;

    setVideoDuration(videoDuration || detectedDuration);
    video.playbackRate = playbackRate;
    video.volume = isMuted ? 0 : volume;
    video.muted = isMuted || volume === 0;
    setVolume(video.volume);
    setIsMuted(video.muted);
    if (video.volume > 0) lastVolumeRef.current = video.volume;

    // 优先跳转到聊天引用里指定的时间点，其次才是上次观看进度
    const pendingSeekRaw = localStorage.getItem('p2m_pending_seek_sec');
    let pendingSeek: number | null = null;
    if (pendingSeekRaw) {
      localStorage.removeItem('p2m_pending_seek_sec');
      const parsed = Number(pendingSeekRaw);
      if (Number.isFinite(parsed) && parsed > 0) pendingSeek = parsed;
    }

    if (pendingSeek !== null && videoRef.current) {
      const target = detectedDuration ? Math.min(pendingSeek, detectedDuration - 1) : pendingSeek;
      videoRef.current.currentTime = target;
      setProgress(target);
    } else if (!playAfterLoadRef.current && watchProgress && videoRef.current) {
      videoRef.current.currentTime = watchProgress;
      setProgress(watchProgress);
    }

    if (subtitleUrl) hideCurrentTextTracks();
    if (playAfterLoadRef.current) {
      playAfterLoadRef.current = false;
      video.play().catch(() => {
        setShowControls(true);
      });
    }
  }, [
    currentVideo,
    videoDuration,
    watchProgress,
    hideCurrentTextTracks,
    isMuted,
    lastVolumeRef,
    playAfterLoadRef,
    playbackRate,
    setIsMuted,
    setProgress,
    setShowControls,
    setVideoDuration,
    setVolume,
    subtitleUrl,
    videoRef,
    volume,
  ]);

  const handleVolumeSync = useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    setVolume(video.volume);
    setIsMuted(video.muted || video.volume === 0);
    if (video.volume > 0) lastVolumeRef.current = video.volume;
  }, [lastVolumeRef, setIsMuted, setVolume]);

  return {
    handleCanPlay,
    handleError,
    handleLoadedMetadata,
    handleVolumeSync,
  };
}
