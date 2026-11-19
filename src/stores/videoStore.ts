import { create } from 'zustand';
import type { VideoItem, SegmentSearchResult, TranscriptSegment, CategoryTree } from '../lib/videoApi';
import { fetchVideos, fetchVideo, searchSegments, startAiJob, fetchCategoryTree, setVideoFavorite } from '../lib/videoApi';

const VIDEO_ID_KEY = 'p2m_current_video_id';
const NAV_STATE_KEY = 'p2m_video_nav_state';
const FAVORITE_CATEGORIES_KEY = 'p2m_favorite_category_ids';

function loadFavoriteCategoryIds(): number[] {
  try {
    const raw = localStorage.getItem(FAVORITE_CATEGORIES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((n) => typeof n === 'number');
  } catch { /* ignore */ }
  return [];
}

function saveFavoriteCategoryIds(ids: number[]) {
  try {
    localStorage.setItem(FAVORITE_CATEGORIES_KEY, JSON.stringify(ids));
  } catch { /* ignore */ }
}

function videoHashForCategory(categoryId: number | null): string {
  return categoryId ? `/video?category=${categoryId}` : '/video';
}

function parseVideoCategoryFromHash(): number | null | undefined {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = hash.split('?');
  if (path !== 'video') return undefined;
  const raw = new URLSearchParams(query).get('category');
  if (!raw) return null;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function pushVideoCategoryHash(categoryId: number | null) {
  const next = `#${videoHashForCategory(categoryId)}`;
  if (window.location.hash !== next) {
    window.location.hash = next;
  }
}

function replaceVideoCategoryHash(categoryId: number | null) {
  const next = `#${videoHashForCategory(categoryId)}`;
  if (window.location.hash !== next) {
    window.history.replaceState(null, '', next);
  }
}

function displayCategoryName(name: string): string {
  return name.includes(' / ') ? name.split(' / ').pop()! : name;
}

function findCategoryBreadcrumb(nodes: CategoryTree[], id: number, trail: { id: number | null; name: string }[] = [{ id: null, name: '全部视频' }]): { id: number | null; name: string }[] | null {
  for (const node of nodes) {
    const nextTrail = [...trail, { id: node.id, name: displayCategoryName(node.name) }];
    if (node.id === id) return nextTrail;
    const found = findCategoryBreadcrumb(node.children, id, nextTrail);
    if (found) return found;
  }
  return null;
}

interface SavedNavState {
  categoryId: number | null;
  breadcrumb: { id: number | null; name: string }[];
  searchQuery: string;
  page: number;
}

function saveNavState(state: { currentCategoryId: number | null; breadcrumb: { id: number | null; name: string }[]; searchQuery: string; page: number }) {
  try {
    localStorage.setItem(NAV_STATE_KEY, JSON.stringify({
      categoryId: state.currentCategoryId,
      breadcrumb: state.breadcrumb,
      searchQuery: state.searchQuery,
      page: state.page,
    }));
  } catch { /* quota exceeded, ignore */ }
}

function loadNavState(): SavedNavState | null {
  try {
    const raw = localStorage.getItem(NAV_STATE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SavedNavState;
  } catch { return null; }
}

function categoryExistsInTree(nodes: CategoryTree[], id: number): boolean {
  for (const node of nodes) {
    if (node.id === id) return true;
    if (categoryExistsInTree(node.children, id)) return true;
  }
  return false;
}

let currentVideoRequestSeq = 0;
let videoListRequestSeq = 0;

function applyCurrentVideo(set: (partial: Partial<VideoState>) => void, video: VideoItem) {
  set({
    currentVideo: video,
    currentSegments: video.transcript_segments || [],
    activeJobId: video.active_job_id || null,
    jobStatus: video.ai_status || 'idle',
    jobStage: video.ai_stage || null,
  });
}

interface VideoState {
  videos: VideoItem[];
  total: number;
  page: number;
  totalPages: number;
  loading: boolean;
  error: string | null;

  currentVideo: VideoItem | null;
  currentSegments: TranscriptSegment[];
  searchResults: SegmentSearchResult[];
  searchQuery: string;

  activeJobId: string | null;
  jobStatus: string | null;
  jobStage: string | null;

  // Category browsing
  categoryTree: CategoryTree[];
  currentCategoryId: number | null;
  breadcrumb: { id: number | null; name: string }[];
  selectedFolderIds: number[];
  favoriteCategoryIds: number[];
  favoriteVideos: VideoItem[];
  favLoading: boolean;

  // Actions
  loadVideos: (page?: number, search?: string, categoryIds?: number[]) => Promise<void>;
  selectVideo: (video: VideoItem) => void;
  loadCurrentVideo: (videoId: number) => Promise<void>;
  clearSelection: () => void;
  restoreCurrentVideo: () => Promise<void>;
  setSearchQuery: (q: string) => void;
  doSearch: (q: string) => Promise<void>;
    triggerAi: (videoId: number, opts?: {
      whisper_engine?: string;
      whisper_model?: string;
      language?: string;
      do_summary?: boolean;
      word_limit?: number;
      ollama_model?: string;
      cpu_threads?: number;
      compute_type?: string;
      beam_size?: number;
      best_of?: number;
      temperature?: number;
      vad_filter?: boolean;
      subtitle_correction_enabled?: boolean;
      subtitle_correction_scope?: 'full' | 'off';
      subtitle_correction_prompt?: string;
    }) => Promise<void>;
  refreshCurrent: () => Promise<void>;
  loadCategoryTree: () => Promise<void>;
  enterCategory: (id: number | null, name: string) => void;
  goToBreadcrumb: (id: number | null) => void;
  getCurrentChildren: () => CategoryTree[];
  restoreNavigation: () => void;
  setSelectedFolderIds: (ids: number[]) => void;
  toggleFavorite: (videoId: number, nextFavorite: boolean) => Promise<void>;
  toggleFavoriteCategory: (categoryId: number) => void;
  loadFavoriteVideos: () => Promise<void>;
  updateCurrentSegmentText: (segmentIndex: number, text: string) => void;
}

export const useVideoStore = create<VideoState>()((set, get) => ({
  videos: [],
  total: 0,
  page: 1,
  totalPages: 0,
  loading: false,
  error: null,

  currentVideo: null,
  currentSegments: [],
  searchResults: [],
  searchQuery: '',

  activeJobId: null,
  jobStatus: null,
  jobStage: null,

  categoryTree: [],
  currentCategoryId: null,
  breadcrumb: [{ id: null, name: '全部视频' }],
  selectedFolderIds: [],
  favoriteCategoryIds: loadFavoriteCategoryIds(),
  favoriteVideos: [],
  favLoading: false,

  loadVideos: async (page = 1, search, categoryIds?: number[]) => {
    const requestSeq = ++videoListRequestSeq;
    set({ loading: true, error: null });
    try {
      const categoryId = get().currentCategoryId ?? undefined;
      const data = await fetchVideos(page, 20, categoryId, search, categoryIds);
      if (requestSeq !== videoListRequestSeq) return;
      set({
        videos: data.items,
        total: data.total,
        page: data.page,
        totalPages: data.total_pages,
        loading: false,
      });
      const { currentCategoryId, breadcrumb, searchQuery } = get();
      saveNavState({ currentCategoryId, breadcrumb, searchQuery, page: data.page });
    } catch (e: unknown) {
      if (requestSeq !== videoListRequestSeq) return;
      set({ error: e instanceof Error ? e.message : String(e), loading: false });
    }
  },

  selectVideo: (video) => {
    currentVideoRequestSeq += 1;
    localStorage.setItem(VIDEO_ID_KEY, String(video.id));
    applyCurrentVideo(set, video);
  },

  loadCurrentVideo: async (videoId) => {
    const requestSeq = ++currentVideoRequestSeq;
    localStorage.setItem(VIDEO_ID_KEY, String(videoId));
    try {
      const fresh = await fetchVideo(videoId);
      if (requestSeq !== currentVideoRequestSeq) return;
      if (localStorage.getItem(VIDEO_ID_KEY) !== String(videoId)) return;
      applyCurrentVideo(set, fresh);
    } catch {
      // ignore
    }
  },

  clearSelection: () => {
    currentVideoRequestSeq += 1;
    localStorage.removeItem(VIDEO_ID_KEY);
    set({
      currentVideo: null,
      currentSegments: [],
      searchResults: [],
      activeJobId: null,
      jobStatus: null,
      jobStage: null,
    });
  },

  restoreCurrentVideo: async () => {
    const savedId = localStorage.getItem(VIDEO_ID_KEY);
    if (!savedId) return;
    const id = Number(savedId);
    if (!id) return;
    if (get().currentVideo) return;
    const requestSeq = currentVideoRequestSeq;
    try {
      const fresh = await fetchVideo(id);
      if (requestSeq !== currentVideoRequestSeq) return;
      if (localStorage.getItem(VIDEO_ID_KEY) !== String(id)) return;
      if (get().currentVideo && get().currentVideo?.id !== id) return;
      applyCurrentVideo(set, fresh);
    } catch {
      if (requestSeq === currentVideoRequestSeq && localStorage.getItem(VIDEO_ID_KEY) === String(id)) {
        localStorage.removeItem(VIDEO_ID_KEY);
      }
    }
  },

  setSearchQuery: (q) => {
    set({ searchQuery: q });
    const { currentCategoryId, breadcrumb, page } = get();
    saveNavState({ currentCategoryId, breadcrumb, searchQuery: q, page });
  },

  doSearch: async (q) => {
    if (!q.trim()) { set({ searchResults: [] }); return; }
    try {
      const results = await searchSegments(q);
      set({ searchResults: results });
    } catch {
      set({ searchResults: [] });
    }
  },

    triggerAi: async (videoId, opts) => {
      try {
        const res = await startAiJob(videoId, {
          whisper_engine: opts?.whisper_engine,
          whisper_model: opts?.whisper_model,
          language: opts?.language,
          do_summary: opts?.do_summary ?? true,
          word_limit: opts?.word_limit,
          ollama_model: opts?.ollama_model,
          cpu_threads: opts?.cpu_threads,
          compute_type: opts?.compute_type,
          beam_size: opts?.beam_size,
          best_of: opts?.best_of,
          temperature: opts?.temperature,
          vad_filter: opts?.vad_filter,
          subtitle_correction_enabled: opts?.subtitle_correction_enabled,
          subtitle_correction_scope: opts?.subtitle_correction_scope,
          subtitle_correction_prompt: opts?.subtitle_correction_prompt,
        });
        // Update local state; polling is handled by useAiJobCenter
        if (get().currentVideo?.id === videoId) {
          set({ activeJobId: res.job_id, jobStatus: res.status, jobStage: res.stage });
        }
      } catch (e: unknown) {
        set({ error: e instanceof Error ? e.message : String(e) });
      }
    },

  refreshCurrent: async () => {
    const { currentVideo } = get();
    if (!currentVideo) return;
    try {
      const fresh = await fetchVideo(currentVideo.id);
      set({
        currentVideo: fresh,
        currentSegments: fresh.transcript_segments || [],
        activeJobId: fresh.active_job_id || null,
        jobStatus: fresh.ai_status || 'idle',
        jobStage: fresh.ai_stage || null,
      });
      // also refresh list
      const { page, searchQuery, currentCategoryId } = get();
      const data = await fetchVideos(page, 20, currentCategoryId ?? undefined, searchQuery || undefined);
      set({ videos: data.items, total: data.total });
    } catch {
      // ignore
    }
  },

  loadCategoryTree: async () => {
    try {
      const tree = await fetchCategoryTree();
      set({ categoryTree: tree });

      const currentId = get().currentCategoryId;
      if (currentId !== null && !categoryExistsInTree(tree, currentId)) {
        set({
          currentCategoryId: null,
          breadcrumb: [{ id: null, name: '全部视频' }],
          videos: [],
          page: 1,
          selectedFolderIds: [],
        });
        pushVideoCategoryHash(null);
        saveNavState({ currentCategoryId: null, breadcrumb: [{ id: null, name: '全部视频' }], searchQuery: get().searchQuery, page: 1 });
        get().loadVideos(1);
        return;
      }

      const urlCategoryId = parseVideoCategoryFromHash();
      if (urlCategoryId) {
        const breadcrumb = findCategoryBreadcrumb(tree, urlCategoryId);
        if (breadcrumb) {
          set({ breadcrumb });
          const { searchQuery, page } = get();
          saveNavState({ currentCategoryId: urlCategoryId, breadcrumb, searchQuery, page });
        }
      }
    } catch {
      // ignore
    }
  },

  enterCategory: (id, name) => {
    const { breadcrumb } = get();
    // 如果目标 id 已经是当前所在文件夹，不重复追加
    if (breadcrumb.length > 0 && breadcrumb[breadcrumb.length - 1].id === id) {
      return;
    }
    const nextBreadcrumb = [...breadcrumb, { id, name }];
    pushVideoCategoryHash(id);
    set({
      currentCategoryId: id,
      breadcrumb: nextBreadcrumb,
      videos: [],
      page: 1,
      searchQuery: '',
    });
    saveNavState({ currentCategoryId: id, breadcrumb: nextBreadcrumb, searchQuery: '', page: 1 });
    get().loadVideos(1);
  },

  goToBreadcrumb: (id) => {
    const { breadcrumb } = get();
    const idx = breadcrumb.findIndex((b) => b.id === id);
    if (idx < 0) return;
    const nextBreadcrumb = breadcrumb.slice(0, idx + 1);
    pushVideoCategoryHash(id);
    set({
      currentCategoryId: id,
      breadcrumb: nextBreadcrumb,
      videos: [],
      page: 1,
      searchQuery: '',
    });
    saveNavState({ currentCategoryId: id, breadcrumb: nextBreadcrumb, searchQuery: '', page: 1 });
    get().loadVideos(1);
  },

  restoreNavigation: () => {
    const urlCategoryId = parseVideoCategoryFromHash();
    const saved = loadNavState();
    if (urlCategoryId !== undefined) {
      const savedMatchesUrl = saved?.categoryId === urlCategoryId;
      const treeBreadcrumb = urlCategoryId ? findCategoryBreadcrumb(get().categoryTree, urlCategoryId) : [{ id: null, name: '全部视频' }];
      const breadcrumb = treeBreadcrumb || (savedMatchesUrl && saved.breadcrumb.length > 0
        ? saved.breadcrumb
        : [{ id: null, name: '全部视频' }, ...(urlCategoryId ? [{ id: urlCategoryId, name: `文件夹 ${urlCategoryId}` }] : [])]);
      set({
        currentCategoryId: urlCategoryId,
        breadcrumb,
        searchQuery: savedMatchesUrl ? saved.searchQuery : '',
        page: savedMatchesUrl ? saved.page : 1,
      });
      saveNavState({ currentCategoryId: urlCategoryId, breadcrumb, searchQuery: savedMatchesUrl ? saved.searchQuery : '', page: savedMatchesUrl ? saved.page : 1 });
      get().loadVideos(savedMatchesUrl ? saved.page : 1, savedMatchesUrl ? saved.searchQuery || undefined : undefined);
      return;
    }
    if (!saved) {
      set({
        currentCategoryId: null,
        breadcrumb: [{ id: null, name: '全部视频' }],
        searchQuery: '',
        page: 1,
      });
      replaceVideoCategoryHash(null);
      get().loadVideos(1);
      return;
    }
    replaceVideoCategoryHash(saved.categoryId);
    set({
      currentCategoryId: saved.categoryId,
      breadcrumb: saved.breadcrumb.length > 0 ? saved.breadcrumb : [{ id: null, name: '全部视频' }],
      searchQuery: saved.searchQuery,
      page: saved.page,
    });
    get().loadVideos(saved.page, saved.searchQuery || undefined);
  },

  getCurrentChildren: () => {
    const { categoryTree, currentCategoryId } = get();
    if (!currentCategoryId) return categoryTree;
    const findNode = (nodes: CategoryTree[]): CategoryTree | null => {
      for (const n of nodes) {
        if (n.id === currentCategoryId) return n;
        const found = findNode(n.children);
        if (found) return found;
      }
      return null;
    };
    return findNode(categoryTree)?.children ?? [];
  },

  setSelectedFolderIds: (ids) => {
    set({ selectedFolderIds: ids });
  },

  toggleFavorite: async (videoId, nextFavorite) => {
    const previous = get();
    const applyFavorite = (video: VideoItem): VideoItem => ({
      ...video,
      is_favorite: nextFavorite,
      favorited_at: nextFavorite ? new Date().toISOString() : null,
    });
    set({
      videos: previous.videos.map((video) => video.id === videoId ? applyFavorite(video) : video),
      currentVideo: previous.currentVideo?.id === videoId ? applyFavorite(previous.currentVideo) : previous.currentVideo,
    });

    try {
      const fresh = await setVideoFavorite(videoId, nextFavorite);
      set((state) => ({
        videos: state.videos.map((video) => video.id === videoId ? { ...video, ...fresh } : video),
        currentVideo: state.currentVideo?.id === videoId ? { ...state.currentVideo, ...fresh } : state.currentVideo,
      }));
    } catch (e: unknown) {
      set({
        videos: previous.videos,
        currentVideo: previous.currentVideo,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  toggleFavoriteCategory: (categoryId) => {
    const ids = get().favoriteCategoryIds;
    const next = ids.includes(categoryId)
      ? ids.filter((id) => id !== categoryId)
      : [...ids, categoryId];
    saveFavoriteCategoryIds(next);
    set({ favoriteCategoryIds: next });
  },

  loadFavoriteVideos: async () => {
    set({ favLoading: true, error: null });
    try {
      const data = await fetchVideos(1, 100, undefined, undefined, undefined, true);
      set({
        favoriteVideos: data.items,
        favLoading: false,
      });
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : String(e), favLoading: false });
    }
  },

  updateCurrentSegmentText: (segmentIndex, text) => {
    const { currentSegments, currentVideo } = get();
    if (!currentVideo || segmentIndex < 0 || segmentIndex >= currentSegments.length) return;
    const nextSegments = currentSegments.map((seg, idx) =>
      idx === segmentIndex ? { ...seg, text } : seg
    );
    set({
      currentSegments: nextSegments,
      currentVideo: { ...currentVideo, transcript_segments: nextSegments },
    });
  },
}));
