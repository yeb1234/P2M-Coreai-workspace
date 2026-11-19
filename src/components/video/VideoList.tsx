import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckSquare, ChevronRight, Folder, PlayCircle, RefreshCw, Search, Square } from 'lucide-react';
import { markVideoAutoplay, openVideoAt } from '../../lib/videoNavigation';
import { userScopedStorage } from '../../lib/userScopedStorage';
import { useVideoStore } from '../../stores/videoStore';
import {
  fetchContinueVideo,
  fetchRecentHistory,
  fetchRecentVideos,
  generateThumbnails,
  type CategoryTree,
  type VideoItem,
} from '../../lib/videoApi';
import { VideoGridSection, VideoNavigationCards, type HistorySortMode, type VideoGridMode } from './VideoListSections';

const VIDEO_GRID_COLUMNS_KEY = 'p2m_video_grid_columns';
const DEFAULT_VIDEO_GRID_COLUMNS = 5;
const MAX_THUMBNAIL_BATCH_SIZE = 12;

function loadVideoGridColumns(): number {
  try {
    const raw = Number(userScopedStorage.getItem(VIDEO_GRID_COLUMNS_KEY));
    return Number.isFinite(raw) && raw >= 2 && raw <= 8 ? raw : DEFAULT_VIDEO_GRID_COLUMNS;
  } catch {
    return DEFAULT_VIDEO_GRID_COLUMNS;
  }
}

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

const FolderTile = React.memo(function FolderTile({
  category,
  checked,
  onSelect,
  onEnter,
}: {
  category: CategoryTree;
  checked: boolean;
  onSelect: (id: number) => void;
  onEnter: (id: number, name: string) => void;
}) {
  const displayName = folderDisplayName(category);

  return (
    <div className="flex items-center gap-2 p-3 bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl hover:shadow-md hover:border-[var(--accent)] transition-all group">
      <button
        onClick={(e) => { e.stopPropagation(); onSelect(category.id); }}
        className="shrink-0"
        title={checked ? '取消筛选' : '筛选此文件夹'}
      >
        {checked
          ? <CheckSquare size={16} className="text-[var(--accent)]" />
          : <Square size={16} className="text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]" />
        }
      </button>
      <button onClick={() => onEnter(category.id, displayName)} className="flex items-center gap-2 min-w-0 flex-1 text-left">
        <Folder size={20} className="text-[var(--accent)] shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[var(--text-primary)] truncate group-hover:text-[var(--accent)] transition-colors">{displayName}</p>
          <p className="text-xs text-[var(--text-muted)]">{category.video_count} 个视频</p>
        </div>
      </button>
    </div>
  );
});

/** 秒 → mm:ss。片段搜索里显示时间点用。 */
function formatClock(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const SearchFolderTile = React.memo(function SearchFolderTile({
  category,
  onEnter,
}: {
  category: CategoryTree;
  onEnter: (id: number, name: string) => void;
}) {
  const displayName = folderDisplayName(category);
  const parentPath = folderParentPath(category);

  return (
    <button onClick={() => onEnter(category.id, displayName)} className="flex items-center gap-3 p-3 bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl hover:shadow-md hover:border-[var(--accent)] transition-all text-left group">
      <Folder size={20} className="text-[var(--accent)] shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-[var(--text-primary)] truncate group-hover:text-[var(--accent)] transition-colors">{displayName}</p>
        {parentPath && <p className="text-xs text-[var(--text-muted)] truncate">{parentPath}</p>}
        <p className="text-xs text-[var(--text-muted)]">{category.video_count} 个视频</p>
      </div>
    </button>
  );
});

const FolderSearchGroupCard = React.memo(function FolderSearchGroupCard({
  group,
  onEnterParent,
  onEnterFolder,
}: {
  group: FolderSearchGroup;
  onEnterParent: (id: number, name: string) => void;
  onEnterFolder: (id: number, name: string) => void;
}) {
  return (
    <div className="rounded-xl border border-[var(--border-light)] bg-[var(--bg-elevated)]/60 p-2.5">
      <div className="mb-2 flex items-center gap-2">
        <Folder size={15} className="shrink-0 text-[var(--accent)]" />
        {group.parent ? (
          <button
            type="button"
            onClick={() => onEnterParent(group.parent!.id, group.parentLabel)}
            className="min-w-0 text-left"
          >
            <span className="block truncate text-xs font-semibold text-[var(--text-primary)] hover:text-[var(--accent)]">{group.parentLabel}</span>
            {group.parentPath && <span className="block truncate text-xs text-[var(--text-muted)]">{group.parentPath}</span>}
          </button>
        ) : (
          <div className="min-w-0">
            <span className="block truncate text-xs font-semibold text-[var(--text-primary)]">{group.parentLabel}</span>
            <span className="block truncate text-xs text-[var(--text-muted)]">视频目录根层级</span>
          </div>
        )}
      </div>
      <div className="ml-0 auto-grid-video sm:ml-5">
        {group.items.map((cat) => (
          <SearchFolderTile key={cat.id} category={cat} onEnter={onEnterFolder} />
        ))}
      </div>
    </div>
  );
});

export function VideoList() {
  const {
    videos, total, page, totalPages, loading, error, loadVideos, loadCurrentVideo,
    searchQuery, setSearchQuery, categoryTree, breadcrumb, currentCategoryId,
    loadCategoryTree, enterCategory, goToBreadcrumb, getCurrentChildren,
    restoreNavigation, selectedFolderIds, setSelectedFolderIds, toggleFavorite,
    searchResults, doSearch,
  } = useVideoStore();
  const [inputVal, setInputVal] = useState('');
  // 搜索范围：标题/文件夹（默认，走 loadVideos）
  //        vs 字幕内容（走 hybrid_search，带章节线索和 rerank）
  //
  // 后者原来只有 AI 助手能用 —— 用户想找「哪段字幕提到 XX」只能去问助手。
  // 后端 /api/videos/search/segments 已改走同一条混合检索链路。
  const [searchMode, setSearchMode] = useState<'title' | 'segments'>('title');
  const [navRestored, setNavRestored] = useState(false);
  const [continueVideo, setContinueVideo] = useState<VideoItem | null>(null);
  const [historyVideos, setHistoryVideos] = useState<VideoItem[]>([]);
  const [recentVideos, setRecentVideos] = useState<VideoItem[]>([]);
  const [recentVideosFallback, setRecentVideosFallback] = useState(false);
  const [gridMode, setGridMode] = useState<VideoGridMode>('normal');
  const [historySort, setHistorySort] = useState<HistorySortMode>('newest');
  const [columnsPerRow, setColumnsPerRow] = useState(loadVideoGridColumns);
  const [refreshLoading, setRefreshLoading] = useState(false);
  const [rescanMsg, setRescanMsg] = useState('');
  const selectedFolderIdSet = useMemo(() => new Set(selectedFolderIds), [selectedFolderIds]);
  const selectionChangedRef = React.useRef(false);

  const toggleFolderSelection = useCallback((id: number) => {
    selectionChangedRef.current = true;
    const next = selectedFolderIdSet.has(id)
      ? selectedFolderIds.filter((x) => x !== id)
      : [...selectedFolderIds, id];
    setSelectedFolderIds(next);
  }, [selectedFolderIdSet, selectedFolderIds, setSelectedFolderIds]);

  const handleRefreshFolders = useCallback(async () => {
    setRefreshLoading(true);
    try {
      await loadCategoryTree();
      const state = useVideoStore.getState();
      const ids = state.selectedFolderIds.length > 0 ? state.selectedFolderIds : undefined;
      await loadVideos(state.page, state.searchQuery || undefined, ids);
      const recent = await fetchRecentVideos(20, state.currentCategoryId);
      setRecentVideos(recent.items);
      setRecentVideosFallback(recent.fallback);
      const history = await fetchRecentHistory(30);
      setHistoryVideos(history);
    } catch (e: unknown) {
      setRescanMsg(`刷新失败: ${e instanceof Error ? e.message : '未知错误'}`);
      setTimeout(() => setRescanMsg(''), 4000);
    } finally {
      setRefreshLoading(false);
    }
  }, [loadCategoryTree, loadVideos]);

  useEffect(() => { loadCategoryTree(); }, [loadCategoryTree]);
  useEffect(() => {
    restoreNavigation();
    const id = setTimeout(() => setNavRestored(true), 0);
    return () => clearTimeout(id);
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
    if (navRestored && searchQuery) {
      const id = setTimeout(() => setInputVal(searchQuery), 0);
      return () => clearTimeout(id);
    }
  }, [navRestored, searchQuery]);
  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(() => {
      if (cancelled) return;
      setContinueVideo(null);
      setHistoryVideos([]);
      setRecentVideos([]);
      setRecentVideosFallback(false);
    }, 0);

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
      clearTimeout(id);
    };
  }, [currentCategoryId]);

  // Auto-generate thumbnails for visible videos without thumbnails
  const thumbRequestedRef = useRef(new Set<number>());
  const thumbReloadRef = useRef(false);
  useEffect(() => {
    const all = [...videos, ...historyVideos, ...recentVideos];
    if (continueVideo) all.push(continueVideo);
    const ids = all
      .filter((v) => !v.thumbnail && !thumbRequestedRef.current.has(v.id))
      .slice(0, MAX_THUMBNAIL_BATCH_SIZE)
      .map((v) => v.id);
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
  }, [videos, historyVideos, recentVideos, continueVideo, selectedFolderIds, loadVideos, searchQuery, currentCategoryId]);

  const children = useMemo(() => getCurrentChildren(), [categoryTree, currentCategoryId]);
  const isSearching = !!inputVal.trim();

  const handleSearch = useCallback(() => {
    const query = inputVal.trim();
    if (searchMode === 'segments') {
      // 字幕搜索：不走分页视频列表，直接打混合检索
      void doSearch(query);
      return;
    }
    const previousQuery = searchQuery.trim();
    if (query === previousQuery && selectedFolderIds.length === 0) return;
    setGridMode('normal');
    setSearchQuery(query);
    selectionChangedRef.current = false;
    setSelectedFolderIds([]);
    loadVideos(1, query || undefined);
  }, [inputVal, loadVideos, searchQuery, selectedFolderIds.length, setSearchQuery, setSelectedFolderIds, searchMode, doSearch]);

  const handleColumnsPerRowChange = useCallback((columns: number) => {
    const next = Math.max(2, Math.min(8, columns));
    setColumnsPerRow(next);
    try {
      userScopedStorage.setItem(VIDEO_GRID_COLUMNS_KEY, String(next));
    } catch {
      // ignore storage quota or private mode failures
    }
  }, []);

  const enterFolderFromList = useCallback((id: number, name: string) => {
    setGridMode('normal');
    enterCategory(id, name);
  }, [enterCategory]);

  const enterFolderFromSearch = useCallback((id: number, name: string) => {
    setGridMode('normal');
    setInputVal('');
    enterCategory(id, name);
  }, [enterCategory]);

  const matchedFolders = useMemo(() => {
    const query = inputVal.trim().toLowerCase();
    if (!query) return [];
    const results: CategoryTree[] = [];
    const walk = (nodes: CategoryTree[]) => {
      for (const n of nodes) {
        const displayName = n.name.includes(' / ') ? n.name.split(' / ').pop()! : n.name;
        if (displayName.toLowerCase().includes(query)) results.push(n);
        walk(n.children);
      }
    };
    walk(categoryTree);
    return results;
  }, [categoryTree, inputVal]);
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
  const playVideo = useCallback((videoId: number) => {
    // 点卡片就是明确的“播放”动作，不是打开详情页看封面。
    // 标记给播放器，等 metadata 就绪后自动开始，避免用户看到画面却停在暂停态。
    markVideoAutoplay(videoId);
    void loadCurrentVideo(videoId);
  }, [loadCurrentVideo]);
  const toggleVideoFavorite = useCallback((videoId: number, nextFavorite: boolean) => {
    void toggleFavorite(videoId, nextFavorite);
  }, [toggleFavorite]);
  const returnToNormalGrid = useCallback(() => setGridMode('normal'), []);
  const handlePageChange = useCallback((p: number, query?: string) => {
    const ids = selectedFolderIds.length > 0 ? selectedFolderIds : undefined;
    loadVideos(p, query, ids);
  }, [loadVideos, selectedFolderIds]);

  return (
    <div className="space-y-4">
      <div className="relative max-w-xl">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
        <input
          type="text"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder={searchMode === 'segments' ? '搜索字幕内容，例：闭包是什么' : '搜索视频或文件夹...'}
          className="w-full rounded-xl border border-[var(--border-light)] bg-[var(--bg-elevated)] py-2.5 pl-10 pr-4 text-sm"
        />
        {/* 搜索范围切换。默认「标题/文件夹」保持老行为；
            「字幕内容」走混合检索，能找到「哪段话里提到过」。 */}
        <div className="mt-2 flex items-center gap-1.5">
          {([
            ['title', '标题 / 文件夹'],
            ['segments', '字幕内容'],
          ] as const).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => setSearchMode(mode)}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                searchMode === mode
                  ? 'border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--accent)]'
                  : 'border-[var(--border-light)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
              }`}
            >
              {label}
            </button>
          ))}
          {searchMode === 'segments' && (
            <span className="ml-1 text-[11px] text-[var(--text-muted)]">
              按语义检索字幕片段，结果带课程 / 章节线索
            </span>
          )}
        </div>
      </div>

      {!isSearching && currentCategoryId && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 text-sm flex-wrap">
            {breadcrumb.map((b, i) => (
              <React.Fragment key={`${b.id ?? 'root'}-${i}`}>
                {i > 0 && <ChevronRight size={12} className="text-[var(--text-muted)]" />}
                <button
                  onClick={() => { setGridMode('normal'); goToBreadcrumb(b.id); }}
                  className={`transition-colors hover:text-[var(--accent)] ${i === breadcrumb.length - 1 ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}
                >
                  {b.name}
                </button>
              </React.Fragment>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={handleRefreshFolders} disabled={refreshLoading} className="rounded-lg p-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-accent)] hover:text-[var(--accent)] disabled:opacity-50" title="刷新当前目录和视频列表">
              {refreshLoading ? <RefreshCw size={14} className="animate-spin" /> : <Folder size={14} />}
            </button>
          </div>
        </div>
      )}

      {rescanMsg && (
        <div className={`rounded-lg px-3 py-2 text-sm ${rescanMsg.includes('失败') ? 'bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] text-[var(--danger)]' : 'bg-[color-mix(in_srgb,var(--success)_10%,transparent)] text-[var(--success)]'}`}>
          {rescanMsg}
        </div>
      )}

      {!isSearching && children.length > 0 && (
        <div className="auto-grid-video">
          {children.map((cat) => (
            <FolderTile
              key={cat.id}
              category={cat}
              checked={selectedFolderIdSet.has(cat.id)}
              onSelect={toggleFolderSelection}
              onEnter={enterFolderFromList}
            />
          ))}
        </div>
      )}

      {/* 字幕内容搜索结果。只在「字幕内容」模式下渲染 ——
          「标题 / 文件夹」模式看的是视频网格，不该出现片段列表。 */}
      {searchMode === 'segments' && inputVal.trim() && (
        <div>
          <p className="mb-2 text-xs text-[var(--text-muted)]">
            匹配的片段 ({searchResults.length})
            {searchResults.length > 0 && (
              <span className="ml-1 opacity-70">· 点击跳到对应时间点</span>
            )}
          </p>
          {searchResults.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--border-light)] bg-[var(--bg-elevated)] px-3 py-4 text-sm text-[var(--text-secondary)]">
              没有匹配的字幕片段。换个说法试试，比如用更具体的术语。
            </div>
          ) : (
            <div className="space-y-2">
              {searchResults.map((item) => {
                const pos = item.meta?.position && item.meta?.total
                  ? `第 ${item.meta.position}/${item.meta.total} 节`
                  : '';
                const path = item.meta?.display || item.folder_path || '';
                return (
                  <button
                    key={`${item.video_id}-${item.start_sec}`}
                    type="button"
                    onClick={() => openVideoAt(item.video_id, item.start_sec)}
                    className="flex w-full items-start gap-2.5 rounded-xl border border-[var(--border-light)] bg-[var(--bg-card)] px-3 py-2.5 text-left transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-bg)]"
                  >
                    <PlayCircle size={15} className="mt-0.5 shrink-0 text-[var(--accent)]" />
                    <div className="min-w-0 flex-1">
                      {path && (
                        <p
                          className="truncate text-[10px] text-[var(--text-muted)]"
                          title={item.meta?.meta_text || path}
                        >
                          {path}
                          {pos && <span className="ml-1 text-[var(--accent)]">{pos}</span>}
                        </p>
                      )}
                      <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                        {item.video_title}
                      </p>
                      <p className="text-xs text-[var(--accent)]">
                        {formatClock(item.start_sec)}
                        {item.end_sec > item.start_sec + 5 ? ` – ${formatClock(item.end_sec)}` : ''}
                      </p>
                      <p className="mt-0.5 text-xs leading-5 text-[var(--text-secondary)]" style={{
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}>
                        {item.text}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {isSearching && matchedFolders.length > 0 && (
        <div>
          <p className="text-xs text-[var(--text-muted)] mb-2">匹配的文件夹 ({matchedFolders.length})</p>
          <div className="space-y-3">
            {groupedMatchedFolders.map((group) => (
              <FolderSearchGroupCard
                key={group.key}
                group={group}
                onEnterParent={enterFolderFromSearch}
                onEnterFolder={enterFolderFromSearch}
              />
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
          onPlay={playVideo}
        />
      )}

      {error && (
        <div className="flex items-center gap-2 p-3 bg-[var(--danger-bg)] border border-[#fecaca] rounded-lg text-sm text-[var(--danger)]">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      <VideoGridSection
        loading={loading}
        videos={baseGridVideos}
        gridMode={gridMode}
        gridTitle={gridTitle}
        columnsPerRow={columnsPerRow}
        onColumnsPerRowChange={handleColumnsPerRowChange}
        filesLabel={filesLabel}
        isSearching={isSearching}
        currentCategoryId={currentCategoryId}
        total={total}
        page={page}
        totalPages={totalPages}
        searchQuery={searchQuery}
        onPlay={playVideo}
        onToggleFavorite={toggleVideoFavorite}
        onReturnToNormal={returnToNormalGrid}
        onPageChange={handlePageChange}
      />
    </div>
  );
}
