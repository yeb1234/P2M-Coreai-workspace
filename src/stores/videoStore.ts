import { create } from 'zustand';
import type { VideoItem, SegmentSearchResult, TranscriptSegment, CategoryTree } from '../lib/videoApi';
import { fetchVideos, fetchVideo, searchSegments, startAiJob, fetchAiJob, fetchCategoryTree } from '../lib/videoApi';

const VIDEO_ID_KEY = 'p2m_current_video_id';

let currentVideoRequestSeq = 0;

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

  // Actions
  loadVideos: (page?: number, search?: string) => Promise<void>;
  selectVideo: (video: VideoItem) => void;
  loadCurrentVideo: (videoId: number) => Promise<void>;
  clearSelection: () => void;
  restoreCurrentVideo: () => Promise<void>;
  setSearchQuery: (q: string) => void;
  doSearch: (q: string) => Promise<void>;
    triggerAi: (videoId: number, opts?: {
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
    }) => Promise<void>;
  pollJob: (jobId: string) => Promise<void>;
  refreshCurrent: () => Promise<void>;
  loadCategoryTree: () => Promise<void>;
  enterCategory: (id: number | null, name: string) => void;
  goToBreadcrumb: (id: number | null) => void;
  getCurrentChildren: () => CategoryTree[];
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

  loadVideos: async (page = 1, search) => {
    set({ loading: true, error: null });
    try {
      const categoryId = get().currentCategoryId ?? undefined;
      const data = await fetchVideos(page, 20, categoryId, search);
      set({
        videos: data.items,
        total: data.total,
        page: data.page,
        totalPages: data.total_pages,
        loading: false,
      });
    } catch (e: unknown) {
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

  setSearchQuery: (q) => set({ searchQuery: q }),

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
        });
        set({ activeJobId: res.job_id, jobStatus: res.status, jobStage: res.stage });
        get().pollJob(res.job_id);
      } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  pollJob: async (jobId) => {
    const poll = async () => {
      try {
        const job = await fetchAiJob(jobId);
        const currentAtPoll = get().currentVideo;
        const jobBelongsToCurrentVideo = currentAtPoll?.id === job.video_id;
        if (jobBelongsToCurrentVideo) {
          set({ jobStatus: job.status, jobStage: job.stage });
        }
        if (job.status === 'completed' || job.status === 'failed') {
          try {
            const fresh = await fetchVideo(job.video_id);
            if (get().currentVideo?.id === job.video_id) {
                set({
                  currentVideo: fresh,
                  currentSegments: fresh.transcript_segments || [],
                  activeJobId: fresh.active_job_id || null,
                  jobStatus: fresh.ai_status || 'idle',
                  jobStage: fresh.ai_stage || null,
                });
            }
          } catch {
            const currentVideo = get().currentVideo;
            if (job.status === 'completed' && currentVideo?.id === job.video_id) {
                const updated = {
                  ...currentVideo,
                  summary: job.summary ?? currentVideo.summary,
                  transcription: job.transcript ?? currentVideo.transcription,
                  transcript_segments: job.transcript_segments?.length ? job.transcript_segments : currentVideo.transcript_segments,
                  subtitle_path: job.subtitle_path ?? currentVideo.subtitle_path,
                  subtitle_url: job.subtitle_url ?? currentVideo.subtitle_url,
                  markdown_path: job.markdown_path ?? currentVideo.markdown_path,
                  ai_status: 'completed',
                  ai_stage: 'completed',
                  ai_error: null,
                };
                set({
                  currentVideo: updated,
                  currentSegments: updated.transcript_segments || [],
                  jobStatus: 'completed',
                  jobStage: 'completed',
                });
            }
          }
          try {
            const { page, searchQuery, currentCategoryId } = get();
            const data = await fetchVideos(page, 20, currentCategoryId ?? undefined, searchQuery || undefined);
            set({ videos: data.items, total: data.total });
          } catch {
            // list refresh is best-effort
          }
          return;
        }
        setTimeout(poll, 2000);
      } catch {
        // ignore poll errors
      }
    };
    poll();
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
    } catch {
      // ignore
    }
  },

  enterCategory: (id, name) => {
    const { breadcrumb } = get();
    set({
      currentCategoryId: id,
      breadcrumb: [...breadcrumb, { id, name }],
      videos: [],
      page: 1,
    });
    get().loadVideos(1);
  },

  goToBreadcrumb: (id) => {
    const { breadcrumb } = get();
    const idx = breadcrumb.findIndex((b) => b.id === id);
    if (idx < 0) return;
    set({
      currentCategoryId: id,
      breadcrumb: breadcrumb.slice(0, idx + 1),
      videos: [],
      page: 1,
    });
    get().loadVideos(1);
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
}));
