import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { RefreshCw, X, PlayCircle } from 'lucide-react';
import { PageTitle } from '../shared';
import { CategoryTree, collectVideoIds } from './CategoryTree';
import { TranscriptionSettingsPanel } from './TranscriptionSettingsPanel';
import { BatchActionPanel } from './BatchActionPanel';
import {
  fetchCategoryTreeWithVideos,
  fetchAiJobs,
  fetchVideos,
  batchAiJobs,
  type AiJobBatchMode,
  fetchAiQueueState,
  pauseAiQueue,
  resumeAiQueue,
  cancelAiJob,
  resumeAiJob,
  syncQueuedAiJobSettings,
  saveTranscriptionSettings,
  fetchTranscriptionSettings,
  type TranscriptionSettingsDto,
  clearCompletedAiJobs,
  clearAllAiJobs,
  clearActiveAiJobs,
  clearFinishedAiJobs,
  type CategoryTreeWithVideos,
  type AiJobBatchOut,
  type AiJobListOut,
  type VideoItem,
} from '../../lib/videoApi';
import { transcriptionFormToDto, transcriptionDtoToForm } from '../settings/types';
import { useTranscriptionStore } from '../../stores';
import { VideoAiJobCenter } from '../video/VideoAiJobCenter';
import { useIsMobile } from '../../hooks/useMediaQuery';

export function TranscriberPage() {
  const isMobile = useIsMobile();
  const [mobileSection, setMobileSection] = useState<'tree' | 'settings' | 'jobs'>('tree');
  const [tree, setTree] = useState<CategoryTreeWithVideos[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchPreview, setBatchPreview] = useState<AiJobBatchOut | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);

  const [jobs, setJobs] = useState<AiJobListOut | null>(null);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [queuePaused, setQueuePaused] = useState(false);

  // Right-side advanced batch panel state
  const [rightBatchMode, setRightBatchMode] = useState<AiJobBatchMode>('unfinished');
  const [rightBatchLimit, setRightBatchLimit] = useState(999999);
  const [rightBatchCorrection, setRightBatchCorrection] = useState(false);

  // Selected videos display
  const [selectedVideos, setSelectedVideos] = useState<VideoItem[]>([]);
  const [videosLoading, setVideosLoading] = useState(false);

  // Global transcription settings
  const settings = useTranscriptionStore((s) => s);
  const updateSettings = useTranscriptionStore((s) => s.updateSettings);

  // On mount, fetch backend settings and merge into store
  useEffect(() => {
    let cancelled = false;
    fetchTranscriptionSettings()
      .then((dto) => {
        if (cancelled) return;
        const remote = transcriptionDtoToForm(dto);
        updateSettings(remote);
      })
      .catch(() => {
        // fallback to store values
      });
    return () => { cancelled = true; };
  }, [updateSettings]);

  // Debounce-save to backend when settings change from the panel
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSettingsChange = useCallback((updates: Partial<typeof settings>) => {
    updateSettings(updates);
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = setTimeout(() => {
      const current = useTranscriptionStore.getState();
      saveTranscriptionSettings(transcriptionFormToDto(current)).catch(() => {
        // silently fail
      });
    }, 800);
  }, [updateSettings]);

  const loadTree = useCallback(async () => {
    setTreeLoading(true);
    try {
      const data = await fetchCategoryTreeWithVideos();
      setTree(data);
    } catch {
      // ignore
    } finally {
      setTreeLoading(false);
    }
  }, []);

  const loadJobs = useCallback(async () => {
    setJobsLoading(true);
    try {
      const [data, queue] = await Promise.all([
        fetchAiJobs(999999, selectedStatus ?? undefined),
        fetchAiQueueState().catch(() => ({ paused: false })),
      ]);
      setJobs(data);
      setQueuePaused(Boolean(queue?.paused));
    } catch {
      // ignore
    } finally {
      setJobsLoading(false);
    }
  }, [selectedStatus]);

  const withJobsRefresh = useCallback(async (fn: () => Promise<unknown>) => {
    setJobsLoading(true);
    try {
      await fn();
      await loadJobs();
    } catch (err) {
      console.error('AI job action failed:', err);
      setBatchError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setJobsLoading(false);
    }
  }, [loadJobs]);

  const handleToggleQueue = useCallback(() => {
    void withJobsRefresh(async () => {
      if (queuePaused) await resumeAiQueue();
      else await pauseAiQueue();
    });
  }, [queuePaused, withJobsRefresh]);

  const handleCancelJob = useCallback((jobId: string) => {
    void withJobsRefresh(() => cancelAiJob(jobId));
  }, [withJobsRefresh]);

  const handleResumeJob = useCallback((jobId: string) => {
    void withJobsRefresh(() => resumeAiJob(jobId));
  }, [withJobsRefresh]);

  const handleSyncQueuedSettings = useCallback(() => {
    void withJobsRefresh(() => syncQueuedAiJobSettings());
  }, [withJobsRefresh]);

  const handleApplySettings = useCallback(() => {
    void withJobsRefresh(async () => {
      const dto: TranscriptionSettingsDto = {
        whisper_engine: settings.whisperEngine,
        whisper_model: settings.whisperModel,
        language: settings.language,
        do_summary: settings.doSummary,
        word_limit: settings.wordLimit,
        cpu_threads: settings.cpuThreads,
        compute_type: settings.computeType,
        beam_size: settings.beamSize,
        best_of: settings.bestOf,
        temperature: settings.temperature,
        vad_filter: settings.vadFilter,
        subtitle_correction_enabled: settings.subtitleCorrectionEnabled,
        subtitle_correction_scope: settings.subtitleCorrectionScope,
        subtitle_correction_prompt: settings.subtitleCorrectionPrompt,
        llm_usage_policy: settings.llmUsagePolicy,
        device_type: settings.deviceType,
      };
      await saveTranscriptionSettings(dto);
      await syncQueuedAiJobSettings();
    });
  }, [withJobsRefresh, settings]);

  const handleClearCompleted = useCallback(() => {
    void withJobsRefresh(() => clearCompletedAiJobs());
  }, [withJobsRefresh]);

  const handleClearAll = useCallback(() => {
    if (!window.confirm('确定清除全部 AI 任务记录吗？正在运行或排队的任务也会被移除。')) return;
    void withJobsRefresh(async () => {
      try {
        await clearAllAiJobs();
      } catch (err) {
        const message = err instanceof Error ? err.message : '';
        if (!message.includes('404')) throw err;
        await clearActiveAiJobs();
        await clearFinishedAiJobs();
      }
    });
  }, [withJobsRefresh]);

  // Load selected videos when selection changes
  const loadSelectedVideos = useCallback(async () => {
    if (selectedIds.size === 0) {
      setSelectedVideos([]);
      return;
    }
    setVideosLoading(true);
    try {
      const ids = Array.from(selectedIds);
      const page = await fetchVideos(1, 999999, undefined, undefined, ids);
      setSelectedVideos(page.items);
    } catch (err) {
      console.error('Failed to load selected videos:', err);
      setSelectedVideos([]);
    } finally {
      setVideosLoading(false);
    }
  }, [selectedIds]);

  useEffect(() => {
    const id = setTimeout(() => loadTree(), 0);
    return () => clearTimeout(id);
  }, [loadTree]);

  useEffect(() => {
    const id = setTimeout(() => loadJobs(), 0);
    const timer = setInterval(loadJobs, 5000);
    return () => { clearTimeout(id); clearInterval(timer); };
  }, [loadJobs]);

  useEffect(() => {
    const id = setTimeout(() => loadSelectedVideos(), 0);
    return () => clearTimeout(id);
  }, [loadSelectedVideos]);

  const selectedVideoIds = useMemo(() => {
    const fromTree = collectVideoIds(tree, selectedIds);
    if (fromTree.length > 0) return fromTree;
    return selectedVideos.map((v) => v.id);
  }, [tree, selectedIds, selectedVideos]);

  const handleToggle = useCallback((node: CategoryTreeWithVideos) => {
    setSelectedIds((prev) => {
      function getDescendantIds(n: CategoryTreeWithVideos): number[] {
        const ids: number[] = [n.id];
        for (const child of n.children as CategoryTreeWithVideos[]) {
          ids.push(...getDescendantIds(child));
        }
        return ids;
      }
      const ids = getDescendantIds(node);
      const allSelected = ids.every((id) => prev.has(id));
      const next = new Set(prev);
      for (const id of ids) {
        if (allSelected) {
          next.delete(id);
        } else {
          next.add(id);
        }
      }
      return next;
    });
  }, []);

  const handlePreview = useCallback(async () => {
    if (selectedVideoIds.length === 0) {
      setBatchError('请先在左侧勾选含视频的文件夹。');
      return;
    }
    setBatchLoading(true);
    setBatchError(null);
    try {
      const result = await batchAiJobs(selectedVideoIds, {
        mode: 'missing_subtitles',
        max_enqueue: 999999,
        dry_run: true,
        whisper_engine: settings.whisperEngine,
        whisper_model: settings.whisperModel,
        language: settings.language,
        do_summary: settings.doSummary,
        word_limit: settings.wordLimit,
        cpu_threads: settings.cpuThreads,
        compute_type: settings.computeType,
        beam_size: settings.beamSize,
        best_of: settings.bestOf,
        temperature: settings.temperature,
        vad_filter: settings.vadFilter,
        device_type: settings.deviceType,
        subtitle_correction_enabled: settings.subtitleCorrectionEnabled,
        subtitle_correction_scope: settings.subtitleCorrectionScope,
      });
      setBatchPreview(result);
    } catch (err) {
      console.error('Batch preview failed:', err);
      setBatchError(err instanceof Error ? err.message : '预览请求失败');
    } finally {
      setBatchLoading(false);
    }
  }, [selectedVideoIds, settings]);

  const handleEnqueue = useCallback(async () => {
    if (selectedVideoIds.length === 0) {
      setBatchError('请先在左侧勾选含视频的文件夹。');
      return;
    }
    setBatchLoading(true);
    setBatchError(null);
    try {
      const result = await batchAiJobs(selectedVideoIds, {
        mode: 'missing_subtitles',
        max_enqueue: 999999,
        dry_run: false,
        whisper_engine: settings.whisperEngine,
        whisper_model: settings.whisperModel,
        language: settings.language,
        do_summary: settings.doSummary,
        word_limit: settings.wordLimit,
        cpu_threads: settings.cpuThreads,
        compute_type: settings.computeType,
        beam_size: settings.beamSize,
        best_of: settings.bestOf,
        temperature: settings.temperature,
        vad_filter: settings.vadFilter,
        device_type: settings.deviceType,
        subtitle_correction_enabled: settings.subtitleCorrectionEnabled,
        subtitle_correction_scope: settings.subtitleCorrectionScope,
      });
      setBatchPreview(result);
      loadJobs();
    } catch (err) {
      console.error('Batch enqueue failed:', err);
      setBatchError(err instanceof Error ? err.message : '提交转写失败');
    } finally {
      setBatchLoading(false);
    }
  }, [selectedVideoIds, settings, loadJobs]);

  // Right-side advanced batch (mode + limit + correction)
  const runRightBatch = useCallback(async (dryRun: boolean) => {
    if (selectedVideoIds.length === 0) {
      setBatchError('请先在左侧勾选含视频的文件夹。');
      return;
    }
    setBatchLoading(true);
    setBatchError(null);
    try {
      const result = await batchAiJobs(selectedVideoIds, {
        mode: rightBatchMode,
        max_enqueue: rightBatchLimit,
        dry_run: dryRun,
        whisper_engine: settings.whisperEngine,
        whisper_model: rightBatchCorrection ? 'large-v3' : settings.whisperModel,
        language: settings.language,
        do_summary: settings.doSummary,
        word_limit: settings.wordLimit,
        cpu_threads: settings.cpuThreads,
        compute_type: settings.computeType,
        beam_size: settings.beamSize,
        best_of: settings.bestOf,
        temperature: settings.temperature,
        vad_filter: settings.vadFilter,
        device_type: settings.deviceType,
        subtitle_correction_enabled: rightBatchCorrection,
        subtitle_correction_scope: rightBatchCorrection ? 'full' : 'off',
      });
      setBatchPreview(result);
      if (!dryRun) loadJobs();
    } catch (err) {
      console.error('Right batch failed:', err);
      setBatchError(err instanceof Error ? err.message : '批处理请求失败');
    } finally {
      setBatchLoading(false);
    }
  }, [selectedVideoIds, settings, rightBatchMode, rightBatchLimit, rightBatchCorrection, loadJobs]);

  const handleRightPreview = useCallback(() => { void runRightBatch(true); }, [runRightBatch]);
  const handleRightEnqueue = useCallback(() => { void runRightBatch(false); }, [runRightBatch]);

  return (
    <div className="flex h-full flex-col">
      <PageTitle title="字幕转录王" subtitle="目录、转写设置与任务队列" />
      {isMobile && (
        <div className="transcriber-mobile-tabs" role="tablist" aria-label="字幕转录王移动端分区">
          <button
            type="button"
            role="tab"
            aria-selected={mobileSection === 'tree'}
            onClick={() => setMobileSection('tree')}
            className={`transcriber-mobile-tab ${mobileSection === 'tree' ? 'is-active' : ''}`}
          >
            目录
            {selectedIds.size > 0 && <span className="transcriber-mobile-badge">{selectedIds.size}</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobileSection === 'settings'}
            onClick={() => setMobileSection('settings')}
            className={`transcriber-mobile-tab ${mobileSection === 'settings' ? 'is-active' : ''}`}
          >
            设置
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobileSection === 'jobs'}
            onClick={() => setMobileSection('jobs')}
            className={`transcriber-mobile-tab ${mobileSection === 'jobs' ? 'is-active' : ''}`}
          >
            任务
            {(jobs?.running ?? 0) > 0 && <span className="transcriber-mobile-badge is-running">{jobs?.running}</span>}
          </button>
        </div>
      )}
      <div className={`flex min-h-0 flex-1 gap-3 p-3 ${isMobile ? 'transcriber-mobile-body flex-col' : ''}`}>
        {/* Left: Category Tree */}
        <div
          className={`theme-surface flex min-w-0 shrink-0 flex-col overflow-hidden rounded-xl border ${
            isMobile ? 'min-h-0 w-full flex-1' : 'w-64'
          }`}
          style={isMobile && mobileSection !== 'tree' ? { display: 'none' } : undefined}
        >
          <div className="flex items-center justify-between border-b border-[var(--border-light)] px-3 py-2">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">目录</h2>
            <button
              type="button"
              onClick={loadTree}
              disabled={treeLoading}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-accent)] hover:text-[var(--accent)] disabled:opacity-45"
              title="刷新目录"
            >
              <RefreshCw size={14} className={treeLoading ? 'animate-spin' : ''} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
            {treeLoading ? (
              <div className="px-3 py-4 text-center text-xs text-[var(--text-muted)]">加载中...</div>
            ) : (
              <CategoryTree nodes={tree} selectedIds={selectedIds} onToggle={handleToggle} />
            )}
          </div>
        </div>

        {/* Center: Settings + Batch Action */}
        <div
          className={`theme-surface flex min-w-0 flex-col gap-3 rounded-xl border p-4 ${
            isMobile ? 'min-h-0 w-full flex-1 overflow-y-auto' : 'flex-1 overflow-hidden'
          }`}
          style={isMobile && mobileSection !== 'settings' ? { display: 'none' } : undefined}
        >
          <TranscriptionSettingsPanel settings={settings} onChange={handleSettingsChange} />

          {/* Selected Videos */}
          <div className="border-t border-[var(--border-light)] pt-3 min-h-0 flex flex-col">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-medium text-[var(--text-primary)]">
                已选视频 <span className="text-[var(--accent)]">{selectedVideos.length}</span>
              </p>
              {selectedIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => { setSelectedIds(new Set()); }}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-accent)] hover:text-[var(--danger)]"
                >
                  <X size={12} />
                  清空
                </button>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-auto space-y-1 pr-1">
              {videosLoading ? (
                <div className="py-2 text-center text-xs text-[var(--text-muted)]">加载视频列表...</div>
              ) : selectedVideos.length === 0 ? (
                <div className="py-2 text-center text-xs text-[var(--text-muted)]">
                  {selectedIds.size === 0 ? '在左侧目录中勾选文件夹以选择视频' : '所选文件夹下暂无视频'}
                </div>
              ) : (
                selectedVideos.map((video) => (
                  <div
                    key={video.id}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-[var(--bg-elevated)]"
                    title={video.title}
                  >
                    <PlayCircle size={13} className="shrink-0 text-[var(--accent)]" />
                    <span className="min-w-0 flex-1 truncate text-[var(--text-primary)]">{video.title}</span>
                    <span className={`shrink-0 rounded px-1 py-0.5 text-xs ${
                      video.ai_status === 'completed' ? 'bg-green-500/10 text-green-600' :
                      video.ai_status === 'running' ? 'bg-blue-500/10 text-blue-600' :
                      video.ai_status === 'queued' ? 'bg-amber-500/10 text-amber-600' :
                      video.ai_status === 'failed' ? 'bg-red-500/10 text-red-600' :
                      'bg-gray-500/10 text-gray-500'
                    }`}>
                      {video.ai_status === 'completed' ? '已完成' :
                       video.ai_status === 'running' ? '运行中' :
                       video.ai_status === 'queued' ? '排队中' :
                       video.ai_status === 'failed' ? '失败' : '未处理'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="border-t border-[var(--border-light)] pt-3">
            <BatchActionPanel
              selectedVideoCount={selectedVideoIds.length}
              batchLoading={batchLoading}
              batchPreview={batchPreview}
              batchError={batchError}
              onPreview={handlePreview}
              onApplySettings={handleApplySettings}
              onEnqueue={handleEnqueue}
            />
          </div>
        </div>

        {/* Right: AI Job List */}
        <div
          className={`flex min-w-0 flex-col overflow-hidden ${
            isMobile ? 'min-h-0 w-full flex-1 overflow-y-auto' : 'w-[26rem] shrink-0'
          }`}
          style={isMobile && mobileSection !== 'jobs' ? { display: 'none' } : undefined}
        >
          <VideoAiJobCenter
            jobs={jobs}
            loading={jobsLoading}
            selectedStatus={selectedStatus}
            queuePaused={queuePaused}
            batchCount={selectedVideoIds.length}
            batchScope="descendants"
            batchLoading={batchLoading}
            batchMode={rightBatchMode}
            batchLimit={rightBatchLimit}
            batchCorrectionEnabled={rightBatchCorrection}
            batchPreview={batchPreview}
            onStatusChange={setSelectedStatus}
            onRefresh={loadJobs}
            onToggleQueue={handleToggleQueue}
            onCancelJob={handleCancelJob}
            onResumeJob={handleResumeJob}
            onSyncQueuedSettings={handleSyncQueuedSettings}
            onApplySettings={handleApplySettings}
            onClearCompleted={handleClearCompleted}
            onClearAll={handleClearAll}
            onBatchModeChange={setRightBatchMode}
            onBatchLimitChange={setRightBatchLimit}
            onBatchCorrectionChange={setRightBatchCorrection}
            onPreviewBatchFolder={handleRightPreview}
            onBatchFolder={handleRightEnqueue}
          />
        </div>
      </div>
    </div>
  );
}
