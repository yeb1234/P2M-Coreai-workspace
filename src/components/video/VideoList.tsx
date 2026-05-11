import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckSquare, ChevronRight, Folder, RefreshCw, Search, Square, Scan } from 'lucide-react';
import { useVideoStore } from '../../stores/videoStore';
import {
  fetchContinueVideo,
  fetchRecentHistory,
  fetchRecentVideos,
  generateThumbnails,
  rescanVideos,
  type CategoryTree,
  type VideoItem,
} from '../../lib/videoApi';
import { VideoGridSection, VideoNavigationCards, type HistorySortMode, type VideoGridMode } from './VideoListSections';
import { playInteractionSound } from '../../lib/sounds';

interface FolderSearchGroup {
  key: string;
  parent: CategoryTree | null;
  parentLabel: string;
  parentPath: string;
  items: CategoryTree[];
}

function folderPathParts(category: CategoryTree): string[] {
  const path = category.full_path || category.name;
  return path.split(' / ').map((part) => part.trim()).filter(Boolean);
}

function folderDisplayName(category: CategoryTree): string {
  const parts = folderPathParts(category);
  return parts[parts.length - 1] || category.name;
}

function folderParentPath(category: CategoryTree): string {
  const parts = folderPathParts(category);
  return parts.slice(0, -1).join(' / ');
}

function groupFoldersByParent(items: CategoryTree[], allFolders: CategoryTree[]): FolderSearchGroup[] {
  const byId = new Map<number, CategoryTree>();
  const walk = (nodes: CategoryTree[]) => {
    nodes.forEach((node) => {
      byId.set(node.id, node);
      walk(node.children);
    });
  };
  walk(allFolders);

  const groups = new Map<string, FolderSearchGroup>();
  items.forEach((item) => {
    const parent = item.parent_id ? byId.get(item.parent_id) ?? null : null;
    const parentPath = parent ? (parent.full_path || parent.name) : '';
    const key = parent ? String(parent.id) : 'root';
    const existing = groups.get(key);
    const group = existing ?? {
      key,
      parent,
      parentLabel: parent ? folderDisplayName(parent) : '根目录',
      parentPath,
      items: [],
    };
    group.items.push(item);
    groups.set(key, group);
  });

  return Array.from(groups.values()).sort((a, b) => {
    if (a.key === 'root') return -1;
    if (b.key === 'root') return 1;
    return a.parentPath.localeCompare(b.parentPath, 'zh-CN');
  });
}

export function VideoList() {
  const {
    videos, total, page, totalPages, loading, error, loadVideos, loadCurrentVideo,
    searchQuery, setSearchQuery, categoryTree, breadcrumb, currentCategoryId,
    loadCategoryTree, enterCategory, goToBreadcrumb, getCurrentChildren,
    restoreNavigation, selectedFolderIds, setSelectedFolderIds,
  } = useVideoStore();
  const [inputVal, setInputVal] = useState('');
  const [navRestored, setNavRestored] = useState(false);
  const [continueVideo, setContinueVideo] = useState<VideoItem | null>(null);
  const [historyVideos, setHistoryVideos] = useState<VideoItem[]>([]);
  const [recentVideos, setRecentVideos] = useState<VideoItem[]>([]);
  const [recentVideosFallback, setRecentVideosFallback] = useState(false);
  const [gridMode, setGridMode] = useState<VideoGridMode>('normal');
  const [historySort, setHistorySort] = useState<HistorySortMode>('newest');
  const [rescanLoading, setRescanLoading] = useState(false);
  const [rescanMsg, setRescanMsg] = useState('');
  const selectedFolderIdSet = useMemo(() => new Set(selectedFolderIds), [selectedFolderIds]);
  const selectionChangedRef = React.useRef(false);

  const toggleFolderSelection = (id: number) => {
    selectionChangedRef.current = true;
    const next = selectedFolderIdSet.has(id)
      ? selectedFolderIds.filter((x) => x !== id)
      : [...selectedFolderIds, id];
    setSelectedFolderIds(next);
  };

  const handleRescan = async () => {
    setRescanLoading(true);
    setRescanMsg('');
    try {
      const result = await rescanVideos();
      playInteractionSound('success');
      setRescanMsg(`扫描完成：新增 ${result.added}，删除 ${result.removed}，共 ${result.total} 个视频`);
      loadCategoryTree();
      const ids = selectedFolderIds.length > 0 ? selectedFolderIds : undefined;
      loadVideos(1, searchQuery || undefined, ids);
    } catch {
      playInteractionSound('error');
      setRescanMsg('扫描失败');
    } finally {
      setRescanLoading(false);
      setTimeout(() => setRescanMsg(''), 4000);
    }
  };

  useEffect(() => { loadCategoryTree(); }, [loadCategoryTree]);
  useEffect(() => {
    restoreNavigation();
    setNavRestored(true);
  }, [restoreNavigation]);
  useEffect(() => {
    const onHashChange = () => {
      if (window.location.hash.replace(/^#\/?/, '').split('?')[0] === 'video') {
        restoreNavigation();
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [restoreNavigation]);
  useEffect(() => { selectionChangedRef.current = false; setSelectedFolderIds([]); }, [currentCategoryId, setSelectedFolderIds]);

  useEffect(() => {
    if (navRestored && searchQuery) setInputVal(searchQuery);
  }, [navRestored, searchQuery]);
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
    fetchRecentHistory(30)
      .then((history) => { if (!cancelled) setHistoryVideos(history); })
      .catch(() => { if (!cancelled) setHistoryVideos([]); });
    fetchRecentVideos(20, currentCategoryId)
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

  // Auto-generate thumbnails for visible videos without thumbnails
  const thumbRequestedRef = useRef(new Set<number>());
  const thumbReloadRef = useRef(false);
  useEffect(() => {
    const all = [...videos, ...historyVideos, ...recentVideos];
    if (continueVideo) all.push(continueVideo);
    const ids = all.filter((v) => !v.thumbnail && !thumbRequestedRef.current.has(v.id)).map((v) => v.id);
    if (ids.length === 0) return;
    ids.forEach((id) => thumbRequestedRef.current.add(id));
    generateThumbnails(ids).catch(() => {});
    // Poll once after 8s to pick up generated thumbnails
    thumbReloadRef.current = false;
    const timer = setTimeout(() => {
      if (thumbReloadRef.current) return;
      thumbReloadRef.current = true;
      const catIds = selectedFolderIds.length > 0 ? selectedFolderIds : undefined;
      loadVideos(1, searchQuery || undefined, catIds);
      fetchRecentHistory(30).then((h) => setHistoryVideos(h)).catch(() => {});
      fetchRecentVideos(20, currentCategoryId).then((r) => { setRecentVideos(r.items); setRecentVideosFallback(r.fallback); }).catch(() => {});
    }, 8000);
    return () => { clearTimeout(timer); };
  }, [videos, historyVideos, recentVideos, continueVideo]);

  const children = getCurrentChildren();
  const isSearching = !!inputVal.trim();

  const handleSearch = () => {
    setGridMode('normal');
    setSearchQuery(inputVal);
    selectionChangedRef.current = false;
    setSelectedFolderIds([]);
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
  const groupedMatchedFolders = useMemo(
    () => groupFoldersByParent(matchedFolders, categoryTree),
    [matchedFolders, categoryTree]
  );

  // Reload videos from backend when folder selection changes
  useEffect(() => {
    if (!selectionChangedRef.current) return;
    const ids = selectedFolderIds.length > 0 ? selectedFolderIds : undefined;
    loadVideos(1, undefined, ids);
  }, [selectedFolderIds, loadVideos]);

  const sortedHistoryVideos = useMemo(() => {
    if (historySort === 'newest') return historyVideos;
    const sorted = [...historyVideos];
    if (historySort === 'oldest') sorted.reverse();
    if (historySort === 'longest') sorted.sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0));
    return sorted;
  }, [historyVideos, historySort]);

  const baseGridVideos = gridMode === 'history' ? sortedHistoryVideos : gridMode === 'latest' ? recentVideos : videos;
  const gridTitle = gridMode === 'history'
    ? `最近观看（${historySort === 'oldest' ? '从旧到新' : historySort === 'longest' ? '时长最长' : '从新到旧'}）`
    : recentVideosFallback ? '当前列表' : '最新视频（从新到旧）';
  const filesLabel = gridMode === 'normal' && currentCategoryId && selectedFolderIds.length > 0
    ? `文件夹列表（${total} 个视频）`
    : undefined;

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
          <div className="flex items-center gap-1">
            <button onClick={() => loadCategoryTree()} className="p-2 text-[#6b7280] hover:text-[#c87d2f] hover:bg-[#f3f2ef] rounded-lg transition-colors" title="刷新文件夹结构">
              <RefreshCw size={14} />
            </button>
            <button onClick={handleRescan} disabled={rescanLoading} className="p-2 text-[#6b7280] hover:text-[#c87d2f] hover:bg-[#f3f2ef] rounded-lg transition-colors disabled:opacity-50" title="重新扫描视频文件">
              {rescanLoading ? <RefreshCw size={14} className="animate-spin" /> : <Scan size={14} />}
            </button>
          </div>
        </div>
      )}

      {rescanMsg && (
        <div className={`px-3 py-2 rounded-lg text-sm ${rescanMsg.includes('失败') ? 'bg-[#fef2f2] text-[#dc3545]' : 'bg-[#f0fdf4] text-[#16a34a]'}`}>
          {rescanMsg}
        </div>
      )}

      {!isSearching && children.length > 0 && (
        <div className="auto-grid-video">
          {children.map((cat) => {
            const displayName = cat.name.includes(' / ') ? cat.name.split(' / ').pop()! : cat.name;
            const checked = selectedFolderIdSet.has(cat.id);
            return (
              <div key={cat.id} className="flex items-center gap-2 p-3 bg-[#faf9f7] border border-[#e5e2dd] rounded-xl hover:shadow-md hover:border-[#c87d2f] transition-all group">
                <button
                  onClick={(e) => { e.stopPropagation(); toggleFolderSelection(cat.id); }}
                  className="shrink-0"
                  title={checked ? '取消筛选' : '筛选此文件夹'}
                >
                  {checked
                    ? <CheckSquare size={16} className="text-[#c87d2f]" />
                    : <Square size={16} className="text-[#b8b4ac] group-hover:text-[#6b7280]" />
                  }
                </button>
                <button onClick={() => { setGridMode('normal'); enterCategory(cat.id, displayName); }} className="flex items-center gap-2 min-w-0 flex-1 text-left">
                  <Folder size={20} className="text-[#c87d2f] shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[#1a1a1a] truncate group-hover:text-[#c87d2f] transition-colors">{displayName}</p>
                    <p className="text-[10px] text-[#9ca3af]">{cat.video_count} 个视频</p>
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {isSearching && matchedFolders.length > 0 && (
        <div>
          <p className="text-xs text-[#9ca3af] mb-2">匹配的文件夹 ({matchedFolders.length})</p>
          <div className="space-y-3">
            {groupedMatchedFolders.map((group) => (
              <div key={group.key} className="rounded-xl border border-[#e5e2dd] bg-[#faf9f7]/60 p-2.5">
                <div className="mb-2 flex items-center gap-2">
                  <Folder size={15} className="shrink-0 text-[#c87d2f]" />
                  {group.parent ? (
                    <button
                      type="button"
                      onClick={() => { setGridMode('normal'); setInputVal(''); enterCategory(group.parent!.id, group.parentLabel); }}
                      className="min-w-0 text-left"
                    >
                      <span className="block truncate text-xs font-semibold text-[#1a1a1a] hover:text-[#c87d2f]">{group.parentLabel}</span>
                      {group.parentPath && <span className="block truncate text-[10px] text-[#9ca3af]">{group.parentPath}</span>}
                    </button>
                  ) : (
                    <div className="min-w-0">
                      <span className="block truncate text-xs font-semibold text-[#1a1a1a]">{group.parentLabel}</span>
                      <span className="block truncate text-[10px] text-[#9ca3af]">视频目录根层级</span>
                    </div>
                  )}
                </div>
                <div className="ml-0 auto-grid-video sm:ml-5">
                  {group.items.map((cat) => {
                    const displayName = folderDisplayName(cat);
                    const parentPath = folderParentPath(cat);
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
            ))}
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
          historySort={historySort}
          onGridModeChange={setGridMode}
          onHistorySortChange={setHistorySort}
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
        videos={baseGridVideos}
        gridMode={gridMode}
        gridTitle={gridTitle}
        filesLabel={filesLabel}
        isSearching={isSearching}
        currentCategoryId={currentCategoryId}
        total={total}
        page={page}
        totalPages={totalPages}
        searchQuery={searchQuery}
        onPlay={(videoId) => { void loadCurrentVideo(videoId); }}
        onReturnToNormal={() => setGridMode('normal')}
        onPageChange={(p, query) => {
          const ids = selectedFolderIds.length > 0 ? selectedFolderIds : undefined;
          loadVideos(p, query, ids);
        }}
      />
    </div>
  );
}
