import { useCallback } from 'react';
import type React from 'react';
import type { MutableRefObject, RefObject } from 'react';
import type { VideoItem } from '../../lib/videoApi';
import { PENDING_AUTOPLAY_VIDEO_KEY, PENDING_SEEK_KEY } from '../../lib/videoNavigation';
import { userScopedStorage } from '../../lib/userScopedStorage';

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
  onPlaybackError?: (message: string) => void;
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
  onPlaybackError,
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
    const pendingSeekRaw = userScopedStorage.getItem(PENDING_SEEK_KEY);
    let pendingSeek: number | null = null;
    if (pendingSeekRaw) {
      userScopedStorage.removeItem(PENDING_SEEK_KEY);
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

    // 列表点卡片、AI 引用跳转都属于用户明确的播放动作。
    // 只在视频 id 匹配时消费标记，避免上一次失败加载留下的标记误播别的视频。
    const pendingAutoplayRaw = userScopedStorage.getItem(PENDING_AUTOPLAY_VIDEO_KEY);
    let pendingAutoplay = false;
    if (pendingAutoplayRaw) {
      userScopedStorage.removeItem(PENDING_AUTOPLAY_VIDEO_KEY);
      pendingAutoplay = pendingAutoplayRaw === String(currentVideo.id);
    }

    if (playAfterLoadRef.current || pendingAutoplay) {
      playAfterLoadRef.current = false;
      void video.play().catch((error: unknown) => {
        const name = error instanceof DOMException ? error.name : '';
        setShowControls(true);
        onPlaybackError?.(
          name === 'NotAllowedError'
            ? '自动播放被拦截，请点播放按钮继续。'
            : '视频未能自动播放，请点播放按钮重试。',
        );
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
    onPlaybackError,
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
