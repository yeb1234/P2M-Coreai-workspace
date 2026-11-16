import { apiFetch } from './videoApi';

export interface PathVideo {
  id: number;
  title: string | null;
  duration: number | null;
  category_id: number | null;
}

export type StepStatus = 'pending' | 'in_progress' | 'done' | 'skipped';

export interface PathStep {
  id: string;
  order_index: number;
  title: string;
  objective: string;
  video_ids: number[];
  videos: PathVideo[];
  est_minutes: number;
  status: StepStatus;
  reflection: string;
}

export interface PathProgress {
  done: number;
  total: number;
  percent: number;
  done_minutes: number;
}

export interface LearningPath {
  id: string;
  goal_id: string;
  title: string;
  summary: string | null;
  status: string;
  total_est_minutes: number;
  created_at: string | null;
  progress: PathProgress;
  steps: PathStep[];
}

export interface LearningGoal {
  id: string;
  title: string;
  target_role: string | null;
  deadline: string | null;
  weekly_hours: number;
  status: string;
  skills: unknown[];
}

export interface LearningProfileDto {
  total_watch_minutes: number;
  videos_started: number;
  videos_completed: number;
  completion_rate: number;
  avg_session_minutes: number;
  active_days_30d: number;
  streak_days: number;
  notes_count: number;
  active_hours: Record<string, number>;
  top_categories: Array<{ category_id: number; name: string; minutes: number; share: number }>;
  last_active_at: string | null;
  computed_at: string | null;
}

export interface GeneratePathPayload {
  title: string;
  target_role?: string;
  deadline?: string;
  weekly_hours?: number;
  skills?: string[];
}

export interface GenerateRunResult {
  run_id: string;
  status: string;
  deduplicated?: boolean;
}

export interface RunState {
  run_id: string;
  status: 'running' | 'completed' | 'failed';
  result: {
    ok?: boolean;
    path_id?: string;
    summary?: string;
    critique?: string;
    revision?: number;
    steps?: Array<{ title: string; objective?: string; est_minutes?: number; videos?: Array<{ video_id: number; title: string }> }>;
    error?: string;
  } | null;
  error: string | null;
  latency_ms: number | null;
}

export function fetchLearningProfile(): Promise<LearningProfileDto> {
  return apiFetch<LearningProfileDto>('/api/learning/profile');
}

export function fetchPaths(limit = 20): Promise<LearningPath[]> {
  return apiFetch<LearningPath[]>(`/api/learning/paths?limit=${limit}`);
}

export function generatePath(payload: GeneratePathPayload): Promise<GenerateRunResult> {
  return apiFetch<GenerateRunResult>('/api/learning/paths/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
    // 提交本身很快，真正的等待在轮询里
    timeoutMs: 20000,
  });
}

export function fetchRun(runId: string): Promise<RunState> {
  return apiFetch<RunState>(`/api/learning/runs/${encodeURIComponent(runId)}`);
}

export function updateStepStatus(
  stepId: string,
  status: StepStatus,
  reflection?: string
): Promise<{ id: string; status: StepStatus; path_status: string }> {
  return apiFetch(`/api/learning/steps/${encodeURIComponent(stepId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, reflection: reflection ?? '' }),
  });
}

export function updatePathStatus(
  pathId: string,
  status: 'draft' | 'active' | 'completed' | 'archived'
): Promise<{ id: string; status: string }> {
  return apiFetch(`/api/learning/paths/${encodeURIComponent(pathId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

/** 轮询规划任务直到结束。生成一次约 20-40 秒，超时给 3 分钟。 */
export async function waitForRun(
  runId: string,
  onTick?: (elapsedSec: number) => void,
  options?: { intervalMs?: number; timeoutMs?: number }
): Promise<RunState> {
  const intervalMs = options?.intervalMs ?? 2500;
  const timeoutMs = options?.timeoutMs ?? 180_000;
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
    const state = await fetchRun(runId);
    if (state.status !== 'running') return state;
    onTick?.(Math.round((Date.now() - started) / 1000));
  }
  throw new Error('生成超时，请稍后在列表里查看是否已完成');
}
