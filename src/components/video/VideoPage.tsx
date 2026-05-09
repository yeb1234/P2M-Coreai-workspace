import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  PlayCircle, Film, Search, ArrowLeft, Loader2, Sparkles,
  AlertCircle, CheckCircle2,
  RotateCcw, Subtitles, Folder, ChevronRight, RefreshCw,
  SkipBack, SkipForward, Volume2, VolumeX, List, Maximize, Minimize,
  PictureInPicture2, Pause, Play,
} from 'lucide-react';
import { PageTitle } from '../shared';
import { useVideoStore } from '../../stores/videoStore';
import { useTranscriptionStore } from '../../stores/transcriptionStore';
import { getVideoStreamUrl, getSubtitleFileUrl, getThumbnailUrl, getSpriteUrl, fetchPlaylist, fetchVideo, fetchContinueVideo, fetchRecentHistory, fetchRecentVideos, saveWatchHistory, type VideoItem, type SpriteMeta, type PlaylistItem, type CategoryTree, type TranscriptSegment } from '../../lib/videoApi';

// ── Pagination ──

function Pagination({ page, totalPages, onPageChange }: { page: number; totalPages: number; onPageChange: (p: number) => void }) {
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
      <button
        onClick={() => onPageChange(1)}
        disabled={page <= 1}
        className="px-2 py-1 rounded-lg text-xs text-[#6b7280] hover:bg-[#f3f2ef] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        title="第一页"
      >
        «
      </button>
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className="px-2 py-1 rounded-lg text-xs text-[#6b7280] hover:bg-[#f3f2ef] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        上一页
      </button>
      {pages.map((p, i) =>
        p === '...' ? (
          <span key={`e${i}`} className="px-1 text-xs text-[#b8b4ac]">...</span>
        ) : (
          <button
            key={p}
            onClick={() => onPageChange(p)}
            className={`px-3 py-1 rounded-lg text-xs transition-colors ${
              p === page ? 'bg-[#c87d2f] text-white' : 'text-[#6b7280] hover:bg-[#f3f2ef]'
            }`}
          >
            {p}
          </button>
        )
      )}
      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        className="px-2 py-1 rounded-lg text-xs text-[#6b7280] hover:bg-[#f3f2ef] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        下一页
      </button>
      <button
        onClick={() => onPageChange(totalPages)}
        disabled={page >= totalPages}
        className="px-2 py-1 rounded-lg text-xs text-[#6b7280] hover:bg-[#f3f2ef] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        title="最后一页"
      >
        »
      </button>
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
          <button
            onClick={handleJump}
            className="px-2 py-1 text-xs bg-[#f3f2ef] rounded-lg hover:bg-[#e5e2dd] text-[#6b7280] transition-colors"
          >
            GO
          </button>
        </div>
      )}
    </div>
  );
}

// ── Video List ──

function VideoList() {
  const {
    videos, total, page, totalPages, loading, error, loadVideos, loadCurrentVideo,
    searchQuery, setSearchQuery, categoryTree, breadcrumb, currentCategoryId,
    loadCategoryTree, enterCategory, goToBreadcrumb, getCurrentChildren,
  } = useVideoStore();
  const [inputVal, setInputVal] = useState('');
  const [continueVideo, setContinueVideo] = useState<VideoItem | null>(null);
  const [historyVideos, setHistoryVideos] = useState<VideoItem[]>([]);
  const [recentVideos, setRecentVideos] = useState<VideoItem[]>([]);
  const [recentVideosFallback, setRecentVideosFallback] = useState(false);
  const [gridMode, setGridMode] = useState<'normal' | 'history' | 'latest'>('normal');

  useEffect(() => { loadCategoryTree(); }, [loadCategoryTree]);
  useEffect(() => { loadVideos(); }, [loadVideos]);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setContinueVideo(null);
      setHistoryVideos([]);
      setRecentVideos([]);
      setRecentVideosFallback(false);
    });

    fetchContinueVideo()
      .then((video) => { if (!cancelled) setContinueVideo(video); })
      .catch(() => { if (!cancelled) setContinueVideo(null); });
    fetchRecentHistory(8)
      .then((history) => { if (!cancelled) setHistoryVideos(history); })
      .catch(() => { if (!cancelled) setHistoryVideos([]); });
    fetchRecentVideos(8, currentCategoryId)
      .then((recent) => {
        if (!cancelled) {
          setRecentVideos(recent.items);
          setRecentVideosFallback(recent.fallback);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRecentVideos([]);
          setRecentVideosFallback(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentCategoryId]);

  const children = getCurrentChildren();
  const isSearching = !!inputVal.trim();

  const handleSearch = () => {
    setGridMode('normal');
    setSearchQuery(inputVal);
    loadVideos(1, inputVal || undefined);
  };

  // search folders by name across entire tree
  const searchFolders = (q: string): CategoryTree[] => {
    const results: CategoryTree[] = [];
    const lower = q.toLowerCase();
    const walk = (nodes: CategoryTree[]) => {
      for (const n of nodes) {
        const displayName = n.name.includes(' / ') ? n.name.split(' / ').pop()! : n.name;
        if (displayName.toLowerCase().includes(lower)) results.push(n);
        walk(n.children);
      }
    };
    walk(categoryTree);
    return results;
  };

  const matchedFolders = isSearching ? searchFolders(inputVal) : [];
  const gridVideos = gridMode === 'history' ? historyVideos : gridMode === 'latest' ? recentVideos : videos;
  const gridTitle = gridMode === 'history'
    ? '最近观看（从新到旧）'
    : recentVideosFallback ? '当前列表' : '最新视频（从新到旧）';

  const formatDuration = (sec: number | null) => {
    if (!sec) return '--:--';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  void ((v: VideoItem) => {
    if (v.ai_status === 'completed') return <span className="text-[10px] px-1.5 py-0.5 bg-[#dcfce7] text-[#16a34a] rounded">已完成</span>;
    if (v.ai_status === 'running') return <span className="text-[10px] px-1.5 py-0.5 bg-[#fef7ed] text-[#c87d2f] rounded flex items-center gap-1"><Loader2 size={10} className="animate-spin" />处理中</span>;
    if (v.ai_status === 'queued') return <span className="text-[10px] px-1.5 py-0.5 bg-[#eff6ff] text-[#2563eb] rounded">排队中</span>;
    if (v.ai_status === 'failed') return <span className="text-[10px] px-1.5 py-0.5 bg-[#fef2f2] text-[#dc3545] rounded">失败</span>;
    return null;
  });

  return (
      <div className="space-y-4">
        {/* Search - always on top */}
        <div className="relative max-w-xl">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
        <input
          type="text"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="搜索视频或文件夹..."
          className="w-full pl-10 pr-4 py-2.5 bg-[#faf9f7] border border-[#e5e2dd] rounded-xl text-sm"
        />
      </div>

      {/* Breadcrumb (only when inside a folder) */}
      {!isSearching && currentCategoryId && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 text-sm flex-wrap">
            {breadcrumb.map((b, i) => (
              <React.Fragment key={b.id ?? 'root'}>
                {i > 0 && <ChevronRight size={12} className="text-[#b8b4ac]" />}
                <button
                  onClick={() => { setGridMode('normal'); goToBreadcrumb(b.id); }}
                  className={`hover:text-[#c87d2f] transition-colors ${
                    i === breadcrumb.length - 1 ? 'text-[#1a1a1a] font-medium' : 'text-[#6b7280]'
                  }`}
                >
                  {b.name}
                </button>
              </React.Fragment>
            ))}
          </div>
          <button
            onClick={() => loadCategoryTree()}
            className="p-2 text-[#6b7280] hover:text-[#c87d2f] hover:bg-[#f3f2ef] rounded-lg transition-colors"
            title="刷新文件夹结构"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      )}

      {/* Folder grid - show subfolders when browsing, or matching folders when searching */}
      {!isSearching && children.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {children.map((cat) => {
            const displayName = cat.name.includes(' / ') ? cat.name.split(' / ').pop()! : cat.name;
            return (
              <button
                key={cat.id}
                onClick={() => { setGridMode('normal'); enterCategory(cat.id, displayName); }}
                className="flex items-center gap-3 p-3 bg-[#faf9f7] border border-[#e5e2dd] rounded-xl hover:shadow-md hover:border-[#c87d2f] transition-all text-left group"
              >
                <Folder size={20} className="text-[#c87d2f] shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[#1a1a1a] truncate group-hover:text-[#c87d2f] transition-colors">{displayName}</p>
                  <p className="text-[10px] text-[#9ca3af]">{cat.video_count} 个视频</p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Matched folders when searching */}
      {isSearching && matchedFolders.length > 0 && (
        <div>
          <p className="text-xs text-[#9ca3af] mb-2">匹配的文件夹 ({matchedFolders.length})</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {matchedFolders.map((cat) => {
              const fullPath = cat.name;
              const displayName = fullPath.includes(' / ') ? fullPath.split(' / ').pop()! : fullPath;
              const parentPath = fullPath.includes(' / ') ? fullPath.split(' / ').slice(0, -1).join(' / ') : '';
              return (
                <button
                  key={cat.id}
                  onClick={() => { setGridMode('normal'); setInputVal(''); enterCategory(cat.id, displayName); }}
                  className="flex items-center gap-3 p-3 bg-[#faf9f7] border border-[#e5e2dd] rounded-xl hover:shadow-md hover:border-[#c87d2f] transition-all text-left group"
                >
                  <Folder size={20} className="text-[#c87d2f] shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[#1a1a1a] truncate group-hover:text-[#c87d2f] transition-colors">{displayName}</p>
                    {parentPath && <p className="text-[10px] text-[#b8b4ac] truncate">{parentPath}</p>}
                    <p className="text-[10px] text-[#9ca3af]">{cat.video_count} 个视频</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!isSearching && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[#1a1a1a]">视频导航</span>
              <span className="text-[10px] text-[#9ca3af]">继续观看、历史记录与推荐</span>
            </div>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_1fr_1fr_0.9fr] gap-2">
            <button
              onClick={() => { if (continueVideo) void loadCurrentVideo(continueVideo.id); }}
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
                      <div
                        className="h-full bg-[#c87d2f]"
                        style={{ width: `${continueVideo.duration ? Math.min(100, ((continueVideo.watch_progress || 0) / continueVideo.duration) * 100) : 0}%` }}
                      />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-medium text-[#c87d2f]">继续观看</p>
                  <p className="truncate text-sm font-semibold text-[#1a1a1a]">{continueVideo?.title || '暂无未看完的视频'}</p>
                  <p className="mt-1 text-xs text-[#9ca3af]">
                    {continueVideo ? `已看到 ${formatDuration(continueVideo.watch_progress)} / ${formatDuration(continueVideo.duration)}` : '开始播放后会自动记录进度'}
                  </p>
                </div>
                <PlayCircle size={22} className="shrink-0 text-[#c87d2f]" />
              </div>
            </button>

            <div className="min-w-0 rounded-xl border border-[#e5e2dd] bg-[#faf9f7] p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#1a1a1a]">最近观看</span>
                <button
                  onClick={() => setGridMode((mode) => mode === 'history' ? 'normal' : 'history')}
                  disabled={historyVideos.length === 0}
                  className="text-[10px] text-[#9ca3af] hover:text-[#c87d2f]"
                >
                  {historyVideos.length === 0 ? '0 个' : (gridMode === 'history' ? '收起' : `${historyVideos.length} 个 查看`)}
                </button>
              </div>
              <div className="space-y-1.5">
                {historyVideos.slice(0, 3).map((video) => (
                  <button
                    key={video.id}
                    onClick={() => { void loadCurrentVideo(video.id); }}
                    className="flex w-full min-w-0 items-center gap-2 rounded-lg p-1.5 text-left hover:bg-[#f3f2ef] transition-colors"
                  >
                    <div className="relative h-8 w-12 shrink-0 overflow-hidden rounded bg-[#e5e2dd]">
                      {video.thumbnail ? (
                        <img src={getThumbnailUrl(video.id)} alt="" className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <PlayCircle size={14} className="absolute inset-0 m-auto text-[#b8b4ac]" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-[#1a1a1a]">{video.title}</p>
                      <p className="text-[10px] text-[#9ca3af]">
                        {video.completed ? '已看完' : `${formatDuration(video.watch_progress)} / ${formatDuration(video.duration)}`}
                      </p>
                    </div>
                  </button>
                ))}
                {historyVideos.length === 0 && (
                  <p className="rounded-lg border border-dashed border-[#e5e2dd] px-2 py-4 text-center text-xs text-[#9ca3af]">暂无历史记录</p>
                )}
              </div>
            </div>

            <div className="min-w-0 rounded-xl border border-[#e5e2dd] bg-[#faf9f7] p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#1a1a1a]">{recentVideosFallback ? '当前列表' : '最新视频'}</span>
                <button
                  onClick={() => setGridMode((mode) => mode === 'latest' ? 'normal' : 'latest')}
                  disabled={recentVideos.length === 0}
                  className="text-[10px] text-[#9ca3af] hover:text-[#c87d2f]"
                >
                  {recentVideos.length === 0 ? '0 个' : (gridMode === 'latest' ? '收起' : `${recentVideos.length} 个 查看`)}
                </button>
              </div>
              <div className="space-y-1.5">
                {recentVideos.slice(0, 3).map((video) => (
                  <button
                    key={video.id}
                    onClick={() => { void loadCurrentVideo(video.id); }}
                    className="flex w-full min-w-0 items-center gap-2 rounded-lg p-1.5 text-left hover:bg-[#f3f2ef] transition-colors"
                  >
                    <div className="relative h-8 w-12 shrink-0 overflow-hidden rounded bg-[#e5e2dd]">
                      {video.thumbnail ? (
                        <img src={getThumbnailUrl(video.id)} alt="" className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <PlayCircle size={14} className="absolute inset-0 m-auto text-[#b8b4ac]" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-[#1a1a1a]">{video.title}</p>
                      <p className="truncate text-[10px] text-[#9ca3af]">{video.category_path || '全部视频'}</p>
                    </div>
                  </button>
                ))}
                {recentVideosFallback && recentVideos.length > 0 && (
                  <p className="pt-1 text-[10px] leading-4 text-[#9ca3af]">后端重启后会按最新入库排序。</p>
                )}
                {recentVideos.length === 0 && (
                  <p className="rounded-lg border border-dashed border-[#e5e2dd] px-2 py-4 text-center text-xs text-[#9ca3af]">{recentVideosFallback ? '暂无当前列表视频' : '暂无最新视频'}</p>
                )}
              </div>
            </div>

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
      )}

      {error && (
        <div className="flex items-center gap-2 p-3 bg-[#fef2f2] border border-[#fecaca] rounded-lg text-sm text-[#dc3545]">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-[#9ca3af]">
          <Loader2 size={24} className="animate-spin mr-2" /> 加载中...
        </div>
      ) : gridVideos.length === 0 ? (
        <div className="text-center py-12 text-[#9ca3af]">
          <Film size={40} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">{gridMode === 'history' ? '暂无历史记录' : gridMode === 'latest' ? '暂无最新视频' : (isSearching ? '没有匹配的视频' : '暂无视频')}</p>
          {gridMode === 'normal' && !isSearching && <p className="text-xs mt-1">请确认后端服务已启动且视频文件夹已配置</p>}
        </div>
      ) : (
        <>
          {gridMode !== 'normal' ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-[#9ca3af]">{gridTitle}</p>
              <button
                onClick={() => setGridMode('normal')}
                className="rounded-lg px-2 py-1 text-xs text-[#6b7280] hover:bg-[#f3f2ef] hover:text-[#c87d2f] transition-colors"
              >
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
            {gridVideos.map((v) => (
              <div
                key={v.id}
                onClick={() => { void loadCurrentVideo(v.id); }}
                className="bg-[#faf9f7] border border-[#e5e2dd] rounded-lg overflow-hidden hover:shadow-md transition-all cursor-pointer group"
              >
                <div className="aspect-video bg-gradient-to-br from-[#f3f2ef] to-[#e5e2dd] flex items-center justify-center relative overflow-hidden">
                  {v.thumbnail ? (
                    <img
                      src={getThumbnailUrl(v.id)}
                      alt={v.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                    />
                  ) : (
                    <PlayCircle size={28} className="text-[#d1cdc6] group-hover:text-[#c87d2f] transition-colors" />
                  )}
                  <span className="absolute bottom-1 right-1 bg-black/70 text-white text-[9px] px-1 py-0.5 rounded font-mono">
                    {formatDuration(v.duration)}
                  </span>
                  {v.completed && (
                    <span className="absolute top-1 left-1 bg-[#16a34a] text-white text-[9px] px-1 py-0.5 rounded">
                      ✓
                    </span>
                  )}
                  {v.watch_progress != null && v.duration && !v.completed && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-black/20">
                      <div
                        className="h-full bg-[#c87d2f]"
                        style={{ width: `${Math.min(100, (v.watch_progress / v.duration) * 100)}%` }}
                      />
                    </div>
                  )}
                </div>
                <div className="px-2 py-1.5">
                  <h4 className="text-xs font-medium text-[#1a1a1a] truncate group-hover:text-[#c87d2f] transition-colors">
                    {v.title}
                  </h4>
                </div>
              </div>
            ))}
          </div>
          {gridMode === 'normal' && totalPages > 1 && (
            <Pagination
              page={page}
              totalPages={totalPages}
              onPageChange={(p) => loadVideos(p, searchQuery || undefined)}
            />
          )}
        </>
      )}
    </div>
  );
}

// ── Sprite Preview ──

function useSpriteMeta(videoId: number | null) {
  const [meta, setMeta] = useState<SpriteMeta | null>(null);
  useEffect(() => {
    if (!videoId) return;
    let cancelled = false;
    fetch(getSpriteUrl(videoId))
      .then((r) => {
        const raw = r.headers.get('X-Sprite-Meta');
        if (raw && !cancelled) setMeta(JSON.parse(raw));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [videoId]);
  return videoId ? meta : null;
}

function SpritePreview({ videoId, time }: { videoId: number; time: number }) {
  const meta = useSpriteMeta(videoId);
  if (!meta) return null;

  const frameIdx = Math.floor(time / meta.frame_interval);
  const col = frameIdx % meta.cols;
  const row = Math.floor(frameIdx / meta.cols);
  const scale = 3;

  return (
    <div className="bg-black rounded-lg overflow-hidden shadow-2xl border border-white/20">
      <img
        src={getSpriteUrl(videoId)}
        alt=""
        style={{
          width: meta.frame_width * scale,
          height: meta.frame_height * scale,
          objectFit: 'none',
          objectPosition: `-${col * meta.frame_width * scale}px -${row * meta.frame_height * scale}px`,
        }}
        draggable={false}
      />
    </div>
  );
}

// ── Custom Slider (div-based, fills edge to edge) ──

function Slider({ value, min, max, step, onChange, className = '', dark = false }: {
  value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; className?: string; dark?: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const pct = ((value - min) / (max - min)) * 100;

  const getValue = useCallback((clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const raw = min + ratio * (max - min);
    return Math.round(raw / step) * step;
  }, [min, max, step]);

  const handleDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    onChange(getValue(e.clientX));
    const onMove = (ev: MouseEvent) => { if (dragging.current) onChange(getValue(ev.clientX)); };
    const onUp = () => { dragging.current = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [getValue, onChange]);

  return (
    <div
      ref={trackRef}
      className={`relative h-[6px] rounded-full cursor-pointer group/slider ${dark ? 'bg-white/20' : 'bg-[#d1cdc6]'} ${className}`}
      onMouseDown={handleDown}
    >
      <div
        className={`absolute inset-y-0 left-0 rounded-full ${dark ? 'bg-white/70' : 'bg-[#c87d2f]'}`}
        style={{ width: `${pct}%` }}
      />
      <div
        className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full shadow-sm border-2 pointer-events-none opacity-0 group-hover/slider:opacity-100 transition-opacity ${dark ? 'bg-white border-white/50' : 'bg-[#c87d2f] border-white'}`}
        style={{ left: `calc(${pct}% - 6px)` }}
      />
    </div>
  );
}

// ── Video Player ──

const PLAYER_SPEED_MIN = 0.5;
const PLAYER_SPEED_MAX = 2;
const PLAYER_SPEED_STEP = 0.1;
const PLAYER_SETTINGS_KEY = 'p2m-video-player-settings';

interface PlayerSettings {
  showSubtitles: boolean;
  subtitleOpacity: number;
  subtitleSize: number;
  autoPlay: boolean;
  playbackRate: number;
  volume: number;
  muted: boolean;
}

const DEFAULT_PLAYER_SETTINGS: PlayerSettings = {
  showSubtitles: false,
  subtitleOpacity: 1,
  subtitleSize: 100,
  autoPlay: true,
  playbackRate: 1,
  volume: 1,
  muted: false,
};

function loadPlayerSettings(): PlayerSettings {
  try {
    const raw = localStorage.getItem(PLAYER_SETTINGS_KEY);
    if (!raw) return DEFAULT_PLAYER_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<PlayerSettings>;
    return {
      showSubtitles: typeof parsed.showSubtitles === 'boolean' ? parsed.showSubtitles : DEFAULT_PLAYER_SETTINGS.showSubtitles,
      subtitleOpacity: typeof parsed.subtitleOpacity === 'number' ? Math.max(0, Math.min(1, parsed.subtitleOpacity)) : DEFAULT_PLAYER_SETTINGS.subtitleOpacity,
      subtitleSize: typeof parsed.subtitleSize === 'number' ? Math.max(50, Math.min(200, parsed.subtitleSize)) : DEFAULT_PLAYER_SETTINGS.subtitleSize,
      autoPlay: typeof parsed.autoPlay === 'boolean' ? parsed.autoPlay : DEFAULT_PLAYER_SETTINGS.autoPlay,
      playbackRate: typeof parsed.playbackRate === 'number' ? clampPlaybackRate(parsed.playbackRate) : DEFAULT_PLAYER_SETTINGS.playbackRate,
      volume: typeof parsed.volume === 'number' ? Math.max(0, Math.min(1, parsed.volume)) : DEFAULT_PLAYER_SETTINGS.volume,
      muted: typeof parsed.muted === 'boolean' ? parsed.muted : DEFAULT_PLAYER_SETTINGS.muted,
    };
  } catch {
    return DEFAULT_PLAYER_SETTINGS;
  }
}

function savePlayerSettings(settings: PlayerSettings) {
  localStorage.setItem(PLAYER_SETTINGS_KEY, JSON.stringify(settings));
}

function clampPlaybackRate(value: number): number {
  const next = Math.max(PLAYER_SPEED_MIN, Math.min(PLAYER_SPEED_MAX, value));
  return Math.round(next * 10) / 10;
}

function playlistItemToVideoItem(item: PlaylistItem): VideoItem {
  return {
    ...item,
    filename: item.title,
    filepath: '',
    file_size: 0,
    duration: null,
    tags: null,
    category_id: null,
    transcription: null,
    transcript_segments: [],
    summary: null,
    markdown_path: null,
    subtitle_path: null,
    ai_status: 'idle',
    ai_stage: null,
    ai_error: null,
    active_job_id: null,
    created_at: '',
    updated_at: '',
  };
}

function normalizeSegment(segment: TranscriptSegment): TranscriptSegment | null {
  const rawStart = Number(segment.start);
  const rawEnd = Number(segment.end);
  const text = String(segment.text || '').trim();
  if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || !text) return null;
  const start = rawStart > 1000 ? rawStart / 1000 : rawStart;
  const end = rawEnd > 1000 ? rawEnd / 1000 : rawEnd;
  if (end <= start) return null;
  return { start, end, text };
}

function VideoPlayerView() {
  const { currentVideo, currentSegments, jobStatus, jobStage, triggerAi, clearSelection, selectVideo, loadCurrentVideo } = useVideoStore();
  const whisperModel = useTranscriptionStore((s) => s.whisperModel);
  const transcriptionLanguage = useTranscriptionStore((s) => s.language);
  const doSummary = useTranscriptionStore((s) => s.doSummary);
  const wordLimit = useTranscriptionStore((s) => s.wordLimit);
  const cpuThreads = useTranscriptionStore((s) => s.cpuThreads);
  const computeType = useTranscriptionStore((s) => s.computeType);
  const beamSize = useTranscriptionStore((s) => s.beamSize);
  const bestOf = useTranscriptionStore((s) => s.bestOf);
  const temperature = useTranscriptionStore((s) => s.temperature);
  const vadFilter = useTranscriptionStore((s) => s.vadFilter);
  const subtitleCorrectionEnabled = useTranscriptionStore((s) => s.subtitleCorrectionEnabled);
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const playlistResizeRef = useRef({ active: false, startX: 0, startWidth: 360 });
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPlayingRef = useRef(false);
  const initialSettings = useMemo(() => loadPlayerSettings(), []);
  const settingsRef = useRef<PlayerSettings>(initialSettings);
  const lastVolumeRef = useRef(initialSettings.volume || 1);
  const playAfterLoadRef = useRef(false);
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
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
  const [playlistIdx, setPlaylistIdx] = useState(-1);
  const [playlistPanelWidth, setPlaylistPanelWidth] = useState(360);
  const [showControls, setShowControls] = useState(true);
  const [volume, setVolume] = useState(initialSettings.volume);
  const [isMuted, setIsMuted] = useState(initialSettings.muted);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [mediaError, setMediaError] = useState('');

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

  // Load playlist
  useEffect(() => {
    if (!currentVideo) return;
    let cancelled = false;
    fetchPlaylist(currentVideo.id).then((p) => {
      if (cancelled) return;
      setPlaylist(p.videos);
      setPlaylistIdx(p.current_index);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [currentVideo]);

  // Controls visibility: show on mouse move, hide after 3s
  const resetHideTimer = useCallback(() => {
    setShowControls(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 3000);
  }, [isPlaying]);

  useEffect(() => {
    if (!isPlaying) {
      queueMicrotask(() => setShowControls(true));
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    }
  }, [isPlaying]);

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
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const formatTime = useCallback((sec: number) => {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
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

  const seekBy = useCallback((seconds: number) => {
    const v = videoRef.current;
    if (!v) return;
    const duration = Number.isFinite(v.duration) ? v.duration : videoDuration;
    const next = Math.max(0, Math.min(duration || 0, v.currentTime + seconds));
    v.currentTime = next;
    setProgress(next);
  }, [videoDuration]);

  // Close menus on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-speed-menu]') && !target.closest('[data-speed-btn]')) setShowSpeedMenu(false);
      if (!target.closest('[data-subtitle-menu]') && !target.closest('[data-subtitle-btn]')) setShowSubtitleMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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

  const selectPlaylistItem = useCallback(async (item: PlaylistItem, playAfterLoad = false) => {
    playAfterLoadRef.current = playAfterLoad;
    setPlaylistIdx((idx) => {
      const nextIdx = playlist.findIndex((playlistItem) => playlistItem.id === item.id);
      return nextIdx >= 0 ? nextIdx : idx;
    });
    try {
      const fresh = await fetchVideo(item.id);
      selectVideo(fresh);
    } catch {
      selectVideo(playlistItemToVideoItem(item));
    }
  }, [playlist, selectVideo]);

  const handleEnded = useCallback(() => {
    if (!autoPlay || playlist.length === 0) return;
    const currentIdx = playlist.findIndex((item) => item.id === currentVideo?.id);
    const nextIdx = (currentIdx >= 0 ? currentIdx : playlistIdx) + 1;
    if (nextIdx < playlist.length) {
      void selectPlaylistItem(playlist[nextIdx], true);
    }
  }, [autoPlay, currentVideo?.id, playlist, playlistIdx, selectPlaylistItem]);

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

  const stopControlClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  useEffect(() => {
    if (!currentVideo) return;
    const handler = (e: KeyboardEvent) => {
      const v = videoRef.current;
      if (!v) return;
      const target = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return;

      switch (e.key) {
        case 'ArrowLeft': e.preventDefault(); seekBy(-5); break;
        case 'ArrowRight': e.preventDefault(); seekBy(5); break;
        case 'ArrowUp': e.preventDefault(); handleVolumeChange(v.volume + 0.1); break;
        case 'ArrowDown': e.preventDefault(); handleVolumeChange(v.volume - 0.1); break;
        case ' ': case 'k': case 'K': e.preventDefault(); togglePlay(); break;
        case '[': e.preventDefault(); setPlaybackRate((r) => { const next = clampPlaybackRate(r - PLAYER_SPEED_STEP); v.playbackRate = next; return next; }); break;
        case ']': e.preventDefault(); setPlaybackRate((r) => { const next = clampPlaybackRate(r + PLAYER_SPEED_STEP); v.playbackRate = next; return next; }); break;
        case 'm': case 'M': e.preventDefault(); toggleMute(); break;
        case 'f': case 'F': e.preventDefault(); toggleFullscreen(); break;
        case 'i': case 'I': e.preventDefault(); togglePip(); break;
        case 'c': case 'C': if (hasSubtitle) { e.preventDefault(); toggleSubtitles(); } break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentVideo, handleVolumeChange, hasSubtitle, seekBy, toggleFullscreen, toggleMute, togglePip, togglePlay, toggleSubtitles]);

  useEffect(() => {
    if (!dragging) return;
    const bar = progressBarRef.current;
    const handleMove = (e: MouseEvent) => {
      if (!bar || !videoRef.current) return;
      const rect = bar.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const next = pct * videoDuration;
      videoRef.current.currentTime = next;
      setProgress(next);
    };
    const handleUp = () => setDragging(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [dragging, videoDuration]);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!playlistResizeRef.current.active) return;
      const delta = playlistResizeRef.current.startX - e.clientX;
      setPlaylistPanelWidth(Math.max(280, Math.min(560, playlistResizeRef.current.startWidth + delta)));
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    };
    const handleUp = () => {
      playlistResizeRef.current.active = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, []);

  const isProcessing = jobStatus === 'running' || jobStatus === 'queued';
  const progressPct = videoDuration > 0 ? (progress / videoDuration) * 100 : 0;

  if (!currentVideo) return null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={clearSelection} className="p-2 rounded-lg hover:bg-[#f3f2ef] text-[#6b7280] transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-[#1a1a1a] truncate">{currentVideo.title}</h2>
          <p className="text-xs text-[#9ca3af]">{currentVideo.filename}</p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        {/* Player column */}
        <div className="min-w-0 flex-1 space-y-3">
          {/* Video container with overlay controls */}
          <div
            ref={videoContainerRef}
            className="aspect-video bg-black rounded-xl overflow-hidden relative select-none"
            onMouseMove={resetHideTimer}
            onMouseLeave={() => { if (isPlaying) setShowControls(false); }}
            style={{ cursor: showControls ? 'default' : 'none' }}
          >
            <video
                key={videoKey}
                ref={videoRef}
                src={videoUrl}
                className="w-full h-full"
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
              onClick={togglePlay}
              onDoubleClick={toggleFullscreen}
            />

            {mediaError && (
              <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/75 px-6 text-center">
                <div className="max-w-md rounded-xl border border-white/15 bg-black/50 p-4 text-sm leading-6 text-white shadow-xl">
                  <p className="font-medium">{mediaError}</p>
                  <p className="mt-1 text-xs text-white/60">如果只在个别视频出现，多半是编码、文件路径或浏览器解码兼容问题。字幕已改为不再阻塞视频加载。</p>
                </div>
              </div>
            )}

            {showSubtitles && activeSubtitleText && (
              <div
                className="absolute inset-x-4 bottom-16 z-10 pointer-events-none flex justify-center"
                style={{ opacity: subtitleOpacity }}
              >
                <div
                  className="max-w-[86%] rounded-md bg-black/65 px-3 py-1.5 text-center text-white leading-snug shadow-lg"
                  style={{ fontSize: `${Math.max(12, Math.round(18 * subtitleSize / 100))}px` }}
                >
                  {activeSubtitleText}
                </div>
              </div>
            )}

            {/* Center play button when paused */}
            {!isPlaying && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                <div className="w-16 h-16 bg-black/40 backdrop-blur-sm rounded-full flex items-center justify-center">
                  <Play size={28} className="text-white ml-1" />
                </div>
              </div>
            )}

            {/* ── Overlay Controls ── */}
            <div
              className={`absolute inset-x-0 bottom-0 z-20 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
              onClick={stopControlClick}
              onDoubleClick={stopControlClick}
            >
              {/* Gradient background */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent pointer-events-none" />

              <div className="relative px-3 pb-2 pt-8">
                {/* Progress bar */}
                {videoDuration > 0 && (
                  <div
                    ref={progressBarRef}
                    className="relative h-[3px] hover:h-[6px] bg-white/20 rounded-full cursor-pointer mb-2 transition-all duration-150 group/progress"
                    onMouseDown={handleProgressMouseDown}
                    onMouseMove={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                      setHoverTime(pct * videoDuration);
                      const containerRect = videoContainerRef.current?.getBoundingClientRect();
                      setPlayerWidth(containerRect?.width ?? 800);
                      setHoverX(e.clientX - (containerRect?.left ?? 0));
                    }}
                    onMouseLeave={() => setHoverTime(null)}
                  >
                    {/* Played */}
                    <div
                      className="absolute inset-y-0 left-0 bg-[#c87d2f] rounded-full"
                      style={{ width: `${progressPct}%` }}
                    />
                    {/* Thumb */}
                    <div
                      className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-[#c87d2f] rounded-full shadow-sm opacity-0 group-hover/progress:opacity-100 transition-opacity"
                      style={{ left: `calc(${progressPct}% - 6px)` }}
                    />
                    {/* Sprite preview */}
                    {hoverTime !== null && (
                      <div
                        className="absolute bottom-full mb-3 pointer-events-none z-30"
                        style={{
                          left: Math.max(84, Math.min(hoverX, playerWidth - 84)),
                          transform: 'translateX(-50%)',
                        }}
                      >
                        <SpritePreview videoId={currentVideo.id} time={hoverTime} />
                        <div className="text-center text-[10px] text-white mt-1 font-mono bg-black/70 rounded px-1">
                          {formatTime(hoverTime)}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Controls row */}
                <div className="flex items-center gap-1">
                  {/* Left: Play controls */}
                  <button
                    onClick={togglePlay}
                    className="p-1.5 text-white/80 hover:text-white transition-colors"
                    title={isPlaying ? '暂停 (空格)' : '播放 (空格)'}
                  >
                    {isPlaying ? <Pause size={20} /> : <Play size={20} />}
                  </button>
                  <button
                    onClick={() => seekBy(-10)}
                    className="p-1.5 text-white/80 hover:text-white transition-colors"
                    title="后退10秒"
                  >
                    <SkipBack size={16} />
                  </button>
                  <button
                    onClick={() => seekBy(10)}
                    className="p-1.5 text-white/80 hover:text-white transition-colors"
                    title="前进10秒"
                  >
                    <SkipForward size={16} />
                  </button>

                  {/* Volume */}
                  <div className="flex items-center gap-1 group/vol">
                    <button
                      onClick={toggleMute}
                      className="p-1.5 text-white/80 hover:text-white transition-colors"
                      title={isMuted ? '取消静音 (M)' : '静音 (M)'}
                    >
                      {isMuted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                    </button>
                    <div className="w-0 group-hover/vol:w-20 overflow-hidden transition-all duration-200">
                      <Slider
                        value={isMuted ? 0 : volume}
                        min={0}
                        max={1}
                        step={0.05}
                        onChange={handleVolumeChange}
                        className="w-20"
                      />
                    </div>
                  </div>

                  {/* Time */}
                  <span className="text-[11px] text-white/70 font-mono ml-2 select-none">
                    {formatTime(progress)} / {formatTime(videoDuration)}
                  </span>

                  <div className="flex-1" />

                  {/* Right: Subtitle, Speed, PiP, Fullscreen */}

                  {/* Subtitle */}
                  {hasSubtitle && (
                    <div className="relative">
                      <button
                        data-subtitle-btn
                        onClick={() => { setShowSubtitleMenu(!showSubtitleMenu); setShowSpeedMenu(false); }}
                        className={`p-1.5 transition-colors ${showSubtitles ? 'text-[#c87d2f]' : 'text-white/80 hover:text-white'}`}
                        title="字幕"
                      >
                        <Subtitles size={16} />
                      </button>
                      {showSubtitleMenu && (
                        <div data-subtitle-menu className="absolute bottom-full right-0 mb-2 bg-black/90 backdrop-blur-sm rounded-lg p-3 min-w-[180px] space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-white/70">字幕</span>
                            <button
                              onClick={toggleSubtitles}
                              className={`px-2 py-0.5 text-[10px] rounded ${showSubtitles ? 'bg-[#c87d2f] text-white' : 'bg-white/10 text-white/60'}`}
                            >
                              {showSubtitles ? '开' : '关'}
                            </button>
                          </div>
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] text-white/50">透明度</span>
                              <span className="text-[10px] text-white/70">{Math.round(subtitleOpacity * 100)}%</span>
                            </div>
                            <Slider value={subtitleOpacity} min={0} max={1} step={0.05} onChange={setSubtitleOpacity} className="w-full" dark />
                          </div>
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] text-white/50">字号</span>
                              <span className="text-[10px] text-white/70">{subtitleSize}%</span>
                            </div>
                            <Slider value={subtitleSize} min={50} max={200} step={10} onChange={setSubtitleSize} className="w-full" />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Speed */}
                  <div className="relative">
                    <button
                      data-speed-btn
                      onClick={() => { setShowSpeedMenu(!showSpeedMenu); setShowSubtitleMenu(false); }}
                      className="px-1.5 py-1 text-[11px] text-white/80 hover:text-white transition-colors font-medium"
                      title="倍速"
                    >
                      {playbackRate === 1 ? '倍速' : `${playbackRate.toFixed(1)}x`}
                    </button>
                    {showSpeedMenu && (
                        <div data-speed-menu className="absolute bottom-full right-0 mb-2 bg-black/90 backdrop-blur-sm rounded-lg p-3 min-w-[190px] space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-xs text-white/70">倍速</span>
                            <span className="text-xs text-white/90 font-mono">{playbackRate.toFixed(1)}x</span>
                          </div>
                          <Slider
                            value={playbackRate}
                            min={PLAYER_SPEED_MIN}
                            max={PLAYER_SPEED_MAX}
                            step={PLAYER_SPEED_STEP}
                            onChange={(next) => {
                              const rate = clampPlaybackRate(next);
                              setPlaybackRate(rate);
                              if (videoRef.current) videoRef.current.playbackRate = rate;
                            }}
                            className="w-full"
                            dark
                          />
                          <div className="flex items-center justify-between text-[10px] text-white/45 font-mono">
                            <span>0.5x</span>
                            <span>2.0x</span>
                          </div>
                        </div>
                    )}
                  </div>

                  {/* PiP */}
                  <button
                    onClick={togglePip}
                    className="p-1.5 text-white/80 hover:text-white transition-colors"
                    title="画中画"
                  >
                    <PictureInPicture2 size={16} />
                  </button>

                  {/* Fullscreen */}
                  <button
                    onClick={toggleFullscreen}
                    className="p-1.5 text-white/80 hover:text-white transition-colors"
                    title={isFullscreen ? '退出全屏 (F)' : '全屏 (F)'}
                  >
                    {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="theme-surface rounded-xl border p-4">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles size={15} className="text-[#c87d2f]" />
              <h3 className="text-sm font-semibold text-[#1a1a1a]">AI 总结</h3>
              {isProcessing && (
                <span className="ml-auto flex items-center gap-1.5 text-xs text-[#c87d2f]">
                  <Loader2 size={12} className="animate-spin" />
                  {jobStage === 'extracting' ? '正在提取音频' : jobStage === 'transcribing' ? '正在生成字幕' : jobStage === 'summarizing' ? '正在生成总结' : '处理中'}
                </span>
              )}
              {jobStatus === 'failed' && (
                <span className="ml-auto flex items-center gap-1.5 text-xs text-[#dc3545]">
                  <AlertCircle size={12} />
                  失败
                </span>
              )}
            </div>
            {currentVideo.summary ? (
              <div className="whitespace-pre-wrap text-sm leading-7 text-[#1a1a1a]">
                {currentVideo.summary}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-[#e5e2dd] bg-[#faf9f7] px-3 py-4 text-sm text-[#6b7280]">
                {isProcessing ? 'AI 正在生成字幕和总结，完成后会显示在这里。' : '还没有总结。点击右侧“生成字幕与总结”后，会自动生成字幕、转录和总结。'}
              </div>
            )}
          </div>
        </div>

        {/* Right panel: folder video list */}
        <div className="relative space-y-3 lg:shrink-0" style={{ width: `${playlistPanelWidth}px` }}>
          <div
            className="group hidden lg:flex absolute -left-4 top-0 bottom-0 w-4 cursor-col-resize items-center justify-center"
            onMouseDown={(e) => {
              e.preventDefault();
              playlistResizeRef.current = { active: true, startX: e.clientX, startWidth: playlistPanelWidth };
              document.body.style.cursor = 'col-resize';
              document.body.style.userSelect = 'none';
            }}
            title="拖动调整文件夹视频宽度"
          >
            <div className="h-full w-px bg-[#e5e2dd] group-hover:bg-[#c87d2f]" />
            <div className="absolute h-12 w-1 rounded-full bg-[#d1cdc6] opacity-70 group-hover:bg-[#c87d2f] group-hover:opacity-100" />
          </div>
          <div className="theme-surface rounded-xl border p-3">
            <div className="flex items-center gap-2">
              <p className="shrink-0 text-sm font-semibold text-[#1a1a1a]">学习操作</p>
              {jobStatus === 'completed' && (
                <span className="shrink-0 flex items-center gap-1 text-[10px] text-[#16a34a]">
                  <CheckCircle2 size={12} />
                  AI 已完成
                </span>
              )}
              <div className="ml-auto flex min-w-0 items-center gap-2">
              {!isProcessing ? (
                <button
                  onClick={() => triggerAi(currentVideo.id, {
                    whisper_model: whisperModel,
                    language: transcriptionLanguage,
                    do_summary: doSummary,
                    word_limit: wordLimit,
                    cpu_threads: cpuThreads,
                    compute_type: computeType,
                    beam_size: beamSize,
                    best_of: bestOf,
                    temperature,
                    vad_filter: vadFilter,
                    subtitle_correction_enabled: subtitleCorrectionEnabled,
                  })}
                    className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[#c87d2f] px-3 py-2 text-xs font-medium text-white hover:bg-[#b06d20]"
                >
                  {jobStatus === "completed" ? <RotateCcw size={13} /> : <Sparkles size={13} />}
                  {jobStatus === "completed" ? "重新生成" : "生成字幕与总结"}
                </button>
              ) : (
                  <div className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[#fef7ed] px-3 py-2 text-xs font-medium text-[#c87d2f]">
                  <Loader2 size={13} className="animate-spin" />
                  处理中
                </div>
              )}
              <button
                onClick={() => setAutoPlay(!autoPlay)}
                  className={`flex shrink-0 items-center justify-center rounded-lg px-3 py-2 text-xs font-medium transition-colors ${autoPlay ? "bg-[#16a34a] text-white" : "bg-[#f3f2ef] text-[#6b7280] hover:bg-[#e5e2dd]"}`}
                title="播放结束后自动播放下一个视频"
              >
                自动连播{autoPlay ? "开" : "关"}
              </button>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <List size={14} className="text-[#6b7280]" />
            <span className="text-xs font-medium text-[#1a1a1a]">文件夹视频</span>
            <span className="text-[10px] text-[#9ca3af]">{playlist.length}个</span>
          </div>
          <div className="h-[60vh] overflow-y-auto space-y-1 pr-1">
            {playlist.map((item) => (
              <div
                key={item.id}
                onClick={() => { void selectPlaylistItem(item); }}
                className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${
                  item.id === currentVideo.id
                    ? 'bg-[#fef7ed] border border-[#fde68a]'
                    : 'hover:bg-[#f3f2ef]'
                }`}
              >
                <div className="w-20 h-12 bg-[#e5e2dd] rounded overflow-hidden shrink-0 relative">
                  {item.thumbnail ? (
                    <img src={getThumbnailUrl(item.id)} alt="" className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <PlayCircle size={16} className="absolute inset-0 m-auto text-[#b8b4ac]" />
                  )}
                  {item.id === currentVideo.id && isPlaying && (
                    <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                      <div className="flex gap-0.5">
                        <div className="w-0.5 h-3 bg-white rounded animate-pulse" />
                        <div className="w-0.5 h-4 bg-white rounded animate-pulse" style={{ animationDelay: '0.15s' }} />
                        <div className="w-0.5 h-2 bg-white rounded animate-pulse" style={{ animationDelay: '0.3s' }} />
                      </div>
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-xs truncate ${item.id === currentVideo.id ? 'text-[#c87d2f] font-medium' : 'text-[#1a1a1a]'}`}>
                    {item.title}
                  </p>
                  {item.completed && (
                    <span className="text-[9px] text-[#16a34a]">已看完</span>
                  )}
                  {item.watch_progress != null && !item.completed && (
                    <div className="mt-1 h-0.5 bg-[#e5e2dd] rounded-full overflow-hidden">
                      <div className="h-full bg-[#c87d2f] rounded-full" style={{ width: `${Math.min(100, (item.watch_progress / (item.watch_progress + 60)) * 100)}%` }} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──

export const VideoPage: React.FC = () => {
  const currentVideo = useVideoStore((s) => s.currentVideo);
  const restoreCurrentVideo = useVideoStore((s) => s.restoreCurrentVideo);

  useEffect(() => {
    restoreCurrentVideo();
  }, [restoreCurrentVideo]);

  return (
    <div className="w-full pt-2 space-y-6">
      {!currentVideo && (
        <PageTitle
          title="视频站"
          subtitle="本地视频学习，AI 字幕转录 + 智能总结"
          icon={<PlayCircle size={22} />}
        />
      )}
      {currentVideo ? <VideoPlayerView /> : <VideoList />}
    </div>
  );
};
