import { AlertCircle, Loader2, RefreshCw, Sparkles } from 'lucide-react';

interface VideoAiSummaryPanelProps {
  summary: string | null;
  isProcessing: boolean;
  jobStatus: string | null;
  jobStage: string | null;
  /** 后端翻译好的失败原因（两行：原因 + 建议） */
  jobError?: string | null;
  /** 重新生成入口，失败时让用户一键重试 */
  onRetry?: () => void;
}

function jobStageLabel(stage: string | null): string {
  if (stage === 'extracting') return '正在提取音频';
  if (stage === 'transcribing') return '正在生成字幕';
  if (stage === 'summarizing') return '正在生成总结';
  if (stage === 'cancelling') return '正在取消…';
  return '处理中';
}

export function VideoAiSummaryPanel({ summary, isProcessing, jobStatus, jobStage, jobError, onRetry }: VideoAiSummaryPanelProps) {
  const failed = jobStatus === 'failed';
  const [reason, advice] = (jobError ?? '').split('\n');

  return (
    <div className="theme-surface rounded-xl border p-4">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={15} className="text-[var(--accent)]" />
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">AI 总结</h3>
        {isProcessing && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-[var(--accent)]">
            <Loader2 size={12} className="animate-spin" />
            {jobStageLabel(jobStage)}
          </span>
        )}
        {failed && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-[var(--danger)]">
            <AlertCircle size={12} />
            失败
          </span>
        )}
      </div>
      {summary ? (
        <div className="whitespace-pre-wrap text-sm leading-7 text-[var(--text-primary)]">{summary}</div>
      ) : failed ? (
        /* 失败要有「为什么 + 怎么办」。
           原来这里只说「失败」，用户不知道是超时、鉴权还是文件丢了，
           只能反复点重试碰运气。原因由后端 humanize_job_error() 翻译好。 */
        <div className="rounded-lg border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-3 py-3">
          <p className="text-sm font-medium text-[var(--danger)]">{reason || '处理失败'}</p>
          {advice && <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{advice}</p>}
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
            >
              <RefreshCw size={12} />
              重试
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-[var(--border-light)] bg-[var(--bg-elevated)] px-3 py-4 text-sm text-[var(--text-secondary)]">
          {isProcessing ? 'AI 正在生成字幕和总结，完成后会显示在这里。' : '还没有总结。点击右侧“生成字幕与总结”后，会自动生成字幕、转录和总结。'}
        </div>
      )}
    </div>
  );
}
