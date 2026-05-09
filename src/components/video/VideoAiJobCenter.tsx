import { AlertCircle, CheckCircle2, Clock3, Loader2, RefreshCw } from 'lucide-react';
import type { AiJobListOut } from '../../lib/videoApi';

interface VideoAiJobCenterProps {
  jobs: AiJobListOut | null;
  loading: boolean;
  selectedStatus: string | null;
  batchCount?: number;
  batchLoading?: boolean;
  onStatusChange: (status: string | null) => void;
  onBatchFolder?: () => void;
  onRefresh: () => void;
}

const STATUS_FILTERS = [
  { value: null, label: '全部' },
  { value: 'running', label: '运行' },
  { value: 'queued', label: '排队' },
  { value: 'failed', label: '失败' },
  { value: 'completed', label: '完成' },
] as const;

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

export function VideoAiJobCenter({
  jobs,
  loading,
  selectedStatus,
  batchCount = 0,
  batchLoading = false,
  onStatusChange,
  onBatchFolder,
  onRefresh,
}: VideoAiJobCenterProps) {
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

      {onBatchFolder && (
        <button
          onClick={onBatchFolder}
          disabled={batchLoading || batchCount <= 0}
          className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#f2d6b8] bg-[#fff7ed] px-3 py-2 text-xs font-medium text-[#a95f17] transition-colors hover:bg-[#ffedd5] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {batchLoading ? <Loader2 size={13} className="animate-spin" /> : null}
          批处理当前文件夹{batchCount > 0 ? `（${batchCount} 个）` : ''}
        </button>
      )}

      <div className="mb-3 grid grid-cols-5 gap-1">
        {STATUS_FILTERS.map((filter) => {
          const active = selectedStatus === filter.value;
          return (
            <button
              key={filter.value ?? 'all'}
              onClick={() => onStatusChange(filter.value)}
              className={`rounded-md px-1.5 py-1 text-[11px] transition-colors ${
                active ? 'bg-[#c87d2f] text-white' : 'bg-[#f3f2ef] text-[#6b7280] hover:bg-[#e5e2dd]'
              }`}
            >
              {filter.label}
            </button>
          );
        })}
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#e5e2dd] bg-[#faf9f7] px-3 py-4 text-xs text-[#6b7280]">
          {selectedStatus ? `没有${statusLabel(selectedStatus)}的 AI 任务。` : '还没有 AI 转写或总结任务。'}
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
