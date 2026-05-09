const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:5200';

export function resolveApiUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_BASE}${url.startsWith('/') ? url : `/${url}`}`;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ── Types ──

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface VideoItem {
  id: number;
  title: string;
  filename: string;
  filepath: string;
  file_size: number;
  duration: number | null;
  thumbnail: string | null;
  tags: string | null;
  category_id: number | null;
  category_path: string | null;
  transcription: string | null;
  transcript_segments: TranscriptSegment[];
  summary: string | null;
  markdown_path: string | null;
  subtitle_path: string | null;
  subtitle_url: string | null;
  ai_status: string;
  ai_stage: string | null;
  ai_error: string | null;
  active_job_id: string | null;
  watch_progress: number | null;
  completed: boolean;
  created_at: string;
  updated_at: string;
}

export interface VideoPage {
  items: VideoItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface SubtitleSegmentOut {
  id: number;
  video_id: number;
  segment_index: number;
  start_sec: number;
  end_sec: number;
  text: string;
}

export interface SegmentSearchResult {
  video_id: number;
  video_title: string;
  category_id: number | null;
  start_sec: number;
  end_sec: number;
  text: string;
  subtitle_url: string | null;
  score_hint: number;
}

export interface AiJobOut {
  id: string;
  video_id: number;
  status: string;
  stage: string;
  message: string;
  error: string | null;
  whisper_model: string;
  language: string;
  do_summary: boolean;
  word_limit: number;
  ollama_model: string | null;
  transcript: string | null;
  transcript_segments: TranscriptSegment[];
  summary: string | null;
  summary_error: string | null;
  markdown_path: string | null;
  subtitle_path: string | null;
  subtitle_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlaylistItem {
  id: number;
  title: string;
  thumbnail: string | null;
  category_path: string | null;
  watch_progress: number | null;
  completed: boolean;
  subtitle_url: string | null;
}

export interface Playlist {
  videos: PlaylistItem[];
  current_index: number;
  total: number;
}

// ── API functions ──

export function getVideoStreamUrl(videoId: number): string {
  return `${API_BASE}/api/videos/${videoId}/file`;
}

export function getSubtitleFileUrl(videoId: number): string {
  return `${API_BASE}/api/videos/${videoId}/subtitle`;
}

export function getThumbnailUrl(videoId: number): string {
  return `${API_BASE}/api/videos/${videoId}/thumbnail`;
}

export function getSpriteUrl(videoId: number): string {
  return `${API_BASE}/api/videos/${videoId}/sprite`;
}

export interface SpriteMeta {
  video_id: number;
  cols: number;
  rows: number;
  frame_width: number;
  frame_height: number;
  frame_interval: number;
  total_frames: number;
  duration: number;
}

export async function fetchVideos(page = 1, pageSize = 20, categoryId?: number, search?: string): Promise<VideoPage> {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (categoryId) params.set('category_id', String(categoryId));
  if (search) params.set('search', search);
  return apiFetch<VideoPage>(`/api/videos?${params}`);
}

export async function fetchVideo(videoId: number): Promise<VideoItem> {
  return apiFetch<VideoItem>(`/api/videos/${videoId}`);
}

export async function fetchContinueVideo(): Promise<VideoItem | null> {
  try {
    return await apiFetch<VideoItem>('/api/videos/continue/last');
  } catch {
    return null;
  }
}

export async function fetchRecentHistory(limit = 8): Promise<VideoItem[]> {
  return apiFetch<VideoItem[]>(`/api/videos/history/recent?limit=${limit}`);
}

export async function fetchRecentVideos(limit = 8, categoryId?: number | null): Promise<{ items: VideoItem[]; fallback: boolean }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (categoryId) params.set('category_id', String(categoryId));
  try {
    return { items: await apiFetch<VideoItem[]>(`/api/videos/recent?${params}`), fallback: false };
  } catch {
    const fallback = await fetchVideos(1, limit, categoryId ?? undefined);
    return { items: fallback.items, fallback: true };
  }
}

export async function fetchPlaylist(videoId: number): Promise<Playlist> {
  return apiFetch<Playlist>(`/api/videos/${videoId}/playlist`);
}

export async function fetchSegments(videoId: number): Promise<SubtitleSegmentOut[]> {
  return apiFetch<SubtitleSegmentOut[]>(`/api/videos/${videoId}/segments`);
}

export async function searchSegments(q: string, limit = 20): Promise<SegmentSearchResult[]> {
  const params = new URLSearchParams({ q, limit: String(limit) });
  return apiFetch<SegmentSearchResult[]>(`/api/videos/search/segments?${params}`);
}

export async function saveWatchHistory(videoId: number, progress: number, duration: number): Promise<void> {
  await apiFetch('/api/videos/history', {
    method: 'POST',
    body: JSON.stringify({ video_id: videoId, progress, duration }),
  });
}

export async function startAiJob(
  videoId: number,
  opts?: {
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
  }
): Promise<{ job_id: string; status: string; stage: string }> {
  return apiFetch(`/api/videos/${videoId}/ai-jobs`, {
    method: 'POST',
    body: JSON.stringify({
      whisper_model: opts?.whisper_model ?? '',
      language: opts?.language ?? 'zh',
      do_summary: opts?.do_summary ?? true,
      word_limit: opts?.word_limit ?? 200,
      ollama_model: opts?.ollama_model ?? null,
      cpu_threads: opts?.cpu_threads,
      compute_type: opts?.compute_type,
      beam_size: opts?.beam_size,
      best_of: opts?.best_of,
      temperature: opts?.temperature,
      vad_filter: opts?.vad_filter,
      subtitle_correction_enabled: opts?.subtitle_correction_enabled,
    }),
  });
}

export async function fetchAiJob(jobId: string): Promise<AiJobOut> {
  return apiFetch<AiJobOut>(`/api/ai-jobs/${jobId}`);
}

// ── Category Tree ──

export interface CategoryTree {
  id: number;
  name: string;
  path: string;
  sort_order: number;
  parent_id: number | null;
  video_count: number;
  full_path: string;
  level: number;
  children: CategoryTree[];
}

export async function fetchCategoryTree(): Promise<CategoryTree[]> {
  return apiFetch<CategoryTree[]>('/api/categories/tree');
}

export async function clearActiveAiJobs(): Promise<{ cleared: number }> {
  return apiFetch<{ cleared: number }>('/api/admin/ai-jobs/clear-active', { method: 'POST' });
}
