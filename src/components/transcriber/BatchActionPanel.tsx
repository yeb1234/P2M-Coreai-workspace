import { Loader2, Play, RefreshCw, SearchCheck } from 'lucide-react';
import type { AiJobBatchOut } from '../../lib/videoApi';

const SKIP_REASON_LABELS: Record<string, string> = {
  active_job: '正在运行或排队',
  complete: '已完成',
  has_subtitles: '已有字幕',
  has_summary: '已有总结',
  no_subtitles: '没有字幕',
  not_failed: '最近不是失败',
  missing_video: '视频不存在',
  unknown_mode: '模式未知',
  skipped: '已跳过',
};

function skipReasonLabel(reason: string) {
  return SKIP_REASON_LABELS[reason] ?? reason;
}

interface BatchActionPanelProps {
  selectedVideoCount: number;
  batchLoading: boolean;
  batchPreview: AiJobBatchOut | null;
  batchError?: string | null;
  onPreview: () => void;
  onApplySettings?: () => void;
  onEnqueue: () => void;
}

export function BatchActionPanel({ selectedVideoCount, batchLoading, batchPreview, batchError, onPreview, onApplySettings, onEnqueue }: BatchActionPanelProps) {
  return (
    <div className="min-w-0 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-[var(--text-primary)]">批量操作</p>
          <p className="text-xs text-[var(--text-muted)]">
            已选 {selectedVideoCount} 个视频
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onPreview}
            disabled={batchLoading || selectedVideoCount === 0}
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--border-light)] px-2 text-xs text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-45"
          >
            <SearchCheck size={13} />
            预览
          </button>
          <button
            type="button"
            onClick={onApplySettings}
            disabled={batchLoading}
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--border-light)] px-2 text-xs text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-45"
            title="将左侧当前转写设置保存到后端并同步给排队中的任务"
          >
            <RefreshCw size={13} />
            应用当前设置
          </button>
          <button
            type="button"
            onClick={onEnqueue}
            disabled={batchLoading || selectedVideoCount === 0}
            className="inline-flex h-7 items-center gap-1 rounded-lg bg-[var(--accent)] px-2 text-xs text-white hover:bg-[var(--accent-hover)] disabled:opacity-45"
          >
            {batchLoading ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            入队
          </button>
        </div>
      </div>

      {batchError && (
        <div className="min-w-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
          {batchError}
        </div>
      )}

      {batchPreview && (
        <div className="min-w-0 rounded-lg border border-[var(--border-light)] bg-[var(--bg-elevated)] px-3 py-2 text-xs leading-5 text-[var(--text-muted)]">
          <p>
            共 {batchPreview.requested}，可处理 {batchPreview.eligible}，本次入队 {batchPreview.enqueued || Math.min(batchPreview.eligible, batchPreview.max_enqueue)}，跳过 {batchPreview.skipped}
            {batchPreview.active ? `，活动中 ${batchPreview.active}` : ''}
            {batchPreview.already_done ? `，已满足条件 ${batchPreview.already_done}` : ''}
            {batchPreview.failed ? `，失败项 ${batchPreview.failed}` : ''}
            {batchPreview.limited ? '，已按上限截断' : ''}
          </p>
          {batchPreview.skipped_items.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {batchPreview.skipped_items.slice(0, 5).map((item) => (
                <p key={`${item.video_id}-${item.reason}`} className="truncate" title={item.title}>
                  {skipReasonLabel(item.reason)}：{item.title}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
