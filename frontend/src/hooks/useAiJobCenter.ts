import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranscriptionStore } from '../stores/transcriptionStore';
import { useVideoStore } from '../stores/videoStore';
import {
  batchAiJobs,
  cancelAiJob,
  clearActiveAiJobs,
  clearAllAiJobs,
  clearCompletedAiJobs,
  clearFinishedAiJobs,
  fetchAiJobs,
  fetchAiQueueState,
  pauseAiQueue,
  resumeAiJob,
  resumeAiQueue,
  syncQueuedAiJobSettings,
  type AiJobBatchMode,
  type AiJobBatchOut,
  type AiJobListOut,
} from '../lib/videoApi';
import { playInteractionSound } from '../lib/sounds';
import { getJobPollDelay, shouldReconcileJobs } from '../lib/jobPolling';

interface AiJobCenterProps {
  jobs: AiJobListOut | null;
  loading: boolean;
  selectedStatus: string | null;
  batchCount: number;
  batchScope: 'leaf' | 'descendants';
  batchLoading: boolean;
  batchProgress: { completed: number; running: number; queued: number; failed: number; total: number };
  batchMode: AiJobBatchMode;
  batchLimit: number;
  batchCorrectionEnabled: boolean;
  batchPreview: AiJobBatchOut | null;
  queuePaused: boolean;
  queueStuck: boolean;
  onStatusChange: (status: string | null) => void;
  onBatchModeChange: (mode: AiJobBatchMode) => void;
  onBatchLimitChange: (limit: number) => void;
  onBatchCorrectionChange: (enabled: boolean) => void;
  onPreviewBatchFolder: () => void;
  onBatchFolder: () => void;
  onToggleQueue: () => void;
  onCancelJob: (jobId: string) => void;
  onResumeJob: (jobId: string) => void;
  onSyncQueuedSettings: () => void;
  onClearCompleted: () => void;
  onClearAll: () => void;
  onRefresh: () => void;
  triggerSingleVideo: (videoId: number) => void;
  triggerCorrection: (videoId: number) => void;
}

export function useAiJobCenter(
  playlist: { id: number }[],
  playlistScope: 'leaf' | 'descendants',
  currentVideoId: number | null,
  loadCurrentVideo: (id: number) => Promise<void>,
): AiJobCenterProps {
  const triggerAi = useVideoStore((s) => s.triggerAi);
  const loadVideos = useVideoStore((s) => s.loadVideos);

  // Transcription settings
  const whisperEngine = useTranscriptionStore((s) => s.whisperEngine);
  const whisperModel = useTranscriptionStore((s) => s.whisperModel);
  const language = useTranscriptionStore((s) => s.language);
  const doSummary = useTranscriptionStore((s) => s.doSummary);
  const wordLimit = useTranscriptionStore((s) => s.wordLimit);
  const cpuThreads = useTranscriptionStore((s) => s.cpuThreads);
  const computeType = useTranscriptionStore((s) => s.computeType);
  const beamSize = useTranscriptionStore((s) => s.beamSize);
  const bestOf = useTranscriptionStore((s) => s.bestOf);
  const temperature = useTranscriptionStore((s) => s.temperature);
  const vadFilter = useTranscriptionStore((s) => s.vadFilter);
  const subtitleCorrectionPrompt = useTranscriptionStore((s) => s.subtitleCorrectionPrompt);

  // Local state
  const [aiJobs, setAiJobs] = useState<AiJobListOut | null>(null);
  const [aiJobsLoading, setAiJobsLoading] = useState(false);
  const [aiJobStatusFilter, setAiJobStatusFilter] = useState<string | null>(null);
  const [queuePaused, setQueuePaused] = useState(false);
  const [batchingFolder, setBatchingFolder] = useState(false);
  const [batchMode, setBatchMode] = useState<AiJobBatchMode>('unfinished');
  const [batchLimit, setBatchLimit] = useState(20);
  const [batchCorrectionEnabled, setBatchCorrectionEnabled] = useState(false);
  const [batchPreview, setBatchPreview] = useState<AiJobBatchOut | null>(null);

  // Track current filter to avoid stale closure
  const statusFilterRef = useRef(aiJobStatusFilter);
  useEffect(() => {
    statusFilterRef.current = aiJobStatusFilter;
  }, [aiJobStatusFilter]);
  const jobsRequestRef = useRef(false);
  const lastReconcileAtRef = useRef(Date.now());
  const lastVideoRefreshRef = useRef(Date.now());

  // Build base options from transcription settings
  const baseOptions = useMemo(() => ({
    whisper_engine: whisperEngine,
    whisper_model: whisperModel,
    language,
    do_summary: doSummary,
    word_limit: wordLimit,
    cpu_threads: whisperEngine === 'whisper.cpp' ? undefined : cpuThreads,
    compute_type: computeType,
    beam_size: beamSize,
    best_of: bestOf,
    temperature,
    vad_filter: vadFilter,
    subtitle_correction_prompt: subtitleCorrectionPrompt,
  }), [whisperEngine, whisperModel, language, doSummary, wordLimit, cpuThreads, computeType, beamSize, bestOf, temperature, vadFilter, subtitleCorrectionPrompt]);

  // Single video manual trigger (no correction)
  const manualAiJobOptions = useMemo(() => ({
    ...baseOptions,
    subtitle_correction_enabled: false,
    subtitle_correction_scope: 'off' as const,
  }), [baseOptions]);

  // Batch options (correction toggled by batch setting)
  const batchAiJobOptions = useMemo(() => ({
    ...baseOptions,
    whisper_model: batchCorrectionEnabled ? 'large-v3' : baseOptions.whisper_model,
    subtitle_correction_enabled: batchCorrectionEnabled,
    subtitle_correction_scope: batchCorrectionEnabled ? 'full' as const : 'off' as const,
  }), [baseOptions, batchCorrectionEnabled]);

  // Correction-only options
  const correctionAiJobOptions = useMemo(() => ({
    ...baseOptions,
    whisper_model: 'large-v3',
    subtitle_correction_enabled: true,
    subtitle_correction_scope: 'full' as const,
  }), [baseOptions]);

  // Wrapper to manage loading state
  const withLoading = useCallback(async (fn: () => Promise<void>) => {
    setAiJobsLoading(true);
    try {
      await fn();
    } finally {
      setAiJobsLoading(false);
    }
  }, []);

  // Core: load job list + queue state
  const loadAiJobs = useCallback(async (options: { silent?: boolean; reconcile?: boolean } = {}) => {
    if (options.silent && jobsRequestRef.current) return;
    jobsRequestRef.current = true;
    const reconcile = options.reconcile ?? true;
    if (reconcile) lastReconcileAtRef.current = Date.now();
    try {
      const [jobs, queue] = await Promise.all([
        fetchAiJobs(12, statusFilterRef.current ?? undefined, { reconcile }),
        fetchAiQueueState(),
      ]);
      setAiJobs(jobs);
      setQueuePaused(queue.paused);
    } catch {
      // diagnostic UI, don't break the app
    } finally {
      jobsRequestRef.current = false;
    }
  }, []);

  // Batch progress calculation
  const batchProgress = useMemo(() => {
    const ids = new Set(playlist.map((item) => item.id));
    const folderJobs = (aiJobs?.items ?? []).filter((job) => ids.has(job.video_id));
    const latestByVideo = new Map<number, (typeof folderJobs)[number]>();
    for (const job of folderJobs) {
      if (!latestByVideo.has(job.video_id)) latestByVideo.set(job.video_id, job);
    }
    const values = [...latestByVideo.values()];
    return {
      total: playlist.length,
      completed: values.filter((j) => j.status === 'completed').length,
      running: values.filter((j) => j.status === 'running').length,
      queued: values.filter((j) => j.status === 'queued').length,
      failed: values.filter((j) => j.status === 'failed').length,
    };
  }, [aiJobs?.items, playlist]);

  // ── Callbacks ──

  const refreshAiJobs = useCallback(async () => {
    await withLoading(async () => {
      if (playlist.length > 0) {
        const preview = await batchAiJobs(
          playlist.map((item) => item.id),
          { ...batchAiJobOptions, mode: batchMode, max_enqueue: batchLimit, dry_run: true },
        );
        setBatchPreview(preview);
      } else {
        setBatchPreview(null);
      }
      await loadAiJobs();
      if (currentVideoId) {
        await loadCurrentVideo(currentVideoId);
      }
    });
  }, [withLoading, playlist, batchAiJobOptions, batchMode, batchLimit, loadAiJobs, currentVideoId, loadCurrentVideo]);

  const previewBatchCurrentFolder = useCallback(async () => {
    if (!playlist.length || batchingFolder) return;
    setBatchingFolder(true);
    try {
      const result = await batchAiJobs(
        playlist.map((item) => item.id),
        { ...batchAiJobOptions, mode: batchMode, max_enqueue: batchLimit, dry_run: true },
      );
      setBatchPreview(result);
      await loadAiJobs();
      playInteractionSound('tap');
    } finally {
      setBatchingFolder(false);
    }
  }, [playlist, batchingFolder, batchAiJobOptions, batchMode, batchLimit, loadAiJobs]);

  const batchCurrentFolder = useCallback(async () => {
    if (!playlist.length || batchingFolder) return;
    setBatchingFolder(true);
    try {
      const preview = batchPreview ?? await batchAiJobs(
        playlist.map((item) => item.id),
        { ...batchAiJobOptions, mode: batchMode, max_enqueue: batchLimit, dry_run: true },
      );
      if (preview.eligible <= 0) {
        setBatchPreview(preview);
        await loadAiJobs();
        playInteractionSound('tap');
        return;
      }
      const result = await batchAiJobs(
        playlist.map((item) => item.id),
        { ...batchAiJobOptions, mode: batchMode, max_enqueue: batchLimit, dry_run: false },
      );
      setBatchPreview(result);
      if (currentVideoId) {
        await loadCurrentVideo(currentVideoId);
      }
      await loadAiJobs();
      await loadVideos();
      playInteractionSound('start');
    } finally {
      setBatchingFolder(false);
    }
  }, [playlist, batchingFolder, batchPreview, batchAiJobOptions, batchMode, batchLimit, loadAiJobs, currentVideoId, loadCurrentVideo, loadVideos]);

  const changeBatchMode = useCallback((mode: AiJobBatchMode) => {
    setBatchMode(mode);
    setBatchPreview(null);
  }, []);

  const changeBatchLimit = useCallback((limit: number) => {
    if (!Number.isFinite(limit)) return;
    setBatchLimit(Math.max(1, Math.min(500, Math.trunc(limit))));
    setBatchPreview(null);
  }, []);

  const changeBatchCorrection = useCallback((enabled: boolean) => {
    setBatchCorrectionEnabled(enabled);
    setBatchPreview(null);
  }, []);

  const queueStuck = useMemo(() => {
    return !queuePaused && (aiJobs?.queued ?? 0) > 0 && (aiJobs?.running ?? 0) === 0;
  }, [queuePaused, aiJobs?.queued, aiJobs?.running]);

  const toggleQueue = useCallback(async () => {
    const hasQueuedOrRunningJobs = (aiJobs?.queued ?? 0) + (aiJobs?.running ?? 0) > 0;
    const isStuck = !queuePaused && (aiJobs?.queued ?? 0) > 0 && (aiJobs?.running ?? 0) === 0;
    if (!queuePaused && !hasQueuedOrRunningJobs && !isStuck) return;
    await withLoading(async () => {
      const shouldResume = queuePaused || isStuck;
      const result = shouldResume ? await resumeAiQueue() : await pauseAiQueue();
      setQueuePaused(result.paused);
      await loadAiJobs();
      if (currentVideoId) {
        await loadCurrentVideo(currentVideoId);
      }
      playInteractionSound('tap');
    });
  }, [aiJobs?.queued, aiJobs?.running, queuePaused, withLoading, loadAiJobs, currentVideoId, loadCurrentVideo]);

  const cancelJob = useCallback(async (jobId: string) => {
    await withLoading(async () => {
      await cancelAiJob(jobId);
      await loadAiJobs();
      if (currentVideoId) {
        await loadCurrentVideo(currentVideoId);
      }
      playInteractionSound('delete');
    });
  }, [withLoading, loadAiJobs, currentVideoId, loadCurrentVideo]);

  const resumeJob = useCallback(async (jobId: string) => {
    await withLoading(async () => {
      await resumeAiJob(jobId);
      await loadAiJobs();
      if (currentVideoId) {
        await loadCurrentVideo(currentVideoId);
      }
      playInteractionSound('start');
    });
  }, [withLoading, loadAiJobs, currentVideoId, loadCurrentVideo]);

  const syncQueuedSettings = useCallback(async () => {
    await withLoading(async () => {
      await syncQueuedAiJobSettings();
      setBatchPreview(null);
      await loadAiJobs();
      playInteractionSound('save');
    });
  }, [withLoading, loadAiJobs]);

  const clearCompletedJobs = useCallback(async () => {
    await withLoading(async () => {
      await clearCompletedAiJobs();
      setBatchPreview(null);
      await loadAiJobs();
      if (currentVideoId) {
        await loadCurrentVideo(currentVideoId);
      }
      playInteractionSound('delete');
    });
  }, [withLoading, loadAiJobs, currentVideoId, loadCurrentVideo]);

  const clearAllJobs = useCallback(async () => {
    if (!window.confirm('确定清除全部 AI 任务记录吗？正在运行或排队的任务也会被移除。')) return;
    await withLoading(async () => {
      try {
        await clearAllAiJobs();
      } catch (err) {
        const message = err instanceof Error ? err.message : '';
        if (!message.includes('404')) throw err;
        await clearActiveAiJobs();
        await clearFinishedAiJobs();
      }
      if (playlist.length > 0) {
        const preview = await batchAiJobs(
          playlist.map((item) => item.id),
          { ...batchAiJobOptions, mode: batchMode, max_enqueue: batchLimit, dry_run: true },
        );
        setBatchPreview(preview);
      } else {
        setBatchPreview(null);
      }
      await loadAiJobs();
      if (currentVideoId) {
        await loadCurrentVideo(currentVideoId);
      }
      playInteractionSound('delete');
    });
  }, [withLoading, playlist, batchAiJobOptions, batchMode, batchLimit, loadAiJobs, currentVideoId, loadCurrentVideo]);

  // ── Effects ──

  // Initial load
  useEffect(() => {
    queueMicrotask(() => {
      void loadAiJobs();
    });
  }, [loadAiJobs]);

  // Auto-poll: active jobs keep the list fresh; an idle queue only needs
  // a slow heartbeat. The current video detail is heavier, so refresh it
  // at most every 30s and only while a job is actually running.
  useEffect(() => {
    const hasActiveAiJobs = (aiJobs?.running ?? 0) + (aiJobs?.queued ?? 0) > 0;
    let timer: number | null = null;
    let disposed = false;

    const clearTimer = () => {
      if (timer) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const schedule = () => {
      clearTimer();
      if (disposed) return;
      timer = window.setTimeout(tick, getJobPollDelay(hasActiveAiJobs, document.visibilityState));
    };

    const tick = () => {
      if (disposed) return;
      const reconcile = shouldReconcileJobs(lastReconcileAtRef.current);
      void loadAiJobs({ silent: true, reconcile });
      const videoDetailDue = Date.now() - lastVideoRefreshRef.current >= 30_000;
      if (hasActiveAiJobs && currentVideoId && document.visibilityState === 'visible' && videoDetailDue) {
        lastVideoRefreshRef.current = Date.now();
        void loadCurrentVideo(currentVideoId);
      }
      schedule();
    };

    const handleVisibilityChange = () => schedule();

    schedule();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      disposed = true;
      clearTimer();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [aiJobs?.queued, aiJobs?.running, currentVideoId, loadAiJobs, loadCurrentVideo]);

  // Status chips are filters, so the visible list should update immediately when they change.
  useEffect(() => {
    void loadAiJobs();
  }, [aiJobStatusFilter, loadAiJobs]);

  // Trigger AI for a single video (used by VideoPlaylistPanel)
  const triggerSingleVideo = useCallback((videoId: number) => {
    void triggerAi(videoId, manualAiJobOptions).then(() => {
      playInteractionSound('start');
      void loadAiJobs();
    }).catch(() => {
      playInteractionSound('error');
    });
  }, [triggerAi, manualAiJobOptions, loadAiJobs]);

  const triggerCorrection = useCallback((videoId: number) => {
    void triggerAi(videoId, correctionAiJobOptions).then(() => {
      playInteractionSound('start');
      void loadAiJobs();
    }).catch(() => {
      playInteractionSound('error');
    });
  }, [triggerAi, correctionAiJobOptions, loadAiJobs]);

  return {
    jobs: aiJobs,
    loading: aiJobsLoading,
    selectedStatus: aiJobStatusFilter,
    batchCount: playlist.length,
    batchScope: playlistScope,
    batchLoading: batchingFolder,
    batchProgress,
    batchMode,
    batchLimit,
    batchCorrectionEnabled,
    batchPreview,
    queuePaused,
    queueStuck,
    onStatusChange: setAiJobStatusFilter,
    onBatchModeChange: changeBatchMode,
    onBatchLimitChange: changeBatchLimit,
    onBatchCorrectionChange: changeBatchCorrection,
    onPreviewBatchFolder: () => void previewBatchCurrentFolder(),
    onBatchFolder: () => void batchCurrentFolder(),
    onToggleQueue: () => void toggleQueue(),
    onCancelJob: (jobId) => void cancelJob(jobId),
    onResumeJob: (jobId) => void resumeJob(jobId),
    onSyncQueuedSettings: () => void syncQueuedSettings(),
    onClearCompleted: () => void clearCompletedJobs(),
    onClearAll: () => void clearAllJobs(),
    onRefresh: () => void refreshAiJobs(),
    // Extra: for VideoPlaylistPanel to use
    triggerSingleVideo,
    triggerCorrection,
  };
}
