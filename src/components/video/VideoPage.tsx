import React, { useEffect, useRef, useState, useCallback } from 'react';
import { PlayCircle, ArrowLeft } from 'lucide-react';
import { PageTitle } from '../shared';
import { useVideoStore } from '../../stores/videoStore';
import { saveWatchHistory } from '../../lib/videoApi';
import { useAiJobCenter } from '../../hooks/useAiJobCenter';
import { VideoList } from './VideoList';
import { VideoAiSummaryPanel } from './VideoAiSummaryPanel';
import { MediaErrorOverlay, PausedOverlay, SubtitleOverlay } from './VideoOverlays';
import { VideoPlayerControls } from './VideoPlayerControls';
import { VideoPlaylistPanel } from './VideoPlaylistPanel';
import { VideoAiJobCenter } from './VideoAiJobCenter';
import { VideoErrorBoundary } from './VideoErrorBoundary';
import { usePlaylistResize } from './usePlaylistResize';
import { useVideoControlChrome } from './useVideoControlChrome';
import { useVideoKeyboardShortcuts } from './useVideoKeyboardShortcuts';
import { useVideoPlaylist } from './useVideoPlaylist';
import { useVideoPlayerMedia } from './useVideoPlayerMedia';
import { useVideoPlayerSettings } from './useVideoPlayerSettings';
import { useVideoPlayback } from './useVideoPlayback';
import { useVideoSubtitles } from './useVideoSubtitles';
import { useVideoSelection } from './useVideoSelection';

function VideoPlayerView() {
  const { currentVideo, currentSegments, jobStatus, jobStage, clearSelection, selectVideo, loadCurrentVideo, currentCategoryId } = useVideoStore();

  const videoRef = useRef<HTMLVideoElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const isPlayingRef = useRef(false);
  const currentTimeRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);
  const [playerWidth, setPlayerWidth] = useState(800);
  const [videoDuration, setVideoDuration] = useState(0);
  const { width: playlistPanelWidth, startResize: startPlaylistResize } = usePlaylistResize(300);
  const [dragging, setDragging] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const {
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
  } = useVideoPlayerSettings();
  const {
    togglePlay,
    seekBy,
    toggleMute,
    handleVolumeChange,
    togglePip,
    toggleFullscreen,
  } = useVideoPlayback({
    videoRef,
    videoDuration,
    lastVolumeRef,
    setProgress,
    setVolume,
    setIsMuted,
    videoContainerRef,
    setIsFullscreen,
  });
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

  const {
    videoUrl,
    subtitleUrl,
    normalizedSegments,
    hasSubtitle,
    videoKey,
    currentVideoId,
    hasVideoDetails,
  } = useVideoPlayerMedia({ currentVideo, currentSegments });
  const {
    activeSubtitleText,
    resetActiveSubtitle,
    toggleSubtitles,
    updateActiveSubtitle,
    hideCurrentTextTracks,
  } = useVideoSubtitles({
    videoRef,
    subtitleUrl,
    normalizedSegments,
    showSubtitles,
    setShowSubtitles,
    subtitleOpacity,
    subtitleSize,
  });

  // AI Job Center - all logic extracted to hook
  const { triggerSingleVideo, triggerCorrection, ...aiJobCenterProps } = useAiJobCenter(playlist, playlistScope, currentVideoId, loadCurrentVideo);

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
      resetActiveSubtitle();
      setPlaybackRate(settingsRef.current.playbackRate);
      setMediaError('');
    });
  }, [currentVideo?.id, resetActiveSubtitle]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
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

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const handleTimeUpdate = useCallback(() => {
    if (!currentVideo) return;
    const t = videoRef.current?.currentTime ?? 0;
    currentTimeRef.current = t;
    setProgress(t);
    updateActiveSubtitle(t);

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const dur = videoRef.current?.duration ?? 0;
      if (dur > 0) saveWatchHistory(currentVideo.id, t, dur).catch(() => {});
    }, 10000);
  }, [currentVideo, updateActiveSubtitle]);

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
    <div className="space-y-4 px-0">
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

      <div className="flex flex-col gap-3 lg:flex-row lg:gap-[22px]">
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
                if (subtitleUrl) hideCurrentTextTracks();
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
          width={Math.min(playlistPanelWidth, Math.max(250, window.innerWidth * 0.32))}
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
  const { currentVideo } = useVideoSelection();

  return (
    <div className={`w-full pt-2 space-y-6 ${currentVideo ? '' : 'px-1 lg:px-1.5'}`}>
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
