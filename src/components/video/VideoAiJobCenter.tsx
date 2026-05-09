import { AlertCircle, CheckCircle2, Clock3, Loader2, RefreshCw } from 'lucide-react';
import type { AiJobListOut } from '../../lib/videoApi';

interface VideoAiJobCenterProps {
  jobs: AiJobListOut | null;
  loading: boolean;
  onRefresh: () => void;
}

function statusLabel(status: string): string {
  if (status === 'queued') return '排队中';
  if (status === 'running') return '处理中';
  if (status === 'completed') return '已完成';
  if (status === 'failed') return '失败';
  return status || '未知';
}

function stageLabel(stage: string): string {
  if (stage === 'queued') return '等待处理';
  if (stage === 'claimed') return '已接收';
  if (stage === 'extracting') return '提取音频';
  if (stage === 'transcribing') return '生成字幕';
  if (stage === 'correcting-subtitles') return '校对字幕';
  if (stage === 'summarizing') return '生成总结';
  if (stage === 'writing') return '写入结果';
  if (stage === 'completed') return '处理完成';
  if (stage === 'missing-video') return '视频缺失';
  return stage || '等待处理';
}

function statusIcon(status: string) {
  if (status === 'running') return <Loader2 size={13} className="animate-spin text-[#c87d2f]" />;
  if (status === 'queued') return <Clock3 size={13} className="text-[#6b7280]" />;
  if (status === 'completed') return <CheckCircle2 size={13} className="text-[#16a34a]" />;
  if (status === 'failed') return <AlertCircle size={13} className="text-[#dc3545]" />;
  return <Clock3 size={13} className="text-[#6b7280]" />;
}

export function VideoAiJobCenter({ jobs, loading, onRefresh }: VideoAiJobCenterProps) {
  const items = jobs?.items ?? [];

  return (
    <div className="theme-surface rounded-xl border p-3">
      <div className="mb-3 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#1a1a1a]">AI 任务中心</p>
          <p className="text-[11px] text-[#9ca3af]">
            运行 {jobs?.running ?? 0} · 排队 {jobs?.queued ?? 0} · 失败 {jobs?.failed ?? 0}
          </p>
        </div>
        <button
          onClick={onRefresh}
          className="rounded-lg p-2 text-[#6b7280] transition-colors hover:bg-[#f3f2ef] hover:text-[#1a1a1a]"
          title="刷新 AI 任务"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#e5e2dd] bg-[#faf9f7] px-3 py-4 text-xs text-[#6b7280]">
          还没有 AI 转写或总结任务。
        </div>
      ) : (
        <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
          {items.map((job) => (
            <div key={job.id} className="rounded-lg border border-[#ebe7df] bg-[#faf9f7] p-2">
              <div className="flex items-start gap-2">
                <div className="mt-0.5">{statusIcon(job.status)}</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-[#1a1a1a]">
                    {job.video_title || `视频 #${job.video_id}`}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[#6b7280]">
                    {statusLabel(job.status)} · {stageLabel(job.stage)} · {job.whisper_model}
                    {job.cpu_threads ? ` · ${job.cpu_threads} 线程` : ''}
                  </p>
                  {(job.error || job.summary_error) && (
                    <p className="mt-1 line-clamp-2 text-[11px] text-[#dc3545]">
                      {job.error || job.summary_error}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
