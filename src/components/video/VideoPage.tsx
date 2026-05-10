import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { PlayCircle, ArrowLeft } from 'lucide-react';
import { PageTitle } from '../shared';
import { useVideoStore } from '../../stores/videoStore';
import { getVideoStreamUrl, getSubtitleFileUrl, saveWatchHistory, type TranscriptSegment } from '../../lib/videoApi';
import { useAiJobCenter } from '../../hooks/useAiJobCenter';
import { VideoList } from './VideoList';
import { VideoAiSummaryPanel } from './VideoAiSummaryPanel';
import { MediaErrorOverlay, PausedOverlay, SubtitleOverlay } from './VideoOverlays';
import { VideoPlayerControls } from './VideoPlayerControls';
import { VideoPlaylistPanel } from './VideoPlaylistPanel';
import { VideoAiJobCenter } from './VideoAiJobCenter';
import { VideoErrorBoundary } from './VideoErrorBoundary';
import { normalizeSegment } from './videoPlayerAdapters';
import { loadPlayerSettings, savePlayerSettings, type PlayerSettings } from './videoPlayerSettings';
import { usePlaylistResize } from './usePlaylistResize';
import { useVideoControlChrome } from './useVideoControlChrome';
import { useVideoKeyboardShortcuts } from './useVideoKeyboardShortcuts';
import { useVideoPlaylist } from './useVideoPlaylist';

function VideoPlayerView() {
  const { currentVideo, currentSegments, jobStatus, jobStage, clearSelection, selectVideo, loadCurrentVideo, currentCategoryId } = useVideoStore();

  const videoRef = useRef<HTMLVideoElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const isPlayingRef = useRef(false);
  const initialSettings = useMemo(() => loadPlayerSettings(), []);
  const settingsRef = useRef<PlayerSettings>(initialSettings);
  const lastVolumeRef = useRef(initialSettings.volume || 1);
  const [activeSegIdx, setActiveSegIdx] = useState(-1);
  const currentTimeRef = useRef(0);
  const [showSubtitles, setShowSubtitles] = useState(initialSettings.showSubtitles);
  const subtitleListRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);
  const [playerWidth, setPlayerWidth] = useState(800);
  const [videoDuration, setVideoDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(initialSettings.playbackRate);
  const [subtitleOpacity, setSubtitleOpacity] = useState(initialSettings.subtitleOpacity);
  const [subtitleSize, setSubtitleSize] = useState(initialSettings.subtitleSize);
  const [autoPlay, setAutoPlay] = useState(initialSettings.autoPlay);
  const { width: playlistPanelWidth, startResize: startPlaylistResize } = usePlaylistResize(360);
  const [volume, setVolume] = useState(initialSettings.volume);
  const [isMuted, setIsMuted] = useState(initialSettings.muted);
  const [dragging, setDragging] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const {
    showControls,
    setShowControls,
    showSpeedMenu,
    setShowSpeedMenu,
    showSubtitleMenu,
    setShowSubtitleMenu,
    resetHideTimer,
  } = useVideoControlChrome(isPlaying);
  const {
    playlist,
    playlistScope,
    playAfterLoadRef,
    selectPlaylistItem,
    playNextFromPlaylist,
    togglePlaylistScope,
  } = useVideoPlaylist({ currentVideo, selectVideo, currentCategoryId });

  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const videoUrl = currentVideo ? getVideoStreamUrl(currentVideo.id) : '';
  const subtitleUrl = currentVideo && (currentVideo.subtitle_url || currentVideo.subtitle_path)
    ? getSubtitleFileUrl(currentVideo.id)
    : null;
  const normalizedSegments = useMemo(
    () => currentSegments.map(normalizeSegment).filter((segment): segment is TranscriptSegment => !!segment),
    [currentSegments]
  );
  const activeSubtitleText = activeSegIdx >= 0 ? normalizedSegments[activeSegIdx]?.text || '' : '';
  const hasEmbeddedSubtitle = normalizedSegments.length > 0;
  const hasSubtitle = !!subtitleUrl || hasEmbeddedSubtitle;

  const videoKey = `${currentVideo?.id ?? 'none'}`;
  const currentVideoId = currentVideo?.id ?? null;
  const hasVideoDetails = !!(
    currentVideo?.transcript_segments?.length ||
    currentVideo?.summary ||
    currentVideo?.transcription
  );

  // AI Job Center - all logic extracted to hook
  const { triggerSingleVideo, triggerCorrection, ...aiJobCenterProps } = useAiJobCenter(playlist, currentVideoId, loadCurrentVideo);

  const isProcessing = jobStatus === 'running' || jobStatus === 'queued';
  const progressPct = videoDuration > 0 ? (progress / videoDuration) * 100 : 0;

  // Load video details if missing
  useEffect(() => {
    if (!currentVideoId || hasVideoDetails) return;
    void loadCurrentVideo(currentVideoId);
  }, [currentVideoId, hasVideoDetails, loadCurrentVideo]);

  // Reset player state when video changes
  useEffect(() => {
    queueMicrotask(() => {
      setProgress(0);
      setVideoDuration(0);
      setIsPlaying(false);
      setHoverTime(null);
      setActiveSegIdx(-1);
      setPlaybackRate(settingsRef.current.playbackRate);
      setMediaError('');
    });
  }, [currentVideo?.id]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

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

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused || v.ended) {
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, []);

  // Mobile: keep simple tap-to-play behavior and let the browser handle native playback mode.
  const touchHandledRef = useRef(false);
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !isMobile) return;
    let startX = 0;
    let startY = 0;
    const onStart = (e: TouchEvent) => { startX = e.touches[0].clientX; startY = e.touches[0].clientY; };
    const onEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      if (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10) return;
      e.preventDefault();
      touchHandledRef.current = true;
      setTimeout(() => { touchHandledRef.current = false; }, 300);
      togglePlay();
    };
    v.addEventListener('touchstart', onStart, { passive: true });
    v.addEventListener('touchend', onEnd, { passive: false });
    return () => {
      v.removeEventListener('touchstart', onStart);
      v.removeEventListener('touchend', onEnd);
    };
  }, [isMobile, togglePlay, videoKey]);

  const seekBy = useCallback((seconds: number) => {
    const v = videoRef.current;
    if (!v) return;
    const duration = Number.isFinite(v.duration) ? v.duration : videoDuration;
    const next = Math.max(0, Math.min(duration || 0, v.currentTime + seconds));
    v.currentTime = next;
    setProgress(next);
  }, [videoDuration]);

  const toggleSubtitles = useCallback(() => {
    const next = !showSubtitles;
    setShowSubtitles(next);
      const video = videoRef.current;
      if (video) {
        for (let i = 0; i < video.textTracks.length; i++) {
          video.textTracks[i].mode = 'hidden';
        }
      }
  }, [showSubtitles]);

  useEffect(() => {
    if (!subtitleUrl || !videoRef.current) return;
    const video = videoRef.current;
    for (let i = 0; i < video.textTracks.length; i++) {
      video.textTracks[i].mode = 'hidden';
    }
  }, [subtitleUrl, showSubtitles]);

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
  }, []);

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
  }, []);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

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
      // Browsers can reject PiP when the source or gesture is not eligible.
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = videoContainerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Inject subtitle ::cue styles
  useEffect(() => {
    let el = document.getElementById('subtitle-cue-style') as HTMLStyleElement;
    if (!el) {
      el = document.createElement('style');
      el.id = 'subtitle-cue-style';
      document.head.appendChild(el);
    }
    el.textContent = `video::cue { opacity: ${subtitleOpacity}; font-size: ${subtitleSize}%; }`;
  }, [subtitleOpacity, subtitleSize]);

  const handleTimeUpdate = useCallback(() => {
    if (!currentVideo) return;
    const t = videoRef.current?.currentTime ?? 0;
    currentTimeRef.current = t;
    setProgress(t);

    const idx = normalizedSegments.findIndex((s) => t >= s.start && t < s.end);
    if (idx !== activeSegIdx) {
      setActiveSegIdx(idx);
      if (idx >= 0 && subtitleListRef.current) {
        const el = subtitleListRef.current.querySelector(`[data-seg="${idx}"]`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const dur = videoRef.current?.duration ?? 0;
      if (dur > 0) saveWatchHistory(currentVideo.id, t, dur).catch(() => {});
    }, 10000);
  }, [normalizedSegments, activeSegIdx, currentVideo]);

  const handleEnded = useCallback(() => {
    if (!autoPlay) return;
    playNextFromPlaylist();
  }, [autoPlay, playNextFromPlaylist]);

  const handleProgressMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!videoDuration) return;
    setDragging(true);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const next = pct * videoDuration;
    if (videoRef.current) videoRef.current.currentTime = next;
    setProgress(next);
  }, [videoDuration]);

  const handleProgressTouchStart = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    if (!videoDuration) return;
    setDragging(true);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.touches[0].clientX - rect.left) / rect.width));
    const next = pct * videoDuration;
    if (videoRef.current) videoRef.current.currentTime = next;
    setProgress(next);
  }, [videoDuration]);

  const stopControlClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  useVideoKeyboardShortcuts({
    enabled: !!currentVideo,
    videoRef,
    hasSubtitle,
    onSeekBy: seekBy,
    onVolumeChange: handleVolumeChange,
    onTogglePlay: togglePlay,
    onPlaybackRateChange: setPlaybackRate,
    onToggleMute: toggleMute,
    onToggleFullscreen: toggleFullscreen,
    onTogglePip: togglePip,
    onToggleSubtitles: toggleSubtitles,
  });

  useEffect(() => {
    if (!dragging) return;
    const bar = progressBarRef.current;
    const getClientX = (e: MouseEvent | TouchEvent) => 'touches' in e ? e.touches[0].clientX : e.clientX;
    const handleMove = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      if (!bar || !videoRef.current) return;
      const rect = bar.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (getClientX(e) - rect.left) / rect.width));
      const next = pct * videoDuration;
      videoRef.current.currentTime = next;
      setProgress(next);
    };
    const handleUp = () => setDragging(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleUp);
    };
  }, [dragging, videoDuration]);

  if (!currentVideo) return null;

  return (
    <div className="space-y-4">
      {/* Header - hidden on mobile */}
      <div className="hidden md:flex items-center gap-3">
        <button onClick={clearSelection} className="p-2 rounded-lg hover:bg-[#f3f2ef] text-[#6b7280] transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-[#1a1a1a] truncate">{currentVideo.title}</h2>
          <p className="text-xs text-[#9ca3af]">{currentVideo.filename}</p>
        </div>
      </div>

      {/* Mobile: back button */}
      {isMobile && (
        <button onClick={clearSelection} className="p-1.5 text-[#6b7280] hover:text-[#1a1a1a] transition-colors" title="返回列表">
          <ArrowLeft size={18} />
        </button>
      )}

      <div className="flex flex-col lg:flex-row gap-4">
        {/* Player column */}
        <div className="min-w-0 flex-1 space-y-3">
          {/* Video container with overlay controls */}
          <div
            ref={videoContainerRef}
            className="aspect-video bg-black md:rounded-xl rounded-lg overflow-hidden relative select-none"
            onMouseMove={resetHideTimer}
            onMouseLeave={() => { if (isPlaying) setShowControls(false); }}
            style={{ cursor: showControls ? 'default' : 'none' }}
          >
            <video
                key={videoKey}
                ref={videoRef}
                src={videoUrl}
                className="w-full h-full"
                playsInline
                webkit-playsinline="true"
                onTimeUpdate={handleTimeUpdate}
              onCanPlay={() => setMediaError('')}
              onError={(e) => {
                const video = e.currentTarget;
                const code = video.error?.code;
                const label = code === 1 ? '加载被中止' : code === 2 ? '网络错误' : code === 3 ? '解码失败' : code === 4 ? '格式不支持或文件不可用' : '未知错误';
                setMediaError(`视频播放失败：${label}${code ? `（${code}）` : ''}`);
              }}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={handleEnded}
              onLoadedMetadata={(e) => {
                  const video = e.target as HTMLVideoElement;
                  const dur = Number.isFinite(video.duration) ? video.duration : 0;
                  setVideoDuration(dur);
                  video.playbackRate = playbackRate;
                  video.volume = isMuted ? 0 : volume;
                  video.muted = isMuted || volume === 0;
                  setVolume(video.volume);
                  setIsMuted(video.muted);
                  if (video.volume > 0) lastVolumeRef.current = video.volume;
                  if (!playAfterLoadRef.current && currentVideo.watch_progress && videoRef.current) {
                    videoRef.current.currentTime = currentVideo.watch_progress;
                    setProgress(currentVideo.watch_progress);
                  }
                if (currentVideo.duration) {
                  setVideoDuration(currentVideo.duration);
                }
                  if (subtitleUrl) {
                    for (let i = 0; i < video.textTracks.length; i++) {
                      video.textTracks[i].mode = 'hidden';
                    }
                  }
                if (playAfterLoadRef.current) {
                  playAfterLoadRef.current = false;
                  video.play().catch(() => {
                    setShowControls(true);
                  });
                }
              }}
              onVolumeChange={(e) => {
                const video = e.target as HTMLVideoElement;
                setVolume(video.volume);
                setIsMuted(video.muted || video.volume === 0);
                if (video.volume > 0) lastVolumeRef.current = video.volume;
              }}
              onClick={() => { if (!touchHandledRef.current) togglePlay(); }}
              onDoubleClick={() => { if (!isMobile) toggleFullscreen(); }}
            />

            <MediaErrorOverlay message={mediaError} />
            <SubtitleOverlay visible={showSubtitles} text={activeSubtitleText} opacity={subtitleOpacity} size={subtitleSize} />
            <PausedOverlay isPlaying={isPlaying} />

            <VideoPlayerControls
              showControls={showControls}
              isMobile={isMobile}
              videoId={currentVideo.id}
              videoDuration={videoDuration}
              progress={progress}
              progressPct={progressPct}
              hoverTime={hoverTime}
              hoverX={hoverX}
              playerWidth={playerWidth}
              progressBarRef={progressBarRef}
              isPlaying={isPlaying}
              isMuted={isMuted}
              volume={volume}
              hasSubtitle={hasSubtitle}
              showSubtitles={showSubtitles}
              showSubtitleMenu={showSubtitleMenu}
              subtitleOpacity={subtitleOpacity}
              subtitleSize={subtitleSize}
              showSpeedMenu={showSpeedMenu}
              playbackRate={playbackRate}
              isFullscreen={isFullscreen}
              onStopControlClick={stopControlClick}
              onProgressMouseDown={handleProgressMouseDown}
              onProgressTouchStart={handleProgressTouchStart}
              onProgressMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                setHoverTime(pct * videoDuration);
                const containerRect = videoContainerRef.current?.getBoundingClientRect();
                setPlayerWidth(containerRect?.width ?? 800);
                setHoverX(e.clientX - (containerRect?.left ?? 0));
              }}
              onProgressMouseLeave={() => setHoverTime(null)}
              onTogglePlay={togglePlay}
              onSeekBy={seekBy}
              onToggleMute={toggleMute}
              onVolumeChange={handleVolumeChange}
              onToggleSubtitleMenu={() => { setShowSubtitleMenu(!showSubtitleMenu); setShowSpeedMenu(false); }}
              onToggleSubtitles={toggleSubtitles}
              onSubtitleOpacityChange={setSubtitleOpacity}
              onSubtitleSizeChange={setSubtitleSize}
              onToggleSpeedMenu={() => { setShowSpeedMenu(!showSpeedMenu); setShowSubtitleMenu(false); }}
              onPlaybackRateChange={(rate) => {
                setPlaybackRate(rate);
                if (videoRef.current) videoRef.current.playbackRate = rate;
              }}
              onTogglePip={togglePip}
              onToggleFullscreen={toggleFullscreen}
            />
          </div>

          <VideoAiSummaryPanel
            summary={currentVideo.summary}
            isProcessing={isProcessing}
            jobStatus={jobStatus}
            jobStage={jobStage}
          />
        </div>

        <VideoPlaylistPanel
          currentVideo={currentVideo}
          playlist={playlist}
          playlistScope={playlistScope}
          width={playlistPanelWidth}
          isPlaying={isPlaying}
          isProcessing={isProcessing}
          jobStatus={jobStatus}
          autoPlay={autoPlay}
          onResizeStart={startPlaylistResize}
          onTriggerAi={() => triggerSingleVideo(currentVideo.id)}
          onCorrectSubtitles={() => triggerCorrection(currentVideo.id)}
          onToggleAutoPlay={() => setAutoPlay(!autoPlay)}
          onToggleScope={togglePlaylistScope}
          onSelectItem={(item) => { void selectPlaylistItem(item); }}
          footer={!isMobile ? <VideoAiJobCenter {...aiJobCenterProps} /> : undefined}
        />
      </div>
    </div>
  );
}

export const VideoPage: React.FC = () => {
  const currentVideo = useVideoStore((s) => s.currentVideo);
  const restoreCurrentVideo = useVideoStore((s) => s.restoreCurrentVideo);
  const loadCurrentVideo = useVideoStore((s) => s.loadCurrentVideo);

  useEffect(() => {
    restoreCurrentVideo();
  }, [restoreCurrentVideo]);

  // Listen for video play events from AI chat recommendations
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.videoId) {
        void loadCurrentVideo(detail.videoId);
      }
    };
    window.addEventListener('p2m:play-video', handler);
    return () => window.removeEventListener('p2m:play-video', handler);
  }, [loadCurrentVideo]);

  return (
    <div className="w-full pt-2 space-y-6">
      {!currentVideo && (
        <PageTitle
          title="视频站"
          subtitle="本地视频学习，AI 字幕转录 + 智能总结"
          icon={<PlayCircle size={22} />}
        />
      )}
      <VideoErrorBoundary>
        {currentVideo ? <VideoPlayerView /> : <VideoList />}
      </VideoErrorBoundary>
    </div>
  );
};
