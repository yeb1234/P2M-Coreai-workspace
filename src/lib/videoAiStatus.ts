import type { AiJobListItem, VideoItem } from './videoApi';

export type VideoAiCompletionState = 'complete' | 'needs_subtitles' | 'needs_summary' | 'active' | 'failed' | 'idle';

export interface VideoAiCompletion {
  state: VideoAiCompletionState;
  hasSubtitles: boolean;
  hasSummary: boolean;
  active: boolean;
  failed: boolean;
  complete: boolean;
  label: string;
}

export function getVideoAiCompletion(video: Pick<VideoItem, 'subtitle_url' | 'summary' | 'ai_status'>, latestJob?: Pick<AiJobListItem, 'status'> | null): VideoAiCompletion {
  const hasSubtitles = Boolean(video.subtitle_url);
  const hasSummary = Boolean(video.summary?.trim());
  const active = latestJob?.status === 'queued' || latestJob?.status === 'running' || video.ai_status === 'queued' || video.ai_status === 'running';
  const failed = latestJob?.status === 'failed' || video.ai_status === 'failed';
  const complete = hasSubtitles && hasSummary;

  if (active) {
    return { state: 'active', hasSubtitles, hasSummary, active, failed, complete, label: '处理中' };
  }
  if (complete) {
    return { state: 'complete', hasSubtitles, hasSummary, active, failed, complete, label: '已完成' };
  }
  if (failed) {
    return { state: 'failed', hasSubtitles, hasSummary, active, failed, complete, label: '处理失败' };
  }
  if (!hasSubtitles) {
    return { state: 'needs_subtitles', hasSubtitles, hasSummary, active, failed, complete, label: '缺字幕' };
  }
  if (!hasSummary) {
    return { state: 'needs_summary', hasSubtitles, hasSummary, active, failed, complete, label: '缺总结' };
  }
  return { state: 'idle', hasSubtitles, hasSummary, active, failed, complete, label: '未处理' };
}
