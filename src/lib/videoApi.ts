import { API_BASE, resolveApiPath } from './apiBase';

export function resolveApiUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_BASE}${url.startsWith('/') ? url : `/${url}`}`;
}

type ApiFetchInit = RequestInit & { timeoutMs?: number };

async function apiFetch<T>(path: string, init?: ApiFetchInit): Promise<T> {
  const { timeoutMs = 60000, signal, ...fetchInit } = init ?? {};
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  let res: Response;
  try {
    res = await fetch(resolveApiPath(path), {
      headers: { 'Content-Type': 'application/json', ...fetchInit.headers },
      ...fetchInit,
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) throw new Error(`API timeout: ${path}`, { cause: err });
    throw err;
  } finally {
    window.clearTimeout(timeout);
  }
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
  is_favorite: boolean;
  favorited_at: string | null;
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

export interface AssistantReference {
  video_id: number;
  video_title: string;
  start_sec: number;
  end_sec: number;
  text: string;
  score_hint: number;
}

export interface AssistantChatOut {
  session_id: string;
  answer: string;
  mode: string;
  depth: string;
  rag_enabled: boolean;
  web_search_enabled: boolean;
  deep_research_enabled: boolean;
  references: AssistantReference[];
}

export interface AssistantConnectionTestOut {
  status: string;
  content_type: string;
  answer: string;
  received_text: boolean;
}

export interface AiJobOut {
  id: string;
  video_id: number;
  status: string;
  stage: string;
  message: string;
  error: string | null;
  whisper_engine: string | null;
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

export interface AiJobListItem {
  id: string;
  video_id: number;
  video_title: string | null;
  duration: number | null;
  status: string;
  stage: string;
  message: string;
  error: string | null;
  whisper_engine: string | null;
  whisper_model: string;
  language: string;
  do_summary: boolean;
  word_limit: number;
  cpu_threads: number | null;
  compute_type: string | null;
  device_type: string | null;
  subtitle_correction_enabled: boolean | null;
  subtitle_correction_scope: 'full' | 'off' | null;
  subtitle_correction_prompt: string | null;
  summary_error: string | null;
  created_at: string;
  started_at: string | null;
  updated_at: string;
}

export interface AiJobListOut {
  items: AiJobListItem[];
  total: number;
  running: number;
  queued: number;
  failed: number;
  completed: number;
}

export type AiJobBatchMode = 'unfinished' | 'missing_subtitles' | 'missing_summary' | 'failed_only' | 'all';

export interface AiJobBatchOut {
  mode: AiJobBatchMode;
  requested: number;
  eligible: number;
  enqueued: number;
  skipped: number;
  active: number;
  already_done: number;
  failed: number;
  limited: boolean;
  max_enqueue: number;
  job_ids: string[];
  skipped_items: Array<{ video_id: number; title: string; reason: string }>;
}

export interface AiQueueState {
  paused: boolean;
  running: number;
  queued: number;
  failed: number;
  completed: number;
}

export interface BackendHealthCheck {
  name: string;
  ok: boolean;
  message: string;
  details: Record<string, unknown>;
}

export interface BackendHealthOut {
  ok: boolean;
  checks: BackendHealthCheck[];
}

export interface WhisperModelStatus {
  id: string;
  filename: string;
  installed: boolean;
  path: string;
  size: number | null;
  auto_downloadable: boolean;
}

export interface WhisperModelsOut {
  model_dir: string;
  items: WhisperModelStatus[];
}

export interface TranscriptionSettingsDto {
  whisper_engine: string;
  whisper_model: string;
  language: string;
  do_summary: boolean;
  word_limit: number;
  cpu_threads: number;
  compute_type: string;
  beam_size: number;
  best_of: number;
  temperature: number;
  vad_filter: boolean;
  subtitle_correction_enabled: boolean;
  subtitle_correction_scope: 'full' | 'off';
  subtitle_correction_prompt: string;
  llm_usage_policy: 'local_first' | 'external_first' | 'local_only' | 'external_only';
  device_type: 'auto' | 'cuda' | 'cpu';
}

export type LlmUsagePolicy = 'local_first' | 'external_first' | 'local_only' | 'external_only';

export interface AssistantRuntimeSettingsDto {
  local_base_url: string;
  local_api_key: string;
  local_model: string;
  external_base_url: string;
  external_api_key: string;
  external_model: string;
  llm_usage_policy: LlmUsagePolicy;
}

export interface PlaylistItem {
  id: number;
  title: string;
  thumbnail: string | null;
  category_path: string | null;
  watch_progress: number | null;
  completed: boolean;
  is_favorite: boolean;
  favorited_at: string | null;
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

export async function fetchVideos(page = 1, pageSize = 20, categoryId?: number, search?: string, categoryIds?: number[]): Promise<VideoPage> {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (categoryIds && categoryIds.length > 0) {
    params.set('category_ids', categoryIds.join(','));
  } else if (categoryId) {
    params.set('category_id', String(categoryId));
  }
  if (search) params.set('search', search);
  return apiFetch<VideoPage>(`/api/videos?${params}`, { timeoutMs: 300000 });
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

export async function rescanVideos(): Promise<{ added: number; removed: number; total: number }> {
  return apiFetch<{ added: number; removed: number; total: number }>('/api/admin/rescan', { method: 'POST' });
}

export async function generateThumbnails(videoIds: number[]): Promise<{ generated: number; total: number }> {
  return apiFetch<{ generated: number; total: number }>('/api/admin/generate-thumbnails', {
    method: 'POST',
    body: JSON.stringify({ video_ids: videoIds }),
  });
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

export async function fetchPlaylist(videoId: number, scope: 'leaf' | 'descendants' = 'leaf', categoryId?: number | null): Promise<Playlist> {
  const params = new URLSearchParams({ scope });
  if (categoryId) params.set('category_id', String(categoryId));
  return apiFetch<Playlist>(`/api/videos/${videoId}/playlist?${params}`);
}

export async function fetchSegments(videoId: number): Promise<SubtitleSegmentOut[]> {
  return apiFetch<SubtitleSegmentOut[]>(`/api/videos/${videoId}/segments`);
}

export async function searchSegments(q: string, limit = 20): Promise<SegmentSearchResult[]> {
  const params = new URLSearchParams({ q, limit: String(limit) });
  return apiFetch<SegmentSearchResult[]>(`/api/videos/search/segments?${params}`);
}

export async function sendAssistantChat(
  message: string,
  limit = 5,
  pageContext = '',
  systemPrompt = ''
): Promise<AssistantChatOut> {
  return apiFetch<AssistantChatOut>('/api/assistant/chat', {
    method: 'POST',
    body: JSON.stringify({ message, limit, page_context: pageContext, system_prompt: systemPrompt }),
  });
}

export type ChatStreamEvent =
  | { type: 'token'; text: string }
  | { type: 'tool_start'; tool: string }
  | { type: 'tool_end'; tool: string; ok: boolean | null }
  | {
      type: 'done';
      run_id: string;
      session_id?: string;
      latency_ms: number;
      steps: unknown[];
      references?: Array<{
        video_id: number;
        video_title: string;
        start_sec: number;
        text: string;
        score?: number;
      }>;
    }
  | { type: 'error'; message: string };

/**
 * 流式对话（SSE over POST）。
 * EventSource 不支持 POST，因此用 fetch + ReadableStream 手动解析。
 * 每块格式：`data: {json}\n\n`
 */
export async function streamAssistantChat(
  message: string,
  options: {
    sessionId?: string;
    pageContext?: string;
    systemPrompt?: string;
    videoId?: number;
    onEvent: (event: ChatStreamEvent) => void;
    signal?: AbortSignal;
  }
): Promise<void> {
  const response = await fetch(resolveApiPath('/api/assistant/chat/stream'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      page_context: options.pageContext ?? '',
      system_prompt: options.systemPrompt ?? '',
      session_id: options.sessionId || undefined,
      video_id: options.videoId ?? undefined,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`对话请求失败 HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
  if (!response.body) throw new Error('当前浏览器不支持流式响应');

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // 服务端以空行分隔事件块
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');

      for (const line of raw.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try {
          options.onEvent(JSON.parse(payload) as ChatStreamEvent);
        } catch {
          // 忽略无法解析的心跳或截断块
        }
      }
    }
  }
}

export async function fetchAssistantModels(baseUrl: string, apiKey = ''): Promise<string[]> {
  const data = await apiFetch<{ models: string[] }>('/api/assistant/models', {
    method: 'POST',
    body: JSON.stringify({ base_url: baseUrl, api_key: apiKey }),
  });
  return data.models;
}

export async function testAssistantConnection(options: {
  baseUrl: string;
  model: string;
  apiKey?: string;
  message: string;
  systemPrompt?: string;
  temperature?: number;
}): Promise<AssistantConnectionTestOut> {
  return apiFetch<AssistantConnectionTestOut>('/api/assistant/connection-test', {
    method: 'POST',
    body: JSON.stringify({
      base_url: options.baseUrl,
      model: options.model,
      api_key: options.apiKey ?? '',
      message: options.message,
      system_prompt: options.systemPrompt ?? '',
      temperature: options.temperature ?? 0.2,
    }),
  });
}

export async function saveWatchHistory(videoId: number, progress: number, duration: number): Promise<void> {
  await apiFetch('/api/videos/history', {
    method: 'POST',
    body: JSON.stringify({ video_id: videoId, progress, duration }),
  });
}

export async function updateSubtitleSegment(videoId: number, segmentIndex: number, text: string): Promise<void> {
  await apiFetch(`/api/videos/${videoId}/segments/${segmentIndex}`, {
    method: 'PUT',
    body: JSON.stringify({ text }),
  });
}

export async function setVideoFavorite(videoId: number, isFavorite: boolean): Promise<VideoItem> {
  return apiFetch<VideoItem>(`/api/videos/${videoId}/favorite`, {
    method: 'POST',
    body: JSON.stringify({ is_favorite: isFavorite }),
  });
}

export async function startAiJob(
  videoId: number,
  opts?: {
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
    device_type?: string;
    subtitle_correction_enabled?: boolean;
    subtitle_correction_scope?: 'full' | 'off';
    subtitle_correction_prompt?: string;
  }
): Promise<{ job_id: string; status: string; stage: string }> {
  return apiFetch(`/api/videos/${videoId}/ai-jobs`, {
    method: 'POST',
    body: JSON.stringify({
      whisper_engine: opts?.whisper_engine,
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
      device_type: opts?.device_type,
      subtitle_correction_enabled: opts?.subtitle_correction_enabled,
      subtitle_correction_scope: opts?.subtitle_correction_scope,
      subtitle_correction_prompt: opts?.subtitle_correction_prompt,
    }),
  });
}

export async function fetchAiJob(jobId: string): Promise<AiJobOut> {
  return apiFetch<AiJobOut>(`/api/ai-jobs/${jobId}`);
}

export async function fetchAiJobs(limit = 20, status?: string): Promise<AiJobListOut> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (status) params.set('status', status);
  return apiFetch<AiJobListOut>(`/api/ai-jobs?${params}`);
}

export async function batchAiJobs(
  videoIds: number[],
  opts: Parameters<typeof startAiJob>[1] & {
    mode?: AiJobBatchMode;
    max_enqueue?: number;
    dry_run?: boolean;
  } = {}
): Promise<AiJobBatchOut> {
  const CHUNK_SIZE = 100;

  function buildBody(ids: number[], chunkMaxEnqueue: number): string {
    return JSON.stringify({
      video_ids: ids,
      mode: opts.mode ?? 'missing_subtitles',
      max_enqueue: chunkMaxEnqueue,
      dry_run: opts.dry_run ?? true,
      whisper_engine: opts.whisper_engine,
      whisper_model: opts.whisper_model ?? '',
      language: opts.language ?? 'zh',
      do_summary: opts.do_summary ?? true,
      word_limit: opts.word_limit ?? 200,
      ollama_model: opts.ollama_model ?? null,
      cpu_threads: opts.cpu_threads,
      compute_type: opts.compute_type,
      beam_size: opts.beam_size,
      best_of: opts.best_of,
      temperature: opts.temperature,
      vad_filter: opts.vad_filter,
      device_type: opts.device_type,
      subtitle_correction_enabled: opts.subtitle_correction_enabled,
      subtitle_correction_scope: opts.subtitle_correction_scope,
      subtitle_correction_prompt: opts.subtitle_correction_prompt,
    });
  }

  if (videoIds.length <= CHUNK_SIZE) {
    return apiFetch<AiJobBatchOut>('/api/ai-jobs/batch', {
      method: 'POST',
      timeoutMs: 300000,
      body: buildBody(videoIds, opts.max_enqueue ?? 20),
    });
  }

  const chunks: number[][] = [];
  for (let i = 0; i < videoIds.length; i += CHUNK_SIZE) {
    chunks.push(videoIds.slice(i, i + CHUNK_SIZE));
  }

  let merged: AiJobBatchOut | null = null;
  let remainingMaxEnqueue = opts.max_enqueue ?? 20;

  for (const chunk of chunks) {
    const chunkMax = Math.min(chunk.length, remainingMaxEnqueue);
    const result = await apiFetch<AiJobBatchOut>('/api/ai-jobs/batch', {
      method: 'POST',
      timeoutMs: 300000,
      body: buildBody(chunk, chunkMax),
    });

    if (!merged) {
      merged = result;
    } else {
      merged.requested += result.requested;
      merged.eligible += result.eligible;
      merged.enqueued += result.enqueued;
      merged.skipped += result.skipped;
      merged.active += result.active;
      merged.already_done += result.already_done;
      merged.failed += result.failed;
      merged.job_ids.push(...result.job_ids);
      merged.skipped_items.push(...result.skipped_items);
      merged.limited = merged.limited || result.limited;
    }

    remainingMaxEnqueue -= result.enqueued;
    if (remainingMaxEnqueue <= 0) break;
  }

  return merged!;
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

export interface CategoryTreeWithVideos extends CategoryTree {
  video_ids: number[];
}

export async function fetchCategoryTree(): Promise<CategoryTree[]> {
  return apiFetch<CategoryTree[]>('/api/categories/tree');
}

export async function fetchCategoryTreeWithVideos(): Promise<CategoryTreeWithVideos[]> {
  return apiFetch<CategoryTreeWithVideos[]>('/api/categories/tree/videos');
}

export async function clearActiveAiJobs(): Promise<{ cleared: number }> {
  return apiFetch<{ cleared: number }>('/api/admin/ai-jobs/clear-active', { method: 'POST' });
}

export async function clearQueuedAiJobs(): Promise<{ cleared: number }> {
  return apiFetch<{ cleared: number }>('/api/admin/ai-jobs/clear-queued', { method: 'POST' });
}

export async function clearFinishedAiJobs(): Promise<{ cleared: number }> {
  return apiFetch<{ cleared: number }>('/api/admin/ai-jobs/clear-history', { method: 'POST' });
}

export async function clearCompletedAiJobs(): Promise<{ cleared: number }> {
  return apiFetch<{ cleared: number }>('/api/admin/ai-jobs/clear-completed', { method: 'POST' });
}

export async function clearAllAiJobs(): Promise<{ cleared: number }> {
  return apiFetch<{ cleared: number }>('/api/admin/ai-jobs/clear-all', { method: 'POST' });
}

export async function recoverStuckAiJobs(minutes = 60, correctionMinutes = 15, force = false): Promise<{ recovered: number; cutoff_minutes: number; correction_cutoff_minutes?: number }> {
  return apiFetch<{ recovered: number; cutoff_minutes: number; correction_cutoff_minutes?: number }>(
    `/api/admin/ai-jobs/recover-stuck?minutes=${minutes}&correction_minutes=${correctionMinutes}&force=${force ? 'true' : 'false'}`,
    { method: 'POST' }
  );
}

export async function fetchAiQueueState(): Promise<AiQueueState> {
  return apiFetch<AiQueueState>('/api/admin/ai-jobs/queue');
}

export async function pauseAiQueue(): Promise<{ paused: boolean }> {
  return apiFetch<{ paused: boolean }>('/api/admin/ai-jobs/pause', { method: 'POST' });
}

export async function resumeAiQueue(): Promise<{ paused: boolean }> {
  return apiFetch<{ paused: boolean }>('/api/admin/ai-jobs/resume', { method: 'POST' });
}

export async function cancelAiJob(jobId: string): Promise<{ cancelled: boolean; reason?: string }> {
  return apiFetch<{ cancelled: boolean; reason?: string }>(`/api/admin/ai-jobs/${jobId}/cancel`, { method: 'POST' });
}

export async function resumeAiJob(jobId: string): Promise<{ resumed: boolean; reason?: string; job_id?: string }> {
  return apiFetch<{ resumed: boolean; reason?: string; job_id?: string }>(`/api/admin/ai-jobs/${jobId}/resume`, { method: 'POST' });
}

export async function syncQueuedAiJobSettings(): Promise<{ updated: number }> {
  return apiFetch<{ updated: number }>('/api/admin/ai-jobs/sync-queued-settings', { method: 'POST' });
}

export async function fetchBackendHealth(): Promise<BackendHealthOut> {
  return apiFetch<BackendHealthOut>('/api/admin/health');
}

export async function fetchWhisperModels(): Promise<WhisperModelsOut> {
  return apiFetch<WhisperModelsOut>('/api/admin/whisper-models');
}

export async function downloadWhisperModel(modelId: string): Promise<{ model_id: string; actual: string; status: string; downloaded?: boolean }> {
  return apiFetch<{ model_id: string; actual: string; status: string; downloaded?: boolean }>(`/api/admin/download-whisper-model/${encodeURIComponent(modelId)}`, {
    method: 'POST',
    timeoutMs: 30000,
  });
}

export async function fetchDownloadStatus(modelId: string): Promise<{ model_id: string; status: string; error?: string }> {
  return apiFetch<{ model_id: string; status: string; error?: string }>(`/api/admin/download-whisper-model/${encodeURIComponent(modelId)}`);
}

export async function fetchTranscriptionSettings(): Promise<TranscriptionSettingsDto> {
  return apiFetch<TranscriptionSettingsDto>('/api/admin/transcription-settings');
}

export async function saveTranscriptionSettings(settings: TranscriptionSettingsDto): Promise<TranscriptionSettingsDto> {
  return apiFetch<TranscriptionSettingsDto>('/api/admin/transcription-settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}

export async function fetchAssistantRuntimeSettings(): Promise<AssistantRuntimeSettingsDto> {
  return apiFetch<AssistantRuntimeSettingsDto>('/api/admin/assistant-settings');
}

export async function saveAssistantRuntimeSettings(settings: AssistantRuntimeSettingsDto): Promise<AssistantRuntimeSettingsDto> {
  return apiFetch<AssistantRuntimeSettingsDto>('/api/admin/assistant-settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}
