import type React from 'react';
import {
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  SkipBack,
  SkipForward,
  Star,
  Subtitles,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { SpritePreview } from './SpritePreview';
import { Slider } from './VideoSlider';
import { PLAYER_SPEED_MAX, PLAYER_SPEED_MIN, PLAYER_SPEED_STEP, clampPlaybackRate, formatTime } from './videoPlayerUtils';
import { playInteractionSound } from '../../lib/sounds';

const SPRITE_PREVIEW_HALF_WIDTH = 90;

interface VideoPlayerControlsProps {
  showControls: boolean;
  isMobile: boolean;
  videoId: number;
  videoDuration: number;
  progress: number;
  progressPct: number;
  hoverTime: number | null;
  hoverX: number;
  playerWidth: number;
  progressBarRef: React.RefObject<HTMLDivElement | null>;
  isPlaying: boolean;
  isMuted: boolean;
  volume: number;
  hasSubtitle: boolean;
  showSubtitles: boolean;
  showSubtitleMenu: boolean;
  subtitleOpacity: number;
  subtitleSize: number;
  showSpeedMenu: boolean;
  playbackRate: number;
  isFullscreen: boolean;
  onStopControlClick: (e: React.MouseEvent) => void;
  onProgressMouseDown: (e: React.MouseEvent) => void;
  onProgressTouchStart: (e: React.TouchEvent) => void;
  onProgressMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void;
  onProgressMouseLeave: () => void;
  onTogglePlay: () => void;
  onPlayPrevious: () => void;
  onPlayNext: () => void;
  onToggleMute: () => void;
  onVolumeChange: (volume: number) => void;
  onToggleSubtitleMenu: () => void;
  onToggleSubtitles: () => void;
  onSubtitleOpacityChange: (opacity: number) => void;
  onSubtitleSizeChange: (size: number) => void;
  onToggleSpeedMenu: () => void;
  onPlaybackRateChange: (rate: number) => void;
  onTogglePip: () => void;
  onToggleFullscreen: () => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
}

export function VideoPlayerControls({
  showControls,
  isMobile,
  videoId,
  videoDuration,
  progress,
  progressPct,
  hoverTime,
  hoverX,
  playerWidth,
  progressBarRef,
  isPlaying,
  isMuted,
  volume,
  hasSubtitle,
  showSubtitles,
  showSubtitleMenu,
  subtitleOpacity,
  subtitleSize,
  showSpeedMenu,
  playbackRate,
  isFullscreen,
  onStopControlClick,
  onProgressMouseDown,
  onProgressTouchStart,
  onProgressMouseMove,
  onProgressMouseLeave,
  onTogglePlay,
  onPlayPrevious,
  onPlayNext,
  onToggleMute,
  onVolumeChange,
  onToggleSubtitleMenu,
  onToggleSubtitles,
  onSubtitleOpacityChange,
  onSubtitleSizeChange,
  onToggleSpeedMenu,
  onPlaybackRateChange,
  onTogglePip,
  onToggleFullscreen,
  isFavorite,
  onToggleFavorite,
}: VideoPlayerControlsProps) {
  return (
    <div
      className={`absolute inset-x-0 bottom-0 z-20 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      onClick={onStopControlClick}
      onDoubleClick={onStopControlClick}
    >
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent pointer-events-none" />
      <div className={`relative ${isMobile ? 'px-2 pb-1.5 pt-6' : 'px-3 pb-2 pt-8'}`}>
        {videoDuration > 0 && (
          <div
            ref={progressBarRef}
            className={`relative ${isMobile ? 'h-[4px]' : 'h-[3px] hover:h-[6px]'} bg-white/20 rounded-full cursor-pointer ${isMobile ? 'mb-1.5' : 'mb-2'} transition-all duration-150 group/progress`}
            onMouseDown={onProgressMouseDown}
            onTouchStart={onProgressTouchStart}
            onMouseMove={onProgressMouseMove}
            onMouseLeave={onProgressMouseLeave}
          >
            <div className="theme-progress-fill absolute inset-y-0 left-0 rounded-full" style={{ width: `${progressPct}%` }} />
            <div className="theme-progress-fill absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full opacity-0 shadow-sm transition-opacity group-hover/progress:opacity-100" style={{ left: `calc(${progressPct}% - 6px)` }} />
            {hoverTime !== null && (
              <div
                className="absolute bottom-full mb-3 pointer-events-none z-30"
                style={{ left: Math.max(SPRITE_PREVIEW_HALF_WIDTH, Math.min(hoverX, playerWidth - SPRITE_PREVIEW_HALF_WIDTH)), transform: 'translateX(-50%)' }}
              >
                <SpritePreview videoId={videoId} time={hoverTime} />
                <div className="text-center text-[10px] text-white mt-1 font-mono bg-black/70 rounded px-1">{formatTime(hoverTime)}</div>
              </div>
            )}
          </div>
        )}

        <div className={`flex items-center ${isMobile ? 'gap-1.5' : 'gap-1'}`}>
          <button onClick={() => { onTogglePlay(); playInteractionSound(isPlaying ? 'tap' : 'start'); }} className={`${isMobile ? 'p-1' : 'p-1.5'} text-white/80 hover:text-white transition-colors`} title={isPlaying ? '暂停 (空格)' : '播放 (空格)'}>
            {isPlaying ? <Pause size={isMobile ? 18 : 20} /> : <Play size={isMobile ? 18 : 20} />}
          </button>
          <button onClick={() => { onPlayPrevious(); playInteractionSound('tap'); }} className={`${isMobile ? 'p-1' : 'p-1.5'} text-white/80 hover:text-white transition-colors`} title="上一集">
            <SkipBack size={isMobile ? 14 : 16} />
          </button>
          <button onClick={() => { onPlayNext(); playInteractionSound('tap'); }} className={`${isMobile ? 'p-1' : 'p-1.5'} text-white/80 hover:text-white transition-colors`} title="下一集">
            <SkipForward size={isMobile ? 14 : 16} />
          </button>

          {!isMobile && (
            <div className="flex items-center gap-1 group/vol">
              <button onClick={() => { onToggleMute(); playInteractionSound('tap'); }} className="p-1.5 text-white/80 hover:text-white transition-colors" title={isMuted ? '取消静音 (M)' : '静音 (M)'}>
                {isMuted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
              <div className="w-0 group-hover/vol:w-20 overflow-hidden transition-all duration-200">
                <Slider value={isMuted ? 0 : volume} min={0} max={1} step={0.05} onChange={onVolumeChange} className="w-20" />
              </div>
            </div>
          )}

          <span className={`${isMobile ? 'text-[9px] ml-1' : 'text-[11px] ml-2'} text-white/70 font-mono select-none`}>{formatTime(progress)} / {formatTime(videoDuration)}</span>
          <div className="flex-1" />

          {hasSubtitle && (
            <div className="relative">
              <button data-subtitle-btn onClick={() => { onToggleSubtitleMenu(); playInteractionSound('tap'); }} className={`${isMobile ? 'p-1.5' : 'p-1.5'} transition-colors ${showSubtitles ? 'text-[var(--accent)]' : 'text-white/80 hover:text-white'}`} title="字幕">
                <Subtitles size={isMobile ? 14 : 16} />
              </button>
              {showSubtitleMenu && (
                <div data-subtitle-menu className="absolute bottom-full right-0 mb-2 bg-black/90 backdrop-blur-sm rounded-lg p-3 min-w-[180px] space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/70">字幕</span>
                    <button onClick={() => { onToggleSubtitles(); playInteractionSound('tap'); }} className={`rounded px-2 py-0.5 text-[10px] ${showSubtitles ? 'bg-[var(--accent)] text-white' : 'bg-white/10 text-white/60'}`}>
                      {showSubtitles ? '开' : '关'}
                    </button>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-white/50">透明度</span>
                      <span className="text-[10px] text-white/70">{Math.round(subtitleOpacity * 100)}%</span>
                    </div>
                    <Slider value={subtitleOpacity} min={0} max={1} step={0.05} onChange={onSubtitleOpacityChange} className="w-full" dark />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-white/50">字号</span>
                      <span className="text-[10px] text-white/70">{subtitleSize}%</span>
                    </div>
                    <Slider value={subtitleSize} min={50} max={200} step={10} onChange={onSubtitleSizeChange} className="w-full" />
                  </div>
                </div>
              )}
            </div>
          )}

          <button
            onClick={() => { onToggleFavorite(); playInteractionSound('tap'); }}
            className={`${isMobile ? 'p-1' : 'p-1.5'} transition-colors ${isFavorite ? 'text-[#fbbf24]' : 'text-white/80 hover:text-white'}`}
            title={isFavorite ? '取消收藏' : '收藏视频'}
          >
            <Star size={isMobile ? 14 : 16} fill={isFavorite ? 'currentColor' : 'none'} />
          </button>

          <div className="relative">
            <button data-speed-btn onClick={() => { onToggleSpeedMenu(); playInteractionSound('tap'); }} className={`${isMobile ? 'px-1.5 py-1 text-[10px]' : 'px-1.5 py-1 text-[11px]'} text-white/80 hover:text-white transition-colors font-medium`} title="倍速">
              {playbackRate === 1 ? '倍速' : `${playbackRate.toFixed(1)}x`}
            </button>
            {showSpeedMenu && (
              <div data-speed-menu className="absolute bottom-full right-0 mb-2 bg-black/90 backdrop-blur-sm rounded-lg p-3 min-w-[190px] space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-white/70">倍速</span>
                  <span className="text-xs text-white/90 font-mono">{playbackRate.toFixed(1)}x</span>
                </div>
                <Slider value={playbackRate} min={PLAYER_SPEED_MIN} max={PLAYER_SPEED_MAX} step={PLAYER_SPEED_STEP} onChange={(next) => onPlaybackRateChange(clampPlaybackRate(next))} className="w-full" dark />
                <div className="flex items-center justify-between text-[10px] text-white/45 font-mono">
                  <span>0.5x</span>
                  <span>2.0x</span>
                </div>
              </div>
            )}
          </div>

          {!isMobile && (
            <button onClick={() => { onTogglePip(); playInteractionSound('tap'); }} className="p-1.5 text-white/80 hover:text-white transition-colors" title="画中画">
              <PictureInPicture2 size={16} />
            </button>
          )}
          <button onClick={() => { onToggleFullscreen(); playInteractionSound('tap'); }} className={`${isMobile ? 'p-1.5' : 'p-1.5'} text-white/80 hover:text-white transition-colors`} title={isFullscreen ? '退出全屏 (F)' : '全屏 (F)'}>
            {isFullscreen ? <Minimize size={isMobile ? 14 : 16} /> : <Maximize size={isMobile ? 14 : 16} />}
          </button>
        </div>
      </div>
    </div>
  );
}
