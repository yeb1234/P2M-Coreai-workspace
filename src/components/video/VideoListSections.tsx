import React, { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { Film, Loader2, PlayCircle, Sparkles, ArrowDownWideNarrow, ArrowUpWideNarrow, Clock, Columns3, Star } from 'lucide-react';
import { getThumbnailUrl, type VideoItem } from '../../lib/videoApi';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { formatVideoDuration, formatWatchProgress, getWatchProgressPercent } from './videoFormat';
import { getResponsiveSpriteFrameStyle, useSpriteMeta } from './useSpriteMeta';

export type VideoGridMode = 'normal' | 'history' | 'latest';
export type HistorySortMode = 'newest' | 'oldest' | 'longest';

const VideoCard = React.memo(function VideoCard({
  video,
  onPlay,
  onToggleFavorite,
  enableSpritePreview,
}: {
  video: VideoItem;
  onPlay: (videoId: number) => void;
  onToggleFavorite?: (videoId: number, nextFavorite: boolean) => void;
  enableSpritePreview: boolean;
}) {
  const progressPercent = getWatchProgressPercent(video.watch_progress, video.duration);

  return (
    <div onClick={() => onPlay(video.id)} className="theme-card overflow-hidden rounded-lg transition-all hover:shadow-md cursor-pointer group">
      <VideoCardPreviewFrame video={video} enableSpritePreview={enableSpritePreview}>
        <VideoCardThumbnail video={video} />
        <span className="absolute bottom-1 right-1 z-10 rounded bg-black/70 px-1 py-0.5 font-mono text-xs text-white">{formatVideoDuration(video.duration)}</span>
        {onToggleFavorite && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleFavorite(video.id, !video.is_favorite);
            }}
            className={`absolute right-1 top-1 z-20 grid h-6 w-6 place-items-center rounded-md border border-white/20 bg-black/45 text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-black/65 ${
              video.is_favorite ? 'text-[#fbbf24]' : 'text-white/80'
            }`}
            title={video.is_favorite ? '取消收藏' : '收藏视频'}
            aria-label={video.is_favorite ? '取消收藏' : '收藏视频'}
          >
            <Star size={13} fill={video.is_favorite ? 'currentColor' : 'none'} />
          </button>
        )}
        {video.completed && <span className="absolute left-1 top-1 z-10 rounded bg-[var(--success)] px-1 py-0.5 text-xs text-white">✓</span>}
        {progressPercent !== null && !video.completed && (
          <div className="absolute bottom-0 left-0 right-0 z-10 h-0.5 bg-black/20">
            <div className="theme-progress-fill h-full" style={{ width: `${progressPercent}%` }} />
          </div>
        )}
      </VideoCardPreviewFrame>
      <div className="px-2 py-1.5">
        <h4 className="theme-text-primary truncate text-xs font-medium transition-colors group-hover:text-[var(--accent)]">{video.title}</h4>
      </div>
    </div>
  );
});

function VideoCardPreviewFrame({
  video,
  enableSpritePreview,
  children,
}: {
  video: VideoItem;
  enableSpritePreview: boolean;
  children: React.ReactNode;
}) {
  const [previewEnabled, setPreviewEnabled] = useState(false);
  const [frame, setFrame] = useState(0);
  const hoverDelayRef = useRef<number | null>(null);
  const { status, meta } = useSpriteMeta(previewEnabled ? video.id : null, enableSpritePreview);
  const showSprite = enableSpritePreview && previewEnabled && status === 'ready' && meta;

  useEffect(() => {
    if (!showSprite) {
      const id = setTimeout(() => setFrame(0), 0);
      return () => clearTimeout(id);
    }

    const interval = window.setInterval(() => {
      setFrame((current) => (current + 1) % meta.total_frames);
    }, 450);

    return () => window.clearInterval(interval);
  }, [meta, showSprite]);

  const stopHoverPreview = useCallback(() => {
    if (hoverDelayRef.current !== null) {
      window.clearTimeout(hoverDelayRef.current);
      hoverDelayRef.current = null;
    }
    setPreviewEnabled(false);
  }, []);

  const startHoverPreview = useCallback(() => {
    if (!enableSpritePreview) return;
    if (hoverDelayRef.current !== null) window.clearTimeout(hoverDelayRef.current);
    hoverDelayRef.current = window.setTimeout(() => {
      hoverDelayRef.current = null;
      setPreviewEnabled(true);
    }, 450);
  }, [enableSpritePreview]);

  useEffect(() => stopHoverPreview, [stopHoverPreview]);

  return (
    <div
      className="theme-progress-track aspect-video flex items-center justify-center relative overflow-hidden"
      onMouseEnter={startHoverPreview}
      onMouseLeave={stopHoverPreview}
    >
      {children}
      {showSprite && (
        <div
          aria-label="视频缩略预览"
          role="img"
          className="pointer-events-none absolute inset-0 bg-black bg-cover"
          style={getResponsiveSpriteFrameStyle(video.id, meta, frame)}
        />
      )}
    </div>
  );
}

function VideoCardThumbnail({ video }: { video: VideoItem }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      {video.thumbnail ? (
        <img src={getThumbnailUrl(video.id)} alt={video.title} className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
      ) : (
        <PlayCircle size={28} className="text-[var(--border-medium)] transition-colors group-hover:text-[var(--accent)]" />
      )}
    </div>
  );
}

export function Pagination({ page, totalPages, onPageChange }: { page: number; totalPages: number; onPageChange: (p: number) => void }) {
  const [jumpVal, setJumpVal] = useState('');
  const pages = useMemo<(number | '...')[]>(() => {
    const next: (number | '...')[] = [];
    if (totalPages <= 11) {
      for (let i = 1; i <= totalPages; i++) next.push(i);
    } else {
      next.push(1);
      if (page > 4) next.push('...');
      const start = Math.max(2, page - 2);
      const end = Math.min(totalPages - 1, page + 2);
      for (let i = start; i <= end; i++) next.push(i);
      if (page < totalPages - 3) next.push('...');
      next.push(totalPages);
    }
    return next;
  }, [page, totalPages]);

  const handleJump = () => {
    const p = parseInt(jumpVal, 10);
    if (p >= 1 && p <= totalPages) {
      onPageChange(p);
      setJumpVal('');
    }
  };

  return (
    <div className="flex items-center justify-center gap-1 pt-2 flex-wrap">
      <button onClick={() => onPageChange(1)} disabled={page <= 1} className="rounded-lg px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-accent)] disabled:cursor-not-allowed disabled:opacity-30 transition-colors" title="第一页">«</button>
      <button onClick={() => onPageChange(page - 1)} disabled={page <= 1} className="rounded-lg px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-accent)] disabled:cursor-not-allowed disabled:opacity-30 transition-colors">上一页</button>
      {pages.map((p, i) => p === '...' ? (
        <span key={`e${i}`} className="px-1 text-xs text-[var(--text-muted)]">...</span>
      ) : (
        <button
          key={p}
          onClick={() => onPageChange(p)}
          className={`rounded-lg px-3 py-1 text-xs transition-colors ${p === page ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-accent)]'}`}
        >
          {p}
        </button>
      ))}
      <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} className="rounded-lg px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-accent)] disabled:cursor-not-allowed disabled:opacity-30 transition-colors">下一页</button>
      <button onClick={() => onPageChange(totalPages)} disabled={page >= totalPages} className="rounded-lg px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-accent)] disabled:cursor-not-allowed disabled:opacity-30 transition-colors" title="最后一页">»</button>
      {totalPages > 11 && (
        <div className="flex items-center gap-1 ml-2">
          <span className="text-xs text-[var(--text-muted)]">跳至</span>
          <input
            type="text"
            value={jumpVal}
            onChange={(e) => setJumpVal(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleJump()}
            placeholder={`${page}`}
            className="w-12 rounded-lg border border-[var(--border-light)] bg-[var(--bg-elevated)] px-1.5 py-1 text-center text-xs"
          />
          <span className="text-xs text-[var(--text-muted)]">/ {totalPages}</span>
          <button onClick={handleJump} className="rounded-lg bg-[var(--bg-accent)] px-2 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--border-light)]">GO</button>
        </div>
      )}
    </div>
  );
}

interface VideoNavigationCardsProps {
  continueVideo: VideoItem | null;
  historyVideos: VideoItem[];
  latestVideos: VideoItem[];
  latestFallback: boolean;
  gridMode: VideoGridMode;
  historySort: HistorySortMode;
  onGridModeChange: (mode: VideoGridMode) => void;
  onHistorySortChange: (mode: HistorySortMode) => void;
  onPlay: (videoId: number) => void;
}

export const VideoNavigationCards = React.memo(function VideoNavigationCards({
  continueVideo,
  historyVideos,
  latestVideos,
  latestFallback,
  gridMode,
  historySort,
  onGridModeChange,
  onHistorySortChange,
  onPlay,
}: VideoNavigationCardsProps) {
  const continueProgressPercent = getWatchProgressPercent(continueVideo?.watch_progress, continueVideo?.duration);
  const showHistory = useCallback(() => onGridModeChange('history'), [onGridModeChange]);
  const showLatest = useCallback(() => onGridModeChange('latest'), [onGridModeChange]);
  const playContinue = useCallback(() => {
    if (continueVideo) onPlay(continueVideo.id);
  }, [continueVideo, onPlay]);
  const historyMeta = useCallback(
    (video: VideoItem) => video.completed ? '已看完' : formatWatchProgress(video.watch_progress, video.duration),
    [],
  );
  const latestMeta = useCallback((video: VideoItem) => video.category_path || '全部视频', []);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[var(--text-primary)]">视频导航</span>
          <span className="text-xs text-[var(--text-muted)]">继续观看、历史记录与推荐</span>
        </div>
      </div>
      <div className="video-navigation-grid">
        <button
          onClick={playContinue}
          disabled={!continueVideo}
          className="theme-card min-w-0 overflow-hidden rounded-xl p-3 text-left transition-all hover:border-[var(--accent)]/50 hover:shadow-md disabled:cursor-default disabled:opacity-70"
        >
          <div className="flex h-full items-center gap-3">
            <div className="theme-progress-track relative aspect-video w-[7.25rem] shrink-0 overflow-hidden rounded-lg">
              {continueVideo?.thumbnail ? (
                <img src={getThumbnailUrl(continueVideo.id)} alt="" className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <PlayCircle size={22} className="absolute inset-0 m-auto text-[var(--text-muted)]" />
              )}
              {continueVideo && (
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/20">
                  <div className="theme-progress-fill h-full" style={{ width: `${continueProgressPercent ?? 0}%` }} />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1 self-center">
              <p className="text-xs font-medium text-[var(--accent)]">继续观看</p>
              <p className="theme-text-primary truncate text-sm font-semibold">{continueVideo?.title || '暂无未看完的视频'}</p>
              <p className="theme-text-muted mt-1 line-clamp-2 text-xs leading-4">
                {continueVideo ? `已看到 ${formatWatchProgress(continueVideo.watch_progress, continueVideo.duration)}` : '开始播放后会自动记录进度'}
              </p>
            </div>
            <PlayCircle size={22} className="shrink-0 text-[var(--accent)]" />
          </div>
        </button>

        <CompactVideoListCard
          title="最近观看"
          videos={historyVideos}
          active={gridMode === 'history'}
          emptyText="暂无历史记录"
          sortMode={historySort}
          onSortChange={onHistorySortChange}
          onShow={showHistory}
          onPlay={onPlay}
          meta={historyMeta}
        />

        <CompactVideoListCard
          title={latestFallback ? '当前列表' : '最新视频'}
          videos={latestVideos}
          active={gridMode === 'latest'}
          emptyText={latestFallback ? '暂无当前列表视频' : '暂无最新视频'}
          footnote={latestFallback && latestVideos.length > 0 ? '后端重启后会按最新入库排序。' : undefined}
          onShow={showLatest}
          onPlay={onPlay}
          meta={latestMeta}
        />

        <div className="min-w-0 rounded-xl border border-dashed border-[var(--border-light)] bg-[var(--bg-elevated)] p-3">
          <div className="mb-2 flex items-center gap-2">
            <Sparkles size={14} className="text-[var(--accent)]" />
            <span className="text-xs font-semibold text-[var(--text-primary)]">小助手推荐</span>
            <span className="rounded-full bg-[var(--bg-base)] px-1.5 py-0.5 text-xs text-[var(--text-muted)]">占位</span>
          </div>
          <div className="rounded-lg bg-[var(--bg-base)] px-3 py-4">
            <p className="text-xs font-medium text-[var(--text-primary)]">稍后根据观看历史推荐</p>
            <p className="mt-1 text-xs leading-4 text-[var(--text-muted)]">
              这里预留给灵境小助手：可按最近观看、字幕关键词、文件夹上下文推荐下一个视频。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
});

function CompactVideoListCard({
  title,
  videos,
  active,
  emptyText,
  footnote,
  sortMode,
  onSortChange,
  onShow,
  onPlay,
  meta,
}: {
  title: string;
  videos: VideoItem[];
  active: boolean;
  emptyText: string;
  footnote?: string;
  sortMode?: HistorySortMode;
  onSortChange?: (mode: HistorySortMode) => void;
  onShow: () => void;
  onPlay: (videoId: number) => void;
  meta: (video: VideoItem) => string;
}) {
  const sortedVideos = useMemo(() => {
    if (!sortMode || sortMode === 'newest') return videos;
    const sorted = [...videos];
    if (sortMode === 'oldest') sorted.reverse();
    if (sortMode === 'longest') sorted.sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0));
    return sorted;
  }, [videos, sortMode]);

  return (
    <div className="theme-card min-w-0 rounded-xl p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[var(--text-primary)]">{title}</span>
        <div className="flex items-center gap-1">
          {sortMode !== undefined && onSortChange && (
            <div className="flex items-center gap-0.5 mr-1">
              {([
                { mode: 'newest' as const, icon: ArrowDownWideNarrow, tip: '从新到旧' },
                { mode: 'oldest' as const, icon: ArrowUpWideNarrow, tip: '从旧到新' },
                { mode: 'longest' as const, icon: Clock, tip: '时长最长' },
              ]).map(({ mode, icon: Icon, tip }) => (
                <button
                  key={mode}
                  onClick={(e) => { e.stopPropagation(); onSortChange(mode); }}
                  className={`rounded p-0.5 transition-colors ${sortMode === mode ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
                  title={tip}
                >
                  <Icon size={11} />
                </button>
              ))}
            </div>
          )}
          <button onClick={onShow} disabled={videos.length === 0} className={`text-xs ${active ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--accent)]'}`}>
            {videos.length === 0 ? '0 个' : `${videos.length} 个 查看`}
          </button>
        </div>
      </div>
      <div className="space-y-1.5">
        {sortedVideos.slice(0, 3).map((video) => (
          <button key={video.id} onClick={() => onPlay(video.id)} className="flex w-full min-w-0 items-center gap-2 rounded-lg p-1.5 text-left transition-colors hover:bg-[var(--bg-accent)]">
            <div className="theme-progress-track relative h-8 w-12 shrink-0 overflow-hidden rounded">
              {video.thumbnail ? (
                <img src={getThumbnailUrl(video.id)} alt="" className="h-full w-full object-cover" loading="lazy" />
              ) : (
              <PlayCircle size={14} className="absolute inset-0 m-auto text-[var(--text-muted)]" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="theme-text-primary truncate text-xs font-medium">{video.title}</p>
              <p className="theme-text-muted truncate text-xs">{meta(video)}</p>
            </div>
          </button>
        ))}
        {footnote && <p className="theme-text-muted pt-1 text-xs leading-4">{footnote}</p>}
        {sortedVideos.length === 0 && <p className="rounded-lg border border-dashed border-[var(--border-light)] px-2 py-4 text-center text-xs text-[var(--text-muted)]">{emptyText}</p>}
      </div>
    </div>
  );
}

interface VideoGridSectionProps {
  loading: boolean;
  videos: VideoItem[];
  gridMode: VideoGridMode;
  gridTitle: string;
  columnsPerRow: number;
  onColumnsPerRowChange: (columns: number) => void;
  filesLabel?: string;
  isSearching: boolean;
  currentCategoryId: number | null;
  total: number;
  page: number;
  totalPages: number;
  searchQuery: string;
  onPlay: (videoId: number) => void;
  onToggleFavorite?: (videoId: number, nextFavorite: boolean) => void;
  onReturnToNormal: () => void;
  onPageChange: (page: number, searchQuery?: string) => void;
}

export function VideoGridSection({
  loading,
  videos,
  gridMode,
  gridTitle,
  columnsPerRow,
  onColumnsPerRowChange,
  filesLabel,
  isSearching,
  currentCategoryId,
  total,
  page,
  totalPages,
  searchQuery,
  onPlay,
  onToggleFavorite,
  onReturnToNormal,
  onPageChange,
}: VideoGridSectionProps) {
  const CLIENT_PAGE_SIZE = 20;
  const [historyPage, setHistoryPage] = useState(1);
  const isMobile = useIsMobile();
  const clientTotalPages = Math.max(1, Math.ceil(videos.length / CLIENT_PAGE_SIZE));

  // Reset page when gridMode changes or videos change
  useEffect(() => {
    if (historyPage !== 1) {
      const id = setTimeout(() => setHistoryPage(1), 0);
      return () => clearTimeout(id);
    }
  }, [gridMode, videos.length, historyPage]);

  const showPagination = gridMode === 'normal' ? totalPages > 1 : clientTotalPages > 1;
  const displayVideos = gridMode === 'normal'
    ? videos
    : videos.slice((historyPage - 1) * CLIENT_PAGE_SIZE, historyPage * CLIENT_PAGE_SIZE);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-[var(--text-muted)]">
        <Loader2 size={24} className="animate-spin mr-2" /> 加载中...
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="py-12 text-center text-[var(--text-muted)]">
        <Film size={40} className="mx-auto mb-3 opacity-40" />
        <p className="text-sm">{gridMode === 'history' ? '暂无历史记录' : gridMode === 'latest' ? '暂无最新视频' : (isSearching ? '没有匹配的视频' : '暂无视频')}</p>
        {gridMode === 'normal' && !isSearching && <p className="text-xs mt-1">请确认后端服务已启动且视频文件夹已配置</p>}
      </div>
    );
  }

  return (
    <>
      {gridMode !== 'normal' ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-[var(--text-muted)]">{gridTitle}</p>
          <button onClick={onReturnToNormal} className="rounded-lg px-2 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-accent)] hover:text-[var(--accent)]">
            返回当前列表
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-[var(--text-muted)]">
            {isSearching ? '匹配的视频' : filesLabel || (!currentCategoryId ? `共 ${total} 个视频` : '')}
          </p>
          <label className="flex items-center gap-1.5 rounded-lg border border-[var(--border-light)] bg-[var(--bg-card)] px-2 py-1 text-xs text-[var(--text-secondary)]">
            <Columns3 size={12} className="text-[var(--text-muted)]" />
            每行
            <select
              value={columnsPerRow}
              onChange={(event) => onColumnsPerRowChange(Number(event.target.value))}
              className="h-6 rounded-md border border-[var(--border-light)] bg-[var(--bg-elevated)] px-1.5 py-0 text-xs"
              title="设置当前视频列表每行显示的视频数量"
            >
              {[2, 3, 4, 5, 6, 7, 8].map((count) => (
                <option key={count} value={count}>{count}</option>
              ))}
            </select>
            个
          </label>
        </div>
      )}
      <div
        className="video-card-grid"
        style={{ '--video-grid-columns': columnsPerRow } as React.CSSProperties}
      >
        {displayVideos.map((v) => (
          <VideoCard
            key={v.id}
            video={v}
            onPlay={onPlay}
            onToggleFavorite={onToggleFavorite}
            enableSpritePreview={!isMobile}
          />
        ))}
      </div>
      {showPagination && (
        <Pagination
          page={gridMode === 'normal' ? page : historyPage}
          totalPages={gridMode === 'normal' ? totalPages : clientTotalPages}
          onPageChange={(p) => {
            if (gridMode === 'normal') onPageChange(p, searchQuery || undefined);
            else setHistoryPage(p);
          }}
        />
      )}
    </>
  );
}
