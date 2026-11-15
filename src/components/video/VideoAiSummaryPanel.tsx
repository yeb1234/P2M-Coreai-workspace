import { AlertCircle, Loader2, Sparkles } from 'lucide-react';

interface VideoAiSummaryPanelProps {
  summary: string | null;
  isProcessing: boolean;
  jobStatus: string | null;
  jobStage: string | null;
}

function jobStageLabel(stage: string | null): string {
  if (stage === 'extracting') return '正在提取音频';
  if (stage === 'transcribing') return '正在生成字幕';
  if (stage === 'summarizing') return '正在生成总结';
  return '处理中';
}

export function VideoAiSummaryPanel({ summary, isProcessing, jobStatus, jobStage }: VideoAiSummaryPanelProps) {
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
        {jobStatus === 'failed' && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-[var(--danger)]">
            <AlertCircle size={12} />
            失败
          </span>
        )}
      </div>
      {summary ? (
        <div className="whitespace-pre-wrap text-sm leading-7 text-[var(--text-primary)]">{summary}</div>
      ) : (
        <div className="rounded-lg border border-dashed border-[var(--border-light)] bg-[var(--bg-elevated)] px-3 py-4 text-sm text-[var(--text-secondary)]">
          {isProcessing ? 'AI 正在生成字幕和总结，完成后会显示在这里。' : '还没有总结。点击右侧“生成字幕与总结”后，会自动生成字幕、转录和总结。'}
        </div>
      )}
    </div>
  );
}
