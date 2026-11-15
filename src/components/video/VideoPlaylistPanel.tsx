import type React from 'react';
import { CheckCircle2, FolderTree, List, Loader2, PlayCircle, RotateCcw, Sparkles } from 'lucide-react';
import { getThumbnailUrl, type PlaylistItem, type VideoItem } from '../../lib/videoApi';
import { getVideoAiCompletion } from '../../lib/videoAiStatus';
import type { PlaylistScope } from './useVideoPlaylist';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { getWatchProgressPercent } from './videoFormat';

interface VideoPlaylistPanelProps {
  currentVideo: VideoItem;
  playlist: PlaylistItem[];
  playlistScope: PlaylistScope;
  width: number;
  isPlaying: boolean;
  isProcessing: boolean;
  jobStatus: string | null;
  autoPlay: boolean;
  onResizeStart: (clientX: number) => void;
  onTriggerAi: () => void;
  onCorrectSubtitles: () => void;
  onToggleAutoPlay: () => void;
  onToggleScope: () => void;
  onSelectItem: (item: PlaylistItem) => void;
  footer?: React.ReactNode;
}

interface PlaylistRowProps {
  item: PlaylistItem;
  currentVideo: VideoItem;
  isPlaying: boolean;
  onSelectItem: (item: PlaylistItem) => void;
}

function PlaylistRow({ item, currentVideo, isPlaying, onSelectItem }: PlaylistRowProps) {
  const isCurrent = item.id === currentVideo.id;
  const progressPercent = getWatchProgressPercent(item.watch_progress, isCurrent ? currentVideo.duration : null);

  return (
    <div
      onClick={() => onSelectItem(item)}
      className={`flex cursor-pointer items-center gap-3 rounded-lg p-2 transition-colors ${
        isCurrent ? 'theme-chip-active' : 'hover:bg-[var(--bg-accent)]'
      }`}
    >
      <div className="theme-progress-track relative h-12 w-20 shrink-0 overflow-hidden rounded">
        {item.thumbnail ? (
          <img src={getThumbnailUrl(item.id)} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <PlayCircle size={16} className="absolute inset-0 m-auto text-[var(--text-muted)]" />
        )}
        {isCurrent && isPlaying && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <div className="flex gap-0.5">
              <div className="h-3 w-0.5 animate-pulse rounded bg-white" />
              <div className="h-4 w-0.5 animate-pulse rounded bg-white" style={{ animationDelay: '0.15s' }} />
              <div className="h-2 w-0.5 animate-pulse rounded bg-white" style={{ animationDelay: '0.3s' }} />
            </div>
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-xs ${isCurrent ? 'font-medium text-[var(--accent)]' : 'theme-text-primary'}`}>
          {item.title}
        </p>
        {item.completed && <span className="text-xs text-[var(--success)]">已看完</span>}
        {progressPercent !== null && !item.completed && (
          <div className="theme-progress-track mt-1 h-0.5 overflow-hidden rounded-full">
            <div className="theme-progress-fill h-full rounded-full" style={{ width: `${progressPercent}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}

export function VideoPlaylistPanel({
  currentVideo,
  playlist,
  playlistScope,
  width,
  isPlaying,
  isProcessing,
  jobStatus,
  autoPlay,
  onResizeStart,
  onTriggerAi,
  onCorrectSubtitles,
  onToggleAutoPlay,
  onToggleScope,
  onSelectItem,
  footer,
}: VideoPlaylistPanelProps) {
  const isMobile = useIsMobile(1024);
  const aiCompletion = getVideoAiCompletion(currentVideo);

  const playlistMaxHeight = isMobile ? 'max-h-[35vh]' : 'max-h-[min(42vh,420px)]';

  return (
    <div
      className="relative flex min-w-0 flex-col gap-3 lg:shrink-0"
      style={isMobile ? { width: '100%', maxWidth: '100%' } : { width: `${width}px`, maxWidth: '100%' }}
    >
      <div
        className="group absolute -left-4 top-0 bottom-0 hidden w-4 cursor-col-resize items-center justify-center lg:flex"
        onMouseDown={(e) => {
          e.preventDefault();
          onResizeStart(e.clientX);
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
        }}
        title="拖动调整文件夹视频宽度"
      >
        <div className="absolute inset-y-2 left-1/2 w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-[color-mix(in_srgb,var(--border-light)_62%,transparent)] to-transparent opacity-55 transition-all group-hover:via-[color-mix(in_srgb,var(--accent)_42%,var(--border-light))] group-hover:opacity-90" />
        <div className="absolute h-14 w-1.5 rounded-full border border-[var(--border-light)] bg-[color-mix(in_srgb,var(--bg-card)_72%,var(--border-light))] shadow-sm opacity-85 transition-all group-hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--border-light))] group-hover:bg-[color-mix(in_srgb,var(--accent)_18%,var(--bg-card))] group-hover:opacity-100" />
      </div>

      <div className="theme-surface rounded-xl border p-2">
        <div className="auto-grid-compact">
          {!isProcessing ? (
            <>
              <button
                onClick={onTriggerAi}
                className="flex min-w-0 items-center justify-center gap-1 rounded-lg bg-[var(--accent)] px-2 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
                title="生成字幕和总结，默认不做 AI 校对。"
              >
                {jobStatus === 'completed' ? <RotateCcw size={13} className="shrink-0" /> : <Sparkles size={13} className="shrink-0" />}
                <span className="truncate">{jobStatus === 'completed' ? '重新生成' : '生成字幕'}</span>
              </button>
              <button
                onClick={onCorrectSubtitles}
                className="flex min-w-0 items-center justify-center gap-1 rounded-lg border border-[color-mix(in_srgb,var(--accent)_45%,var(--border-light))] bg-[var(--bg-card)] px-2 py-1.5 text-xs font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent-bg)]"
                title="使用 large-v3 重新生成并交给灵境小助手校对。"
              >
                <CheckCircle2 size={13} className="shrink-0" />
                <span className="truncate">校对字幕</span>
              </button>
            </>
          ) : (
            <div className="col-span-2 flex items-center justify-center gap-1 rounded-lg bg-[var(--accent-bg)] px-2 py-1.5 text-xs font-medium text-[var(--accent)]">
              <Loader2 size={13} className="animate-spin" />
              处理中
            </div>
          )}
        </div>
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-[var(--text-muted)]">
          <span className={`rounded-full border px-1.5 py-0.5 ${
            aiCompletion.complete
              ? 'border-[color-mix(in_srgb,var(--success)_35%,var(--border-light))] text-[var(--success)]'
              : aiCompletion.failed
              ? 'border-[color-mix(in_srgb,var(--danger)_35%,var(--border-light))] text-[var(--danger)]'
              : 'border-[var(--border-light)]'
          }`}>
            {aiCompletion.label}
          </span>
          <span>{aiCompletion.hasSubtitles ? '有字幕' : '缺字幕'}</span>
          <span>{aiCompletion.hasSummary ? '有总结' : '缺总结'}</span>
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <List size={14} className="theme-text-secondary shrink-0" />
        <span className="theme-text-primary truncate text-xs font-medium">
          {playlistScope === 'descendants' ? '全部视频' : '当前文件夹'}
        </span>
        <span className="theme-text-muted shrink-0 text-xs">{playlist.length} 个</span>
        <button
          onClick={onToggleScope}
          className={`ml-1 rounded p-1 transition-colors ${playlistScope === 'descendants' ? 'bg-[var(--accent-bg)] text-[var(--accent)]' : 'text-[var(--text-muted)] hover:bg-[var(--accent-bg)] hover:text-[var(--accent)]'}`}
          title={playlistScope === 'descendants' ? '切换到当前文件夹' : '切换到全部视频'}
        >
          <FolderTree size={13} />
        </button>
        <label className="theme-text-secondary ml-auto mr-2 flex shrink-0 cursor-pointer items-center gap-1.5 text-xs" title="播放结束后自动播放下一个视频">
          <input
            type="checkbox"
            checked={autoPlay}
            onChange={onToggleAutoPlay}
            className="h-3.5 w-3.5 accent-[#16a34a]"
          />
          自动连播
        </label>
      </div>

      <div className={`${playlistMaxHeight} min-h-0 space-y-1 overflow-y-auto pr-1`}>
        {playlist.map((item) => (
          <PlaylistRow
            key={item.id}
            item={item}
            currentVideo={currentVideo}
            isPlaying={isPlaying}
            onSelectItem={onSelectItem}
          />
        ))}
      </div>
      {footer}
    </div>
  );
}
