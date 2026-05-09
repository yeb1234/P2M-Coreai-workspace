import { useState } from 'react';
import { Film, Loader2, PlayCircle, Sparkles } from 'lucide-react';
import { getThumbnailUrl, type VideoItem } from '../../lib/videoApi';
import { formatVideoDuration } from './videoFormat';

export type VideoGridMode = 'normal' | 'history' | 'latest';

export function Pagination({ page, totalPages, onPageChange }: { page: number; totalPages: number; onPageChange: (p: number) => void }) {
  const [jumpVal, setJumpVal] = useState('');
  const pages: (number | '...')[] = [];
  if (totalPages <= 11) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 4) pages.push('...');
    const start = Math.max(2, page - 2);
    const end = Math.min(totalPages - 1, page + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    if (page < totalPages - 3) pages.push('...');
    pages.push(totalPages);
  }

  const handleJump = () => {
    const p = parseInt(jumpVal, 10);
    if (p >= 1 && p <= totalPages) {
      onPageChange(p);
      setJumpVal('');
    }
  };

  return (
    <div className="flex items-center justify-center gap-1 pt-2 flex-wrap">
      <button onClick={() => onPageChange(1)} disabled={page <= 1} className="px-2 py-1 rounded-lg text-xs text-[#6b7280] hover:bg-[#f3f2ef] disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="第一页">«</button>
      <button onClick={() => onPageChange(page - 1)} disabled={page <= 1} className="px-2 py-1 rounded-lg text-xs text-[#6b7280] hover:bg-[#f3f2ef] disabled:opacity-30 disabled:cursor-not-allowed transition-colors">上一页</button>
      {pages.map((p, i) => p === '...' ? (
        <span key={`e${i}`} className="px-1 text-xs text-[#b8b4ac]">...</span>
      ) : (
        <button
          key={p}
          onClick={() => onPageChange(p)}
          className={`px-3 py-1 rounded-lg text-xs transition-colors ${p === page ? 'bg-[#c87d2f] text-white' : 'text-[#6b7280] hover:bg-[#f3f2ef]'}`}
        >
          {p}
        </button>
      ))}
      <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} className="px-2 py-1 rounded-lg text-xs text-[#6b7280] hover:bg-[#f3f2ef] disabled:opacity-30 disabled:cursor-not-allowed transition-colors">下一页</button>
      <button onClick={() => onPageChange(totalPages)} disabled={page >= totalPages} className="px-2 py-1 rounded-lg text-xs text-[#6b7280] hover:bg-[#f3f2ef] disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="最后一页">»</button>
      {totalPages > 11 && (
        <div className="flex items-center gap-1 ml-2">
          <span className="text-[10px] text-[#9ca3af]">跳至</span>
          <input
            type="text"
            value={jumpVal}
            onChange={(e) => setJumpVal(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleJump()}
            placeholder={`${page}`}
            className="w-12 px-1.5 py-1 text-xs text-center bg-[#faf9f7] border border-[#e5e2dd] rounded-lg"
          />
          <span className="text-[10px] text-[#9ca3af]">/ {totalPages}</span>
          <button onClick={handleJump} className="px-2 py-1 text-xs bg-[#f3f2ef] rounded-lg hover:bg-[#e5e2dd] text-[#6b7280] transition-colors">GO</button>
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
  onGridModeChange: (mode: VideoGridMode) => void;
  onPlay: (videoId: number) => void;
}

export function VideoNavigationCards({
  continueVideo,
  historyVideos,
  latestVideos,
  latestFallback,
  gridMode,
  onGridModeChange,
  onPlay,
}: VideoNavigationCardsProps) {
  const toggleMode = (mode: VideoGridMode) => onGridModeChange(gridMode === mode ? 'normal' : mode);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[#1a1a1a]">视频导航</span>
          <span className="text-[10px] text-[#9ca3af]">继续观看、历史记录与推荐</span>
        </div>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_1fr_1fr_0.9fr] gap-2">
        <button
          onClick={() => { if (continueVideo) onPlay(continueVideo.id); }}
          disabled={!continueVideo}
          className="min-w-0 overflow-hidden rounded-xl border border-[#e5e2dd] bg-[#faf9f7] p-3 text-left hover:border-[#c87d2f]/50 hover:shadow-md disabled:cursor-default disabled:opacity-70 transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="relative h-16 w-28 shrink-0 overflow-hidden rounded-lg bg-[#e5e2dd]">
              {continueVideo?.thumbnail ? (
                <img src={getThumbnailUrl(continueVideo.id)} alt="" className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <PlayCircle size={22} className="absolute inset-0 m-auto text-[#b8b4ac]" />
              )}
              {continueVideo && (
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/20">
                  <div className="h-full bg-[#c87d2f]" style={{ width: `${continueVideo.duration ? Math.min(100, ((continueVideo.watch_progress || 0) / continueVideo.duration) * 100) : 0}%` }} />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-medium text-[#c87d2f]">继续观看</p>
              <p className="truncate text-sm font-semibold text-[#1a1a1a]">{continueVideo?.title || '暂无未看完的视频'}</p>
              <p className="mt-1 text-xs text-[#9ca3af]">
                {continueVideo ? `已看到 ${formatVideoDuration(continueVideo.watch_progress)} / ${formatVideoDuration(continueVideo.duration)}` : '开始播放后会自动记录进度'}
              </p>
            </div>
            <PlayCircle size={22} className="shrink-0 text-[#c87d2f]" />
          </div>
        </button>

        <CompactVideoListCard
          title="最近观看"
          videos={historyVideos}
          active={gridMode === 'history'}
          emptyText="暂无历史记录"
          onToggle={() => toggleMode('history')}
          onPlay={onPlay}
          meta={(video) => video.completed ? '已看完' : `${formatVideoDuration(video.watch_progress)} / ${formatVideoDuration(video.duration)}`}
        />

        <CompactVideoListCard
          title={latestFallback ? '当前列表' : '最新视频'}
          videos={latestVideos}
          active={gridMode === 'latest'}
          emptyText={latestFallback ? '暂无当前列表视频' : '暂无最新视频'}
          footnote={latestFallback && latestVideos.length > 0 ? '后端重启后会按最新入库排序。' : undefined}
          onToggle={() => toggleMode('latest')}
          onPlay={onPlay}
          meta={(video) => video.category_path || '全部视频'}
        />

        <div className="min-w-0 rounded-xl border border-dashed border-[#e5e2dd] bg-[#faf9f7] p-3">
          <div className="mb-2 flex items-center gap-2">
            <Sparkles size={14} className="text-[#c87d2f]" />
            <span className="text-xs font-semibold text-[#1a1a1a]">AI 推荐</span>
            <span className="rounded-full bg-[#f3f2ef] px-1.5 py-0.5 text-[9px] text-[#9ca3af]">占位</span>
          </div>
          <div className="rounded-lg bg-[#f3f2ef] px-3 py-4">
            <p className="text-xs font-medium text-[#1a1a1a]">稍后根据观看历史推荐</p>
            <p className="mt-1 text-[10px] leading-4 text-[#9ca3af]">
              这里预留给本地 AI：可按最近观看、字幕关键词、文件夹上下文推荐下一个视频。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function CompactVideoListCard({
  title,
  videos,
  active,
  emptyText,
  footnote,
  onToggle,
  onPlay,
  meta,
}: {
  title: string;
  videos: VideoItem[];
  active: boolean;
  emptyText: string;
  footnote?: string;
  onToggle: () => void;
  onPlay: (videoId: number) => void;
  meta: (video: VideoItem) => string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-[#e5e2dd] bg-[#faf9f7] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[#1a1a1a]">{title}</span>
        <button onClick={onToggle} disabled={videos.length === 0} className="text-[10px] text-[#9ca3af] hover:text-[#c87d2f]">
          {videos.length === 0 ? '0 个' : (active ? '收起' : `${videos.length} 个 查看`)}
        </button>
      </div>
      <div className="space-y-1.5">
        {videos.slice(0, 3).map((video) => (
          <button key={video.id} onClick={() => onPlay(video.id)} className="flex w-full min-w-0 items-center gap-2 rounded-lg p-1.5 text-left hover:bg-[#f3f2ef] transition-colors">
            <div className="relative h-8 w-12 shrink-0 overflow-hidden rounded bg-[#e5e2dd]">
              {video.thumbnail ? (
                <img src={getThumbnailUrl(video.id)} alt="" className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <PlayCircle size={14} className="absolute inset-0 m-auto text-[#b8b4ac]" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-[#1a1a1a]">{video.title}</p>
              <p className="truncate text-[10px] text-[#9ca3af]">{meta(video)}</p>
            </div>
          </button>
        ))}
        {footnote && <p className="pt-1 text-[10px] leading-4 text-[#9ca3af]">{footnote}</p>}
        {videos.length === 0 && <p className="rounded-lg border border-dashed border-[#e5e2dd] px-2 py-4 text-center text-xs text-[#9ca3af]">{emptyText}</p>}
      </div>
    </div>
  );
}

interface VideoGridSectionProps {
  loading: boolean;
  videos: VideoItem[];
  gridMode: VideoGridMode;
  gridTitle: string;
  isSearching: boolean;
  currentCategoryId: number | null;
  total: number;
  page: number;
  totalPages: number;
  searchQuery: string;
  onPlay: (videoId: number) => void;
  onReturnToNormal: () => void;
  onPageChange: (page: number, searchQuery?: string) => void;
}

export function VideoGridSection({
  loading,
  videos,
  gridMode,
  gridTitle,
  isSearching,
  currentCategoryId,
  total,
  page,
  totalPages,
  searchQuery,
  onPlay,
  onReturnToNormal,
  onPageChange,
}: VideoGridSectionProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-[#9ca3af]">
        <Loader2 size={24} className="animate-spin mr-2" /> 加载中...
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="text-center py-12 text-[#9ca3af]">
        <Film size={40} className="mx-auto mb-3 opacity-40" />
        <p className="text-sm">{gridMode === 'history' ? '暂无历史记录' : gridMode === 'latest' ? '暂无最新视频' : (isSearching ? '没有匹配的视频' : '暂无视频')}</p>
        {gridMode === 'normal' && !isSearching && <p className="text-xs mt-1">请确认后端服务已启动且视频文件夹已配置</p>}
      </div>
    );
  }

  return (
    <>
      {gridMode !== 'normal' ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-[#9ca3af]">{gridTitle}</p>
          <button onClick={onReturnToNormal} className="rounded-lg px-2 py-1 text-xs text-[#6b7280] hover:bg-[#f3f2ef] hover:text-[#c87d2f] transition-colors">
            返回当前列表
          </button>
        </div>
      ) : (
        <>
          {isSearching && <p className="text-xs text-[#9ca3af]">匹配的视频</p>}
          {!isSearching && !currentCategoryId && <p className="text-xs text-[#9ca3af]">共 {total} 个视频</p>}
        </>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
        {videos.map((v) => (
          <div key={v.id} onClick={() => onPlay(v.id)} className="bg-[#faf9f7] border border-[#e5e2dd] rounded-lg overflow-hidden hover:shadow-md transition-all cursor-pointer group">
            <div className="aspect-video bg-gradient-to-br from-[#f3f2ef] to-[#e5e2dd] flex items-center justify-center relative overflow-hidden">
              {v.thumbnail ? (
                <img src={getThumbnailUrl(v.id)} alt={v.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
              ) : (
                <PlayCircle size={28} className="text-[#d1cdc6] group-hover:text-[#c87d2f] transition-colors" />
              )}
              <span className="absolute bottom-1 right-1 bg-black/70 text-white text-[9px] px-1 py-0.5 rounded font-mono">{formatVideoDuration(v.duration)}</span>
              {v.completed && <span className="absolute top-1 left-1 bg-[#16a34a] text-white text-[9px] px-1 py-0.5 rounded">✓</span>}
              {v.watch_progress != null && v.duration && !v.completed && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-black/20">
                  <div className="h-full bg-[#c87d2f]" style={{ width: `${Math.min(100, (v.watch_progress / v.duration) * 100)}%` }} />
                </div>
              )}
            </div>
            <div className="px-2 py-1.5">
              <h4 className="text-xs font-medium text-[#1a1a1a] truncate group-hover:text-[#c87d2f] transition-colors">{v.title}</h4>
            </div>
          </div>
        ))}
      </div>
      {gridMode === 'normal' && totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onPageChange={(p) => onPageChange(p, searchQuery || undefined)} />
      )}
    </>
  );
}
