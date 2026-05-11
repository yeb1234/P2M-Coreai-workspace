import { useEffect, useState, type ReactNode } from 'react';
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

const BATCH_MODES: Array<{ value: AiJobBatchMode; label: string }> = [
  { value: 'unfinished', label: '继续未完成' },
  { value: 'missing_subtitles', label: '只处理无字幕' },
  { value: 'missing_summary', label: '只补总结' },
  { value: 'failed_only', label: '只重试失败' },
  { value: 'all', label: '全部重跑' },
];

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
  if (job.stage === 'correcting') return 'correcting-subtitles';
  return job.stage || job.status;
}

function statusIcon(status: string) {
  if (status === 'running') return <Loader2 size={13} className="animate-spin text-[var(--accent)]" />;
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
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
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
  batchLimit = 20,
  batchCorrectionEnabled = false,
  batchPreview,
  queuePaused = false,
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
  onClearCompleted,
  onClearAll,
  onRefresh,
}: VideoAiJobCenterProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [limitDraft, setLimitDraft] = useState(String(batchLimit));

  useEffect(() => {
    setLimitDraft(String(batchLimit));
  }, [batchLimit]);

  const items = jobs?.items ?? [];
  const previewEnqueueCount = batchPreview ? Math.min(batchPreview.eligible, batchPreview.max_enqueue) : batchLimit;
  const batchScopeLabel = batchScope === 'descendants' ? '全部视频范围' : '当前文件夹';
  const totalActive = (jobs?.running ?? 0) + (jobs?.queued ?? 0);
  const hasQueuedOrRunningJobs = totalActive > 0;
  const canToggleQueue = queuePaused || hasQueuedOrRunningJobs;
  const queueButtonTitle = queuePaused ? '开始任务' : hasQueuedOrRunningJobs ? '暂停任务' : '没有可开始的任务';

  const commitLimit = () => {
    const parsed = Number.parseInt(limitDraft, 10);
    if (!Number.isFinite(parsed)) {
      setLimitDraft(String(batchLimit));
      return;
    }
    const next = Math.max(1, Math.min(500, parsed));
    setLimitDraft(String(next));
    onBatchLimitChange?.(next);
  };

  return (
    <div className="theme-surface min-w-0 overflow-hidden rounded-xl border px-4 py-3">
      <div className={`flex min-w-0 gap-2 ${collapsed ? 'items-center' : 'items-start'}`}>
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-accent)] hover:text-[var(--accent)]"
          title={collapsed ? '展开 AI 任务中心' : '收起 AI 任务中心'}
          aria-label={collapsed ? '展开 AI 任务中心' : '收起 AI 任务中心'}
        >
          {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex min-h-8 min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="shrink-0 text-sm font-semibold leading-5 text-[var(--text-primary)]">AI 任务中心</h3>
            <span className="text-[11px] leading-5 text-[var(--text-muted)]">
              {totalActive > 0 ? `${jobs?.running ?? 0} 运行 / ${jobs?.queued ?? 0} 排队` : '队列空闲'}
            </span>
            {queuePaused && (
              <span className="rounded-full border border-[color-mix(in_srgb,var(--accent)_35%,var(--border-light))] bg-[var(--accent-bg)] px-2 py-0.5 text-[10px] text-[var(--accent)]">
                已暂停
              </span>
            )}
          </div>
          {!collapsed && batchProgress && (
            <p className="mt-1 truncate text-[11px] text-[var(--text-muted)]">
              本轮 {batchProgress.completed}/{batchProgress.total}，运行 {batchProgress.running}，排队 {batchProgress.queued}，失败 {batchProgress.failed}
            </p>
          )}
        </div>

        {!collapsed && (
          <div className="flex min-w-0 max-w-full flex-wrap justify-end gap-1 pl-1">
            <IconButton title={queueButtonTitle} onClick={canToggleQueue ? onToggleQueue : undefined} disabled={!canToggleQueue}>
              {queuePaused ? <Play size={14} /> : <Pause size={14} />}
            </IconButton>
            <IconButton title="刷新任务状态" onClick={onRefresh} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </IconButton>
            <IconButton title="清除已完成任务" onClick={onClearCompleted}>
              <CheckCircle2 size={14} />
            </IconButton>
            <IconButton title="同步排队任务设置" onClick={onSyncQueuedSettings}>
              <SearchCheck size={14} />
            </IconButton>
            <IconButton title="清除全部任务" onClick={onClearAll} danger>
              <Trash2 size={14} />
            </IconButton>
          </div>
        )}
      </div>

      {!collapsed && (
        <div className="mt-3 min-w-0 space-y-3">
          <div className="min-w-0 overflow-hidden rounded-lg border border-[var(--border-light)] bg-[var(--bg-elevated)] p-3">
            <div className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-[var(--text-primary)]">批处理{batchScopeLabel}</p>
                <p className="truncate text-[11px] text-[var(--text-muted)]">
                  {batchScopeLabel} {batchCount} 个视频，预计新增 {previewEnqueueCount} 个任务
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={onPreviewBatchFolder}
                  disabled={batchLoading}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-light)] px-2 text-[11px] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-45"
                >
                  <SearchCheck size={13} />
                  预览
                </button>
                <button
                  type="button"
                  onClick={onBatchFolder}
                  disabled={batchLoading}
                  className="inline-flex h-7 items-center gap-1 rounded-md bg-[var(--accent)] px-2 text-[11px] text-white hover:bg-[var(--accent-hover)] disabled:opacity-45"
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
                  className={`min-w-0 truncate rounded-md border px-2 py-1.5 text-left text-[11px] transition-colors ${
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

            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
              <label className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-[var(--border-light)] px-2 py-1.5 text-[11px] text-[var(--text-secondary)]">
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
              <label className="flex min-w-[145px] shrink-0 items-center justify-between gap-3 rounded-md border border-[var(--border-light)] px-2 py-1.5 text-[11px] text-[var(--text-secondary)]">
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
              <div className="mt-2 min-w-0 rounded-md border border-[var(--border-light)] bg-[var(--bg-card)] px-2 py-1.5 text-[11px] text-[var(--text-muted)]">
                可处理 {batchPreview.eligible}，本次入队 {batchPreview.enqueued || previewEnqueueCount}，跳过 {batchPreview.skipped}，已完成 {batchPreview.already_done}
                {batchPreview.limited ? '，已按上限截断' : ''}
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-wrap gap-1">
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter.value ?? 'all'}
                type="button"
                onClick={() => onStatusChange(filter.value)}
                className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                  selectedStatus === filter.value
                    ? 'border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--accent)]'
                    : 'border-[var(--border-light)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>

          <div className="min-w-0 space-y-2">
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
                          <span className="shrink-0 text-[10px] text-[var(--text-muted)]">{compactDate(job.updated_at)}</span>
                        </div>
                        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-[var(--text-muted)]">
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
                                  className={`rounded-full border px-1.5 py-0.5 text-[9px] leading-none ${
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
                          <p className="mt-1 truncate text-[11px] text-[var(--text-secondary)]" title={job.message}>
                            {message}
                          </p>
                        )}
                        {(job.error || job.summary_error) && (
                          <p className="mt-1 line-clamp-2 text-[11px] text-[var(--danger)]" title={job.error || job.summary_error || undefined}>
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
                        {['running', 'queued'].includes(job.status) && (
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
