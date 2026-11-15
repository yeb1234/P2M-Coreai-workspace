import { useState, type ReactNode } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  SearchCheck,
  Trash2,
  X,
} from 'lucide-react';
import type { AiJobBatchMode, AiJobBatchOut, AiJobListItem, AiJobListOut } from '../../lib/videoApi';

interface VideoAiJobCenterProps {
  jobs: AiJobListOut | null;
  loading: boolean;
  selectedStatus: string | null;
  batchCount?: number;
  batchScope?: 'leaf' | 'descendants';
  batchLoading?: boolean;
  batchProgress?: { completed: number; running: number; queued: number; failed: number; total: number };
  batchMode?: AiJobBatchMode;
  batchLimit?: number;
  batchCorrectionEnabled?: boolean;
  batchPreview?: AiJobBatchOut | null;
  queuePaused?: boolean;
  queueStuck?: boolean;
  onStatusChange: (status: string | null) => void;
  onBatchModeChange?: (mode: AiJobBatchMode) => void;
  onBatchLimitChange?: (limit: number) => void;
  onBatchCorrectionChange?: (enabled: boolean) => void;
  onPreviewBatchFolder?: () => void;
  onBatchFolder?: () => void;
  onToggleQueue?: () => void;
  onCancelJob?: (jobId: string) => void;
  onResumeJob?: (jobId: string) => void;
  onSyncQueuedSettings?: () => void;
  onApplySettings?: () => void;
  onClearCompleted?: () => void;
  onClearAll?: () => void;
  onRefresh: () => void;
}

const STATUS_FILTERS = [
  { value: null, label: '全部' },
  { value: 'running', label: '运行' },
  { value: 'queued', label: '排队' },
  { value: 'failed', label: '失败' },
  { value: 'completed', label: '完成' },
] as const;

const BATCH_MODES: Array<{ value: AiJobBatchMode; label: string; desc: string }> = [
  { value: 'unfinished', label: '继续未完成', desc: '跳过已有字幕和总结的视频，只补没完成的。' },
  { value: 'missing_subtitles', label: '只处理无字幕', desc: '只给没有字幕的视频生成字幕和总结。' },
  { value: 'missing_summary', label: '只补总结', desc: '已有字幕但没有总结时才入队。' },
  { value: 'failed_only', label: '只重试失败', desc: '只把最近失败的视频重新入队。' },
  { value: 'all', label: '全部重跑', desc: '清空旧 AI 输出后重新生成。' },
];

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

function summarizeSkippedItems(batchPreview: AiJobBatchOut | null | undefined) {
  const counts = new Map<string, number>();
  for (const item of batchPreview?.skipped_items ?? []) {
    counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1);
  }
  return [...counts.entries()].map(([reason, count]) => `${skipReasonLabel(reason)} ${count}`).join(' / ');
}

function statusLabel(status: string) {
  switch (status) {
    case 'running':
      return '运行中';
    case 'queued':
      return '排队中';
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    case 'cancelled':
      return '已取消';
    case 'cancelling':
      return '正在停止';
    default:
      return status || '未知';
  }
}

function stageLabel(stage: string | null | undefined) {
  switch (stage) {
    case 'extracting':
      return '提取音频';
    case 'transcribing':
      return '转写';
    case 'correcting':
    case 'correcting-subtitles':
      return '校对';
    case 'summarizing':
      return '总结';
    case 'writing':
      return '写入';
    case 'completed':
      return '完成';
    case 'queued':
    case 'claimed':
      return '排队';
    case 'cancelling':
      return '正在停止';
    default:
      return stage || '等待';
  }
}

function correctionScopeLabel(job: AiJobListItem) {
  if (!job.subtitle_correction_enabled || job.subtitle_correction_scope === 'off') return '不校对';
  return '全量校对';
}

function messageLabel(message: string | null | undefined) {
  switch (message) {
    case 'Queued for processing':
      return '已加入队列，等待处理';
    case 'Worker claimed job':
      return '任务已接管，准备开始';
    case 'Extracting audio':
      return '正在提取音频';
    case 'Transcribing audio':
      return '正在转写字幕';
    case 'Correcting subtitles':
      return '正在校对字幕';
    case 'Summarizing content':
      return '正在生成总结';
    case 'Writing markdown and subtitles':
      return '正在写入字幕和笔记';
    case 'Processing complete':
      return '处理完成';
    case 'Requeued after worker restart':
      return '后端重启后已重新排队';
    case 'Resumed by user':
      return '已手动继续任务';
    case 'Queued with current transcription settings':
      return '已同步当前转写设置';
    case 'Cancelled by user':
      return '已停止';
    case 'Cancelled by clear all':
      return '清除全部时已停止';
    case 'Stopping worker (will finalize after current step)':
      return '正在停止，等待当前步骤完成';
    case 'Paused by user':
      return '已暂停';
    default:
      return message || '';
  }
}

const PROCESS_STEPS = [
  { key: 'queued', label: '排队' },
  { key: 'claimed', label: '准备' },
  { key: 'extracting', label: '提取' },
  { key: 'transcribing', label: '转写' },
  { key: 'correcting-subtitles', label: '校对' },
  { key: 'summarizing', label: '总结' },
  { key: 'writing', label: '写入' },
  { key: 'completed', label: '完成' },
] as const;

function normalizedStage(job: AiJobListItem) {
  if (job.status === 'completed') return 'completed';
  if (job.status === 'queued') return 'queued';
  if (job.status === 'cancelling') return 'cancelling';
  if (job.stage === 'correcting') return 'correcting-subtitles';
  return job.stage || job.status;
}

function statusIcon(status: string) {
  if (status === 'running') return <Loader2 size={13} className="animate-spin text-[var(--accent)]" />;
  if (status === 'cancelling') return <Loader2 size={13} className="animate-spin text-[var(--text-muted)]" />;
  if (status === 'completed') return <CheckCircle2 size={13} className="text-[var(--success)]" />;
  if (status === 'failed') return <AlertCircle size={13} className="text-[var(--danger)]" />;
  return <Clock3 size={13} className="text-[var(--text-muted)]" />;
}

function runtimeParts(job: AiJobListItem) {
  const parts = [
    job.whisper_engine || '默认引擎',
    job.whisper_model,
    job.compute_type ? `算力 ${job.compute_type}` : null,
    job.cpu_threads ? `CPU ${job.cpu_threads} 线程` : null,
    correctionScopeLabel(job),
  ];
  return parts.filter(Boolean).join(' / ');
}

function compactDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function IconButton({
  title,
  onClick,
  disabled,
  children,
  danger,
}: {
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
        danger
          ? 'text-[var(--danger)] hover:border-[color-mix(in_srgb,var(--danger)_38%,transparent)] hover:bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]'
          : 'text-[var(--text-secondary)] hover:border-[var(--border-light)] hover:bg-[var(--bg-accent)] hover:text-[var(--accent)]'
      }`}
    >
      {children}
    </button>
  );
}

export function VideoAiJobCenter({
  jobs,
  loading,
  selectedStatus,
  batchCount = 0,
  batchScope = 'leaf',
  batchLoading = false,
  batchProgress,
  batchMode = 'unfinished',
  batchLimit = 100,
  batchCorrectionEnabled = false,
  batchPreview,
  queuePaused = false,
  queueStuck = false,
  onStatusChange,
  onBatchModeChange,
  onBatchLimitChange,
  onBatchCorrectionChange,
  onPreviewBatchFolder,
  onBatchFolder,
  onToggleQueue,
  onCancelJob,
  onResumeJob,
  onSyncQueuedSettings,
  onApplySettings,
  onClearCompleted,
  onClearAll,
  onRefresh,
}: VideoAiJobCenterProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [limitDraft, setLimitDraft] = useState(String(batchLimit));

  const items = jobs?.items ?? [];
  const previewEnqueueCount = batchPreview ? Math.min(batchPreview.eligible, batchPreview.max_enqueue) : batchLimit;
  const statusCount = (value: string | null) => {
    switch (value) {
      case 'running': return jobs?.running ?? 0;
      case 'queued': return jobs?.queued ?? 0;
      case 'failed': return jobs?.failed ?? 0;
      case 'completed': return jobs?.completed ?? 0;
      default: return jobs?.total ?? 0;
    }
  };
  const batchScopeLabel = batchScope === 'descendants' ? '全部视频范围' : '当前文件夹';
  const currentBatchMode = BATCH_MODES.find((mode) => mode.value === batchMode) ?? BATCH_MODES[0];
  const skippedSummary = summarizeSkippedItems(batchPreview);
  const totalActive = (jobs?.running ?? 0) + (jobs?.queued ?? 0);
  const hasQueuedOrRunningJobs = totalActive > 0;
  const canToggleQueue = queuePaused || hasQueuedOrRunningJobs;

  const commitLimit = () => {
    const parsed = Number.parseInt(limitDraft, 10);
    if (!Number.isFinite(parsed)) {
      setLimitDraft(String(batchLimit));
      return;
    }
    const next = Math.max(1, Math.min(999999, parsed));
    setLimitDraft(String(next));
    onBatchLimitChange?.(next);
  };

  return (
    <div className="theme-surface min-w-0 overflow-hidden rounded-xl border px-5 py-4">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-accent)] hover:text-[var(--accent)]"
          title={collapsed ? '展开 AI 任务中心' : '收起 AI 任务中心'}
          aria-label={collapsed ? '展开 AI 任务中心' : '收起 AI 任务中心'}
        >
          {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex min-h-8 min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="shrink-0 text-sm font-semibold leading-5 text-[var(--text-primary)]">AI 任务中心</h3>
            <span className="text-xs leading-5 text-[var(--text-muted)]">
              {totalActive > 0 ? `${jobs?.running ?? 0} 运行 / ${jobs?.queued ?? 0} 排队` : '队列空闲'}
            </span>
            {queuePaused && (
              <span className="rounded-full border border-[color-mix(in_srgb,var(--accent)_35%,var(--border-light))] bg-[var(--accent-bg)] px-2 py-0.5 text-xs text-[var(--accent)]">
                已暂停
              </span>
            )}
          </div>
          {!collapsed && batchProgress && (
            <p className="mt-1 truncate text-xs text-[var(--text-muted)]">
              本轮 {batchProgress.completed}/{batchProgress.total}，运行 {batchProgress.running}，排队 {batchProgress.queued}，失败 {batchProgress.failed}
            </p>
          )}
        </div>

        {!collapsed && (
          <div className="flex shrink-0 flex-nowrap items-center gap-1 pl-1">
            <button
              type="button"
              onClick={canToggleQueue ? onToggleQueue : undefined}
              disabled={!canToggleQueue}
              className={`inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                queuePaused || queueStuck
                  ? 'bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]'
                  : 'border border-[var(--border-light)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
              }`}
              title={
                queuePaused
                  ? '开始任务（恢复新任务入队）'
                  : queueStuck
                  ? '队列卡住，点击重新调度排队任务'
                  : hasQueuedOrRunningJobs
                  ? '暂停任务（运行中任务不受影响）'
                  : '没有可暂停的任务'
              }
            >
              {queuePaused || queueStuck ? <Play size={13} /> : <Pause size={13} />}
              <span>
                {queuePaused ? '开始任务' : queueStuck ? '开始任务' : hasQueuedOrRunningJobs ? '暂停任务' : '队列空闲'}
              </span>
            </button>
            <IconButton title="刷新任务状态" onClick={onRefresh} disabled={loading}>
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </IconButton>
            <IconButton title="清除已完成任务" onClick={onClearCompleted}>
              <CheckCircle2 size={13} />
            </IconButton>
            <IconButton title="同步排队任务设置" onClick={onSyncQueuedSettings}>
              <SearchCheck size={13} />
            </IconButton>
            <IconButton title="清除全部（运行中任务不受影响）" onClick={onClearAll} danger>
              <Trash2 size={13} />
            </IconButton>
          </div>
        )}
      </div>

      {!collapsed && (
        <div className="mt-4 min-w-0 space-y-4">
          <div className="min-w-0 overflow-hidden rounded-xl border border-[var(--border-light)] bg-[var(--bg-elevated)] p-4">
            <div className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-[var(--text-primary)]">批处理{batchScopeLabel}</p>
                <p className="truncate text-xs text-[var(--text-muted)]">
                  来源：{batchScopeLabel} {batchCount} 个视频，规则：{currentBatchMode.label}，预计新增 {previewEnqueueCount} 个任务
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={onPreviewBatchFolder}
                  disabled={batchLoading}
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
                  onClick={onBatchFolder}
                  disabled={batchLoading}
                  className="inline-flex h-7 items-center gap-1 rounded-lg bg-[var(--accent)] px-2 text-xs text-white hover:bg-[var(--accent-hover)] disabled:opacity-45"
                >
                  {batchLoading ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                  入队
                </button>
              </div>
            </div>

            <div className="auto-grid-compact">
              {BATCH_MODES.map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  onClick={() => onBatchModeChange?.(mode.value)}
                  className={`min-w-0 truncate rounded-lg border px-2 py-1.5 text-left text-xs transition-colors ${
                    batchMode === mode.value
                      ? 'border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--accent)]'
                      : 'border-[var(--border-light)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
                  }`}
                  title={mode.label}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
              {currentBatchMode.desc}
            </p>

            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
              <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-[var(--border-light)] px-2 py-1.5 text-xs text-[var(--text-secondary)]">
                <span className="shrink-0">最多新增入队</span>
                <input
                  value={limitDraft}
                  onChange={(event) => setLimitDraft(event.target.value)}
                  onBlur={commitLimit}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                  inputMode="numeric"
                  className="min-w-0 flex-1 border-0 bg-transparent px-1 py-0 text-right text-xs text-[var(--text-primary)] outline-none"
                />
              </label>
              <label className="flex min-w-[145px] shrink-0 items-center justify-between gap-3 rounded-lg border border-[var(--border-light)] px-2 py-1.5 text-xs text-[var(--text-secondary)]">
                <span>同时校对字幕</span>
                <input
                  type="checkbox"
                  checked={batchCorrectionEnabled}
                  onChange={(event) => onBatchCorrectionChange?.(event.target.checked)}
                  className="h-3.5 w-3.5 accent-[#c87d2f]"
                />
              </label>
            </div>

            {batchPreview && (
              <div className="mt-2 min-w-0 rounded-lg border border-[var(--border-light)] bg-[var(--bg-card)] px-2 py-1.5 text-xs leading-5 text-[var(--text-muted)]">
                <p>
                  共 {batchPreview.requested}，可处理 {batchPreview.eligible}，本次入队 {batchPreview.enqueued || previewEnqueueCount}，跳过 {batchPreview.skipped}
                  {batchPreview.active ? `，活动中 ${batchPreview.active}` : ''}
                  {batchPreview.already_done ? `，已满足条件 ${batchPreview.already_done}` : ''}
                  {batchPreview.failed ? `，失败项 ${batchPreview.failed}` : ''}
                  {batchPreview.limited ? '，已按上限截断' : ''}
                </p>
                {skippedSummary && <p className="truncate">跳过原因：{skippedSummary}</p>}
                {batchPreview.skipped_items.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {batchPreview.skipped_items.slice(0, 3).map((item) => (
                      <p key={`${item.video_id}-${item.reason}`} className="truncate" title={item.title}>
                        {skipReasonLabel(item.reason)}：{item.title}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-wrap gap-2">
            {STATUS_FILTERS.map((filter) => {
              const count = statusCount(filter.value);
              return (
                <button
                  key={filter.value ?? 'all'}
                  type="button"
                  onClick={() => onStatusChange(filter.value)}
                  className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs transition-colors ${
                    selectedStatus === filter.value
                      ? 'border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--accent)]'
                      : 'border-[var(--border-light)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
                  }`}
                >
                  <span>{filter.label}</span>
                  <span className="rounded-full bg-[var(--bg-accent)] px-1 text-xs tabular-nums text-[var(--text-muted)]">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="min-w-0 max-h-[480px] space-y-2 overflow-y-auto pr-1">
            {items.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--border-light)] px-3 py-4 text-center text-xs text-[var(--text-muted)]">
                {loading ? '正在读取任务...' : '暂无 AI 任务'}
              </div>
            ) : (
              items.map((job) => {
                const currentStage = normalizedStage(job);
                const currentStepIndex = PROCESS_STEPS.findIndex((step) => step.key === currentStage);
                const message = messageLabel(job.message);
                const showSteps = !['failed', 'cancelled'].includes(job.status);

                return (
                  <div
                    key={job.id}
                    className="min-w-0 overflow-hidden rounded-lg border border-[var(--border-light)] bg-[var(--bg-elevated)] px-3 py-2"
                  >
                    <div className="flex min-w-0 items-start gap-2">
                      <div className="mt-0.5 shrink-0">{statusIcon(job.status)}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                          <p className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--text-primary)]" title={job.video_title || `视频 ${job.video_id}`}>
                            {job.video_title || `视频 ${job.video_id}`}
                          </p>
                          {job.duration != null && (
                            <span className="shrink-0 rounded bg-[var(--bg-accent)] px-1 py-0.5 text-xs tabular-nums text-[var(--text-muted)]">
                              {(() => {
                                const sec = Math.round(job.duration);
                                const h = Math.floor(sec / 3600);
                                const m = Math.floor((sec % 3600) / 60);
                                const s = sec % 60;
                                if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
                                return `${m}:${String(s).padStart(2, '0')}`;
                              })()}
                            </span>
                          )}
                          <span className="shrink-0 text-xs text-[var(--text-muted)]">{compactDate(job.updated_at)}</span>
                        </div>
                        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--text-muted)]">
                          <span>{statusLabel(job.status)}</span>
                          <span>{stageLabel(job.stage)}</span>
                          <span className="min-w-0 truncate">{runtimeParts(job)}</span>
                        </div>
                        {showSteps && (
                          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1">
                            {PROCESS_STEPS.map((step, index) => {
                              const done = currentStepIndex >= 0 && index < currentStepIndex;
                              const active = index === currentStepIndex;
                              return (
                                <span
                                  key={step.key}
                                  className={`rounded-full border px-1.5 py-0.5 text-xs leading-none ${
                                    active
                                      ? 'border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--accent)]'
                                      : done
                                      ? 'border-[color-mix(in_srgb,var(--success)_35%,var(--border-light))] bg-[color-mix(in_srgb,var(--success)_10%,transparent)] text-[var(--success)]'
                                      : 'border-[var(--border-light)] text-[var(--text-muted)]'
                                  }`}
                                >
                                  {step.label}
                                </span>
                              );
                            })}
                          </div>
                        )}
                        {message && (
                          <div className="mt-1 flex items-center gap-1 text-xs text-[var(--text-secondary)]">
                            <span className="truncate" title={job.message}>{message}</span>
                            {job.status === 'completed' && job.duration != null && job.started_at != null && (
                              <span className="shrink-0 rounded-full border border-[color-mix(in_srgb,var(--success)_35%,var(--border-light))] bg-[color-mix(in_srgb,var(--success)_10%,transparent)] px-1.5 py-0.5 text-xs leading-none text-[var(--success)]">
                                {(() => {
                                  const started = new Date(job.started_at!).getTime();
                                  const ended = new Date(job.updated_at).getTime();
                                  const processingSec = Math.max(1, (ended - started) / 1000);
                                  const speed = job.duration! / processingSec;
                                  return `${speed.toFixed(1)}x`;
                                })()}
                              </span>
                            )}
                          </div>
                        )}
                        {(job.error || job.summary_error) && (
                          <p className="mt-1 line-clamp-2 text-xs text-[var(--danger)]" title={job.error || job.summary_error || undefined}>
                            {job.error || job.summary_error}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {['failed', 'cancelled', 'completed'].includes(job.status) && (
                          <IconButton title="继续这个任务" onClick={() => onResumeJob?.(job.id)}>
                            <RotateCcw size={13} />
                          </IconButton>
                        )}
                        {job.status === 'running' && (
                          <IconButton title="运行中不可停止" disabled>
                            <X size={13} className="opacity-45" />
                          </IconButton>
                        )}
                        {job.status === 'queued' && (
                          <IconButton title="停止这个任务" onClick={() => onCancelJob?.(job.id)} danger>
                            <X size={13} />
                          </IconButton>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
