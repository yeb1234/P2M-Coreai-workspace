import React, { useEffect, useState } from 'react';
import { AlertCircle, ChevronRight, Folder, RefreshCw, Search } from 'lucide-react';
import { useVideoStore } from '../../stores/videoStore';
import {
  fetchContinueVideo,
  fetchRecentHistory,
  fetchRecentVideos,
  type CategoryTree,
  type VideoItem,
} from '../../lib/videoApi';
import { VideoGridSection, VideoNavigationCards, type VideoGridMode } from './VideoListSections';

export function VideoList() {
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
  const [gridMode, setGridMode] = useState<VideoGridMode>('normal');

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

  return (
    <div className="space-y-4">
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

      {!isSearching && currentCategoryId && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 text-sm flex-wrap">
            {breadcrumb.map((b, i) => (
              <React.Fragment key={b.id ?? 'root'}>
                {i > 0 && <ChevronRight size={12} className="text-[#b8b4ac]" />}
                <button
                  onClick={() => { setGridMode('normal'); goToBreadcrumb(b.id); }}
                  className={`hover:text-[#c87d2f] transition-colors ${i === breadcrumb.length - 1 ? 'text-[#1a1a1a] font-medium' : 'text-[#6b7280]'}`}
                >
                  {b.name}
                </button>
              </React.Fragment>
            ))}
          </div>
          <button onClick={() => loadCategoryTree()} className="p-2 text-[#6b7280] hover:text-[#c87d2f] hover:bg-[#f3f2ef] rounded-lg transition-colors" title="刷新文件夹结构">
            <RefreshCw size={14} />
          </button>
        </div>
      )}

      {!isSearching && children.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {children.map((cat) => {
            const displayName = cat.name.includes(' / ') ? cat.name.split(' / ').pop()! : cat.name;
            return (
              <button key={cat.id} onClick={() => { setGridMode('normal'); enterCategory(cat.id, displayName); }} className="flex items-center gap-3 p-3 bg-[#faf9f7] border border-[#e5e2dd] rounded-xl hover:shadow-md hover:border-[#c87d2f] transition-all text-left group">
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

      {isSearching && matchedFolders.length > 0 && (
        <div>
          <p className="text-xs text-[#9ca3af] mb-2">匹配的文件夹 ({matchedFolders.length})</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {matchedFolders.map((cat) => {
              const fullPath = cat.name;
              const displayName = fullPath.includes(' / ') ? fullPath.split(' / ').pop()! : fullPath;
              const parentPath = fullPath.includes(' / ') ? fullPath.split(' / ').slice(0, -1).join(' / ') : '';
              return (
                <button key={cat.id} onClick={() => { setGridMode('normal'); setInputVal(''); enterCategory(cat.id, displayName); }} className="flex items-center gap-3 p-3 bg-[#faf9f7] border border-[#e5e2dd] rounded-xl hover:shadow-md hover:border-[#c87d2f] transition-all text-left group">
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
        <VideoNavigationCards
          continueVideo={continueVideo}
          historyVideos={historyVideos}
          latestVideos={recentVideos}
          latestFallback={recentVideosFallback}
          gridMode={gridMode}
          onGridModeChange={setGridMode}
          onPlay={(videoId) => { void loadCurrentVideo(videoId); }}
        />
      )}

      {error && (
        <div className="flex items-center gap-2 p-3 bg-[#fef2f2] border border-[#fecaca] rounded-lg text-sm text-[#dc3545]">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      <VideoGridSection
        loading={loading}
        videos={gridVideos}
        gridMode={gridMode}
        gridTitle={gridTitle}
        isSearching={isSearching}
        currentCategoryId={currentCategoryId}
        total={total}
        page={page}
        totalPages={totalPages}
        searchQuery={searchQuery}
        onPlay={(videoId) => { void loadCurrentVideo(videoId); }}
        onReturnToNormal={() => setGridMode('normal')}
        onPageChange={(p, query) => loadVideos(p, query)}
      />
    </div>
  );
}
