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
import { useVideoElementEvents } from './useVideoElementEvents';
import { useVideoProgressScrubber } from './useVideoProgressScrubber';
import { useVideoSubtitles } from './useVideoSubtitles';
import { useVideoSelection } from './useVideoSelection';
import { useIsMobile, useWindowWidth } from '../../hooks/useMediaQuery';

function VideoPlayerView() {
  const { currentVideo, currentSegments, jobStatus, jobStage, clearSelection, selectVideo, loadCurrentVideo, currentCategoryId } = useVideoStore();

  const videoRef = useRef<HTMLVideoElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const isPlayingRef = useRef(false);
  const currentTimeRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const { width: playlistPanelWidth, startResize: startPlaylistResize } = usePlaylistResize(300);
  const [mediaError, setMediaError] = useState('');
  const isMobile = useIsMobile();
  const windowWidth = useWindowWidth();
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
  const {
    progressBarRef,
    hoverTime,
    hoverX,
    playerWidth,
    startScrub,
    updateHover,
    clearHover,
  } = useVideoProgressScrubber({
    videoRef,
    videoContainerRef,
    duration: videoDuration,
    onProgressChange: setProgress,
  });
  const videoElementEvents = useVideoElementEvents({
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
  });

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
      clearHover();
      resetActiveSubtitle();
      setPlaybackRate(settingsRef.current.playbackRate);
      setMediaError('');
    });
  }, [currentVideo?.id, resetActiveSubtitle, clearHover, setPlaybackRate, settingsRef]);

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
              onCanPlay={videoElementEvents.handleCanPlay}
              onError={videoElementEvents.handleError}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={handleEnded}
              onLoadedMetadata={videoElementEvents.handleLoadedMetadata}
              onVolumeChange={videoElementEvents.handleVolumeSync}
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
              onProgressMouseDown={startScrub}
              onProgressTouchStart={startScrub}
              onProgressMouseMove={updateHover}
              onProgressMouseLeave={clearHover}
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
          width={Math.min(playlistPanelWidth, Math.max(250, windowWidth * 0.32))}
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
          title="IT视频站"
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
