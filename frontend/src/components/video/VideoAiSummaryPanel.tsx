import { Sparkles } from 'lucide-react';

interface VideoAiSummaryPanelProps {
  summary: string | null;
}

export function VideoAiSummaryPanel({ summary }: VideoAiSummaryPanelProps) {
  return (
    <div className="theme-surface rounded-xl border p-4">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles size={15} className="text-[var(--accent)]" />
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">AI 总结</h3>
      </div>
      {summary ? (
        <div className="whitespace-pre-wrap text-sm leading-7 text-[var(--text-primary)]">{summary}</div>
      ) : (
        <div className="rounded-lg border border-dashed border-[var(--border-light)] bg-[var(--bg-elevated)] px-3 py-4 text-sm text-[var(--text-secondary)]">
          暂无总结。总结由 P2 Transcribe 生成，完成后会自动同步到这里。
        </div>
      )}
    </div>
  );
}
