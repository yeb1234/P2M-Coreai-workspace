import { API_BASE, resolveApiPath } from './apiBase';
import { clearSession, getSessionUserId } from './authApi';

type ApiFetchInit = RequestInit & { timeoutMs?: number };

// 会话凭证在 httpOnly Cookie 里，JS 读不到；这里只负责带上 Cookie
const CREDENTIAL_MODE: RequestCredentials = API_BASE ? 'include' : 'same-origin';

/** 后端的密钥掩码占位：GET 返回它，PUT 原样回传表示「这一项没改」。 */
export const MASKED_SECRET = '__MASKED__';

/** 结构化接口错误：把 status / code / request_id 一起带出来，方便页面分类展示。 */
export class ApiError extends Error {
  status: number;
  code?: string;
  requestId?: string;

  constructor(message: string, options: { status: number; code?: string; requestId?: string }) {
    super(message);
    this.name = 'ApiError';
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId;
  }
}

/**
 * 把后端的结构化错误解析成人话，而不是把 JSON 原样丢给用户。
 * 保留 request_id：排查时要它，但不占主位（页面放小字里）。
 */
function extractErrorMessage(status: number, raw: string): { message: string; code?: string; requestId?: string } {
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const detail = parsed?.error?.message ?? parsed?.detail;
      const code = typeof parsed?.error?.code === 'string' ? parsed.error.code : undefined;
      const requestId = typeof parsed?.error?.request_id === 'string' ? parsed.error.request_id : undefined;
      if (typeof detail === 'string' && detail) return { message: detail, code, requestId };
    } catch {
      /* 非 JSON，走下面的截断 */
    }
  }
  if (status === 403) return { message: '没有权限执行这个操作' };
  if (status === 404) return { message: '接口不存在，可能是版本不匹配' };
  if (status >= 500) return { message: '服务端出错了，请稍后重试' };
  return { message: raw ? raw.slice(0, 200) : `请求失败（HTTP ${status}）` };
}

export async function apiFetch<T>(path: string, init?: ApiFetchInit): Promise<T> {
  const { timeoutMs = 60000, signal, headers: initHeaders, ...fetchInit } = init ?? {};
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(initHeaders as Record<string, string> | undefined),
  };

  let res: Response;
  try {
    res = await fetch(resolveApiPath(path), {
      ...fetchInit,
      credentials: CREDENTIAL_MODE,
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) throw new Error(`请求超时（${Math.round(timeoutMs / 1000)}s）：${path}`, { cause: err });
    throw err;
  } finally {
    window.clearTimeout(timeout);
  }

  if (res.status === 401) {
    // 会话过期或已被撤销（改密码 / 管理员踢下线），统一回到登录态。
    // 先带上旧用户 id：authStore 需要在会话标记被删前把旧裸 key 归到旧账号。
    const expiredUserId = getSessionUserId();
    window.dispatchEvent(new CustomEvent('p2m:auth-expired', {
      detail: { userId: expiredUserId },
    }));
    clearSession();
    throw new ApiError('登录已失效，请重新登录', { status: 401 });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const parsed = extractErrorMessage(res.status, text);
    throw new ApiError(parsed.message, { status: res.status, code: parsed.code, requestId: parsed.requestId });
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
  has_subtitles?: boolean;
  has_summary?: boolean;
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
  /** 相对文件夹层级（不含系统路径） */
  folder_path?: string | null;
  /** 课程 / 章 / 课时 / 第 N 节 —— 后端 retrieval_meta 解析 */
  meta?: {
    course?: string;
    lesson?: string;
    lesson_no?: number | string | null;
    display?: string;
    meta_text?: string;
    position?: number;
    total?: number;
    prev?: string | null;
    next?: string | null;
  } | null;
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

export async function fetchVideos(page = 1, pageSize = 20, categoryId?: number, search?: string, categoryIds?: number[], isFavorite?: boolean): Promise<VideoPage> {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (categoryIds && categoryIds.length > 0) {
    params.set('category_ids', categoryIds.join(','));
  } else if (categoryId) {
    params.set('category_id', String(categoryId));
  }
  if (search) params.set('search', search);
  if (isFavorite !== undefined) params.set('is_favorite', String(isFavorite));
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

export async function searchSegments(q: string, limit = 20): Promise<SegmentSearchResult[]> {
  const params = new URLSearchParams({ q, limit: String(limit) });
  return apiFetch<SegmentSearchResult[]>(`/api/videos/search/segments?${params}`);
}

export interface AssistantHitlOption {
  id: string;
  label: string;
  description?: string;
}

export interface AssistantResumePayload {
  runId: string;
  interruptId?: string;
  selected?: string;
  text?: string;
  originalMessage?: string;
}

export type ChatStreamEvent =
  | { type: 'token'; text: string }
  | { type: 'tool_start'; tool: string }
  | { type: 'tool_end'; tool: string; ok: boolean | null }
  | {
      /** HITL 暂停点：任务停下来等用户选 A/B/C 或补充信息 */
      type: 'interrupt';
      run_id: string;
      session_id?: string;
      interrupt_id: string;
      kind: 'clarify' | 'supplement' | 'confirm' | string;
      question: string;
      options: AssistantHitlOption[];
      allow_custom: boolean;
      context?: string;
      intent?: string | null;
      original_message?: string;
    }
  | {
      type: 'done';
      run_id: string;
      session_id?: string;
      latency_ms: number;
      steps: unknown[];
      references?: Array<{
        video_id: number;
        video_title: string;
        folder_path?: string;
        start_sec: number;
        end_sec?: number;
        text: string;
        score?: number;
      }>;
      /** 回答正文里提到的视频（书名号片段 → video_id），用于渲染可点跳转 */
      mentioned_videos?: Array<{
        text: string;
        video_id: number;
      }>;
      /** 本轮真正落库的个人动作（笔记/日历/Todo），用于执行回执与撤回 */
      actions?: Array<{
        id: string;
        action_type: 'note' | 'calendar' | 'todo' | string;
        status: 'applied' | 'failed' | 'undone' | string;
        title: string;
        summary?: string | null;
        target_id?: string | null;
        created_at?: string | null;
        undone_at?: string | null;
        can_undo?: boolean;
      }>;
      /** 实际用的 LLM 通道（local / external） */
      provider?: string;
      /** 主通道失败、切到备用时，这里是失败的那家。空/缺省表示没降级。 */
      degraded_from?: string;
    }
  | { type: 'error'; message: string; provider?: string; degraded_from?: string };

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
    /** 当前笔记完整正文，供聊天工具保存；不放进提示词 */
    pageNote?: { title: string; markdown: string };
    systemPrompt?: string;
    videoId?: number;
    /** 前端 detectIntent() 识别到的意图 id，随请求存库，历史会话还原时用 */
    intent?: string | null;
    /** HITL 中断后继续；携带 runId + 用户选择，不重新写一条用户消息 */
    resume?: AssistantResumePayload;
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
      page_note: options.pageNote ?? undefined,
      system_prompt: options.systemPrompt ?? '',
      session_id: options.sessionId || undefined,
      video_id: options.videoId ?? undefined,
      intent: options.intent ?? undefined,
      resume: options.resume
        ? {
            run_id: options.resume.runId,
            interrupt_id: options.resume.interruptId ?? '',
            selected: options.resume.selected ?? '',
            text: options.resume.text ?? '',
            original_message: options.resume.originalMessage ?? '',
          }
        : undefined,
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
    // 后端扫模型是一次 15s 超时 + 最多 25s 预算的同步请求
    timeoutMs: 45000,
  });
  return data.models;
}

/** 当前实际生效的 LLM 配置（不含密钥），用于保存后自检。 */
export interface AssistantLlmHealth {
  policy: LlmUsagePolicy;
  external: { base_url: string; model: string; configured: boolean };
  local: { base_url: string; model: string; configured: boolean };
}

export async function fetchAssistantLlmHealth(): Promise<AssistantLlmHealth> {
  return apiFetch<AssistantLlmHealth>('/api/assistant/llm-health');
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
    // 后端单个请求就是 120s 超时，前端至少得比它长，否则本地大模型永远「超时」
    timeoutMs: 150000,
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

export async function clearFinishedAiJobs(): Promise<{ cleared: number }> {
  return apiFetch<{ cleared: number }>('/api/admin/ai-jobs/clear-history', { method: 'POST' });
}

export async function clearCompletedAiJobs(): Promise<{ cleared: number }> {
  return apiFetch<{ cleared: number }>('/api/admin/ai-jobs/clear-completed', { method: 'POST' });
}

export async function clearAllAiJobs(): Promise<{ cleared: number }> {
  return apiFetch<{ cleared: number }>('/api/admin/ai-jobs/clear-all', { method: 'POST' });
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

/** 撤回一条助手动作（笔记删除 / 日历事件删除 / Todo 软删）。 */
export async function undoAgentAction(actionId: string): Promise<{
  ok: boolean;
  already?: boolean;
  action?: {
    id: string;
    action_type: string;
    status: string;
    title: string;
    can_undo?: boolean;
    undone_at?: string | null;
  };
}> {
  return apiFetch(`/api/agent-actions/${encodeURIComponent(actionId)}/undo`, {
    method: 'POST',
    timeoutMs: 15000,
  });
}

/** 查询当前用户的动作执行记录；用于聊天面板的“执行记录”抽屉。 */
export async function fetchAgentActions(limit = 30): Promise<{
  items: Array<{
    id: string;
    action_type: 'note' | 'calendar' | 'todo' | string;
    status: string;
    title: string;
    summary?: string | null;
    target_id?: string | null;
    created_at?: string | null;
    undone_at?: string | null;
    can_undo?: boolean;
  }>;
  count: number;
}> {
  return apiFetch(`/api/agent-actions?limit=${Math.max(1, Math.min(100, limit))}`);
}
