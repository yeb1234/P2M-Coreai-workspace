import React, { useState, useEffect } from 'react';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { useTranscriptionStore, WHISPER_MODELS, DEFAULT_TRANSCRIPTION_SETTINGS, DEFAULT_SUBTITLE_CORRECTION_PROMPT } from '../../stores';
import { clearActiveAiJobs, downloadWhisperModel, fetchBackendHealth, fetchDownloadStatus, fetchTranscriptionSettings, fetchWhisperModels, saveTranscriptionSettings, type WhisperModelsOut } from '../../lib/videoApi';
import type { TranscriptionDraft, NumberDrafts } from './types';
import { transcriptionFormToDto, transcriptionDtoToForm, TRANSCRIPTION_PARAM_HELP } from './types';
import { playInteractionSound } from '../../lib/sounds';

export function TranscriptionSettings() {
  const settings = useTranscriptionStore();
  const updateSettings = useTranscriptionStore((s) => s.updateSettings);
  const [saved, setSaved] = useState(false);
  const [clearingJobs, setClearingJobs] = useState(false);
  const [clearMsg, setClearMsg] = useState('');
  const [fieldHint, setFieldHint] = useState('');
  const [whisperModels, setWhisperModels] = useState<WhisperModelsOut | null>(null);
  const [modelsError, setModelsError] = useState('');
  interface DownloadState {
    status: string;
    error?: string;
  }
  const [downloadStates, setDownloadStates] = useState<Record<string, DownloadState>>({});

  const hasActiveDownload = Object.values(downloadStates).some(
    (s) => s.status === 'started' || s.status === 'running'
  );

  useEffect(() => {
    if (!hasActiveDownload) return;
    const timer = setInterval(() => {
      const modelIds = (whisperModels?.items ?? [])
        .filter((i) => i.auto_downloadable)
        .map((i) => i.id);
      if (modelIds.length === 0) return;
      void Promise.allSettled(modelIds.map((id) => fetchDownloadStatus(id)))
        .then((results) => {
          const next: Record<string, DownloadState> = {};
          let hasCompleted = false;
          results.forEach((res, idx) => {
            if (res.status === 'fulfilled') {
              const val = res.value;
              next[modelIds[idx]] = { status: val.status, error: val.error };
              if (val.status === 'completed') hasCompleted = true;
            }
          });
          setDownloadStates((prev) => ({ ...prev, ...next }));
          if (hasCompleted) {
            void fetchWhisperModels().then((m) => setWhisperModels(m));
          }
        });
    }, 3000);
    return () => clearInterval(timer);
  }, [hasActiveDownload, whisperModels]);

  const [savingSettings, setSavingSettings] = useState(false);
  const [form, setForm] = useState<TranscriptionDraft>({
    whisperEngine: settings.whisperEngine,
    whisperModel: settings.whisperModel,
    language: settings.language,
    doSummary: settings.doSummary,
    wordLimit: settings.wordLimit,
    cpuThreads: settings.cpuThreads,
    computeType: settings.computeType,
    beamSize: settings.beamSize,
    bestOf: settings.bestOf,
    temperature: settings.temperature,
    vadFilter: settings.vadFilter,
    subtitleCorrectionEnabled: settings.subtitleCorrectionEnabled,
    subtitleCorrectionScope: settings.subtitleCorrectionScope,
    subtitleCorrectionPrompt: settings.subtitleCorrectionPrompt,
    llmUsagePolicy: settings.llmUsagePolicy,
    deviceType: settings.deviceType,
  });
  const [drafts, setDrafts] = useState<NumberDrafts>({
    wordLimit: String(settings.wordLimit),
    cpuThreads: String(settings.cpuThreads),
    beamSize: String(settings.beamSize),
    bestOf: String(settings.bestOf),
    temperature: String(settings.temperature),
  });
  const [envChecks, setEnvChecks] = useState<Array<{ name: string; ok: boolean; message: string }> | null>(null);
  const [envLoading, setEnvLoading] = useState(false);

  const updateForm = (updates: Partial<TranscriptionDraft>) => {
    setForm((current) => ({ ...current, ...updates }));
    setFieldHint('有未保存的转写设置。');
  };

  const saveForm = async () => {
    const next = { ...form };
    setSavingSettings(true);
    try {
      const savedSettings = await saveTranscriptionSettings(transcriptionFormToDto(next));
      const normalized = transcriptionDtoToForm(savedSettings);
      updateSettings(normalized);
      setForm(normalized);
      syncNumberDrafts(normalized);
      setSaved(true);
      playInteractionSound('save');
      setFieldHint('转写设置已保存到本机数据库，后续新任务会使用这些参数。');
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      updateSettings(next);
      playInteractionSound('error');
      setFieldHint(err instanceof Error ? `后端保存失败，已保存到浏览器：${err.message}` : '后端保存失败，已保存到浏览器。');
    } finally {
      setSavingSettings(false);
    }
  };

  const syncNumberDrafts = (updates: Partial<TranscriptionDraft>) => {
    setDrafts((current) => ({
      ...current,
      ...(updates.wordLimit !== undefined ? { wordLimit: String(updates.wordLimit) } : {}),
      ...(updates.cpuThreads !== undefined ? { cpuThreads: String(updates.cpuThreads) } : {}),
      ...(updates.beamSize !== undefined ? { beamSize: String(updates.beamSize) } : {}),
      ...(updates.bestOf !== undefined ? { bestOf: String(updates.bestOf) } : {}),
      ...(updates.temperature !== undefined ? { temperature: String(updates.temperature) } : {}),
    }));
  };

  const applyPreset = (updates: Partial<TranscriptionDraft>, hint: string) => {
    updateForm(updates);
    syncNumberDrafts(updates);
    setFieldHint(hint);
  };

  const isWhisperCppEngine = form.whisperEngine === 'whisper.cpp';
  const threadLabel = 'CPU 转写线程';
  const threadHint = '只在 faster-whisper CPU 模式生效，用于限制 CTranslate2/OpenMP/BLAS 线程；whisper.cpp 转写不会读取这个值。字幕校对走 LM Studio/OpenAI 兼容接口。';
  const installedWhisperModels = new Set((whisperModels?.items ?? []).filter((item) => item.installed).map((item) => item.id));
  const autoDownloadableModels = new Set((whisperModels?.items ?? []).filter((item) => item.auto_downloadable).map((item) => item.id));
  const hasWhisperModelScan = Boolean(whisperModels);

  const loadWhisperModels = async () => fetchWhisperModels();

  useEffect(() => {
    const id = setTimeout(() => setModelsError(''), 0);
    void loadWhisperModels()
      .then((models) => {
        setWhisperModels(models);
        if (models) {
          const autoDlIds = models.items.filter((i) => i.auto_downloadable).map((i) => i.id);
          void Promise.allSettled(autoDlIds.map((id) => fetchDownloadStatus(id)))
            .then((results) => {
              const next: Record<string, DownloadState> = {};
              results.forEach((res, idx) => {
                if (res.status === 'fulfilled') {
                  const val = res.value;
                  next[autoDlIds[idx]] = { status: val.status, error: val.error };
                }
              });
              setDownloadStates((prev) => ({ ...prev, ...next }));
            });
        }
      })
      .catch((err) => setModelsError(err instanceof Error ? err.message : '模型扫描失败'));
    void fetchTranscriptionSettings()
      .then((dto) => {
        const remote = transcriptionDtoToForm(dto);
        updateSettings(remote);
        setForm(remote);
        syncNumberDrafts(remote);
      })
      .catch(() => {
        // Browser IndexedDB settings remain the fallback when the backend is unavailable.
      });
    return () => clearTimeout(id);
  }, [updateSettings]);

  const setNumberDraft = (key: keyof NumberDrafts, value: string) => {
    setDrafts((current) => ({ ...current, [key]: value }));
  };

  const commitNumber = (
    key: keyof NumberDrafts,
    storeKey: keyof Pick<TranscriptionDraft, 'wordLimit' | 'cpuThreads' | 'beamSize' | 'bestOf' | 'temperature'>,
    min: number,
    max: number,
    label: string,
    integer = true
  ) => {
    const raw = drafts[key].trim();
    const parsed = Number(raw);
    if (!raw || !Number.isFinite(parsed)) {
      setDrafts((current) => ({ ...current, [key]: String(form[storeKey]) }));
      setFieldHint(`${label} 需要输入数字，已恢复为当前值。`);
      return;
    }
    const clamped = Math.max(min, Math.min(max, integer ? Math.round(parsed) : parsed));
    updateForm({ [storeKey]: clamped });
    setDrafts((current) => ({ ...current, [key]: String(clamped) }));
    setFieldHint(clamped !== parsed ? `${label} 范围是 ${min}-${max}，已自动修正为 ${clamped}，保存后生效。` : '有未保存的转写设置。');
  };

  const handleNumberKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.currentTarget.blur();
    }
  };

  const clearJobs = async () => {
    setClearingJobs(true);
    setClearMsg('');
    try {
      const result = await clearActiveAiJobs();
      playInteractionSound('delete');
      setClearMsg(`已清理 ${result.cleared} 个任务`);
    } catch (err) {
      playInteractionSound('error');
      setClearMsg(err instanceof Error ? err.message : '清理失败');
    } finally {
      setClearingJobs(false);
    }
  };

  const detectEnvironment = async () => {
    setEnvLoading(true);
    try {
      const health = await fetchBackendHealth();
      const relevant = health.checks.filter((c) =>
        ['ffmpeg', 'whisper.cpp 可执行文件', 'whisper.cpp 模型', 'LM Studio / OpenAI 兼容接口', 'Ollama', '转写默认配置'].includes(c.name)
      );
      setEnvChecks(relevant);
      playInteractionSound(health.ok ? 'success' : 'error');
    } catch (err) {
      playInteractionSound('error');
      setEnvChecks([{ name: '检测失败', ok: false, message: err instanceof Error ? err.message : '未知错误' }]);
    } finally {
      setEnvLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[var(--border-light)] bg-[var(--bg-elevated)] p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">模式预设</p>
            <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">先选预设，再按需微调参数，最后点保存转写设置。</p>
          </div>
        </div>
        <div className="auto-grid-panels">
          <button
            onClick={() => applyPreset(
              {
                whisperEngine: 'faster-whisper',
                whisperModel: 'large-v3',
                cpuThreads: 20,
                computeType: 'int8_float16',
                beamSize: 3,
                bestOf: 1,
                temperature: 0,
                vadFilter: true,
                subtitleCorrectionEnabled: false,
                subtitleCorrectionScope: 'off',
              },
              'Faster-Whisper路线：large-v3 / int8_float16 / 20 线程 / beam 3 / 关闭字幕校对。'
            )}
            className={`rounded-lg border px-3 py-2 text-left transition-colors ${
              form.whisperEngine === 'faster-whisper'
                ? 'border-[var(--accent)] bg-[var(--warn-bg)] text-[var(--accent-hover)]'
                : 'border-[var(--border-light)] bg-white text-[var(--text-primary)] hover:border-[var(--accent)]/50'
            }`}
          >
            <p className="text-sm font-medium">Faster-Whisper路线</p>
            <p className={`mt-1 text-[11px] leading-4 ${form.whisperEngine === 'faster-whisper' ? 'text-[var(--accent-hover)]/70' : 'text-[var(--text-secondary)]'}`}>CPU/CUDA路线，参数保守，适合后台慢慢跑。</p>
          </button>
          <button
            onClick={() => {
              applyPreset(
                {
                  whisperModel: 'large-v3',
                  whisperEngine: 'whisper.cpp',
                  computeType: 'int8',
                  beamSize: 5,
                  bestOf: 5,
                  temperature: 0,
                  vadFilter: true,
                  subtitleCorrectionEnabled: false,
                  subtitleCorrectionScope: 'full',
                },
                `Whisper.cpp路线：whisper.cpp + large-v3。转写走 whisper.cpp 外部/GPU 引擎，不使用 CPU 转写线程设置。字幕校对只在单独点击校对或批处理开关开启时运行。`
              );
            }}
            className={`rounded-lg border px-3 py-2 text-left transition-colors ${
              form.whisperEngine === 'whisper.cpp'
                ? 'border-[var(--accent)] bg-[var(--warn-bg)] text-[var(--accent-hover)]'
                : 'border-[var(--border-light)] bg-white text-[var(--text-primary)] hover:border-[var(--accent)]/50'
            }`}
          >
            <p className="text-sm font-medium">Whisper.cpp路线</p>
            <p className={`mt-1 text-[11px] leading-4 ${form.whisperEngine === 'whisper.cpp' ? 'text-[var(--accent-hover)]/70' : 'text-[var(--text-secondary)]'}`}>whisper.cpp 外部引擎，适合 GPU 转写。</p>
          </button>
          <button
            onClick={() => {
              setForm(DEFAULT_TRANSCRIPTION_SETTINGS);
              syncNumberDrafts(DEFAULT_TRANSCRIPTION_SETTINGS);
              setFieldHint('已恢复默认草稿：whisper.cpp + large-v3，保存后生效。');
            }}
            className="rounded-lg border border-[var(--border-light)] bg-white px-3 py-2 text-left transition-colors hover:border-[#1a1a1a]/30 hover:bg-[var(--bg-base)]"
          >
            <p className="text-sm font-medium text-[var(--text-primary)]">恢复默认</p>
            <p className="mt-1 text-[11px] leading-4 text-[var(--text-secondary)]">回到系统默认参数，不会立刻保存。</p>
          </button>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">转写引擎</label>
        <select
          value={form.whisperEngine}
          onChange={(e) => updateForm({ whisperEngine: e.target.value })}
          className="w-full px-3 py-2 bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-lg text-sm"
        >
          <option value="faster-whisper">faster-whisper CPU（稳定默认）</option>
          <option value="whisper.cpp">whisper.cpp 外部引擎（可接 Vulkan/HIP）</option>
        </select>
        <p className="text-[10px] text-[var(--text-muted)] mt-1">7800 XT 路线建议先用 whisper.cpp 的 Vulkan/HIP 版本单独验证，再在后端 .env 配置可执行文件和模型路径。</p>
      </div>

      <div>
        <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">运行设备</label>
        <div className="flex gap-2">
          {(['auto', 'cuda', 'cpu'] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => updateForm({ deviceType: d })}
              className={`flex-1 rounded-md border px-2 py-1.5 text-[11px] transition-colors ${
                form.deviceType === d
                  ? 'border-[var(--accent)] bg-[var(--warn-bg)] text-[var(--accent-hover)]'
                  : 'border-[var(--border-light)] text-[var(--text-secondary)] hover:border-[var(--accent)]/50'
              }`}
            >
              {d === 'auto' ? '自动' : d === 'cuda' ? 'CUDA' : 'CPU'}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-[var(--text-muted)] mt-1">只对 faster-whisper 生效。whisper.cpp 外部引擎的设备选择取决于 whisper-cli.exe 的编译参数和 .env 配置。</p>
      </div>

      <div>
        <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Whisper 模型</label>
        <select
          value={form.whisperModel}
          onChange={(e) => updateForm({ whisperModel: e.target.value })}
          className="w-full px-3 py-2 bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-lg text-sm"
        >
          {WHISPER_MODELS.map((model) => {
            const installed = !hasWhisperModelScan || installedWhisperModels.has(model.id);
            const autoDl = autoDownloadableModels.has(model.id);
            const isFasterWhisper = form.whisperEngine === 'faster-whisper';
            const canSelect = installed || (isFasterWhisper && autoDl);
            const dlState = downloadStates[model.id];
            let suffix = installed ? model.desc : `未安装`;
            if (dlState) {
              if (dlState.status === 'started' || dlState.status === 'running') {
                suffix = '下载中...';
              } else if (dlState.status === 'failed') {
                suffix = '下载失败';
              } else if (dlState.status === 'completed') {
                suffix = '下载完成';
              }
            }
            return (
              <option key={model.id} value={model.id} disabled={!canSelect}>
                {model.name} - {suffix}
              </option>
            );
          })}
        </select>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-[var(--text-muted)]">
          <span>常用推荐：`medium` 或 `large-v3`。越大越准，越慢，越吃内存。</span>
          {whisperModels && <span>模型目录：{whisperModels.model_dir}</span>}
          {modelsError && <span className="text-[var(--danger)]">{modelsError}</span>}
          <button type="button" onClick={() => void loadWhisperModels()} className="text-[var(--accent)] hover:underline">
            重新扫描
          </button>
          {form.whisperEngine === 'faster-whisper' && autoDownloadableModels.has(form.whisperModel) && (
            <button
              type="button"
              disabled={(() => {
                const s = downloadStates[form.whisperModel];
                return s?.status === 'started' || s?.status === 'running';
              })()}
              onClick={async () => {
                const s = downloadStates[form.whisperModel];
                if (s?.status === 'started' || s?.status === 'running') return;
                setDownloadStates((prev) => ({ ...prev, [form.whisperModel]: { status: 'started' } }));
                setFieldHint(`正在下载 ${form.whisperModel}...`);
                try {
                  await downloadWhisperModel(form.whisperModel);
                  playInteractionSound('success');
                  setFieldHint(`${form.whisperModel} 下载完成！`);
                  void loadWhisperModels().then((models) => setWhisperModels(models));
                } catch (err) {
                  playInteractionSound('error');
                  const msg = err instanceof Error ? err.message : '下载失败';
                  setDownloadStates((prev) => ({ ...prev, [form.whisperModel]: { status: 'failed', error: msg } }));
                  setFieldHint(`下载失败: ${msg}`);
                }
              }}
              className="text-[var(--accent)] hover:underline disabled:text-[var(--text-muted)] disabled:opacity-50 group"
            >
              {(() => {
                const s = downloadStates[form.whisperModel];
                const installed = installedWhisperModels.has(form.whisperModel);
                if (s?.status === 'started' || s?.status === 'running') {
                  return (
                    <span className="inline-flex items-center gap-1">
                      <Loader2 size={12} className="animate-spin" /> 下载中...
                    </span>
                  );
                }
                if (s?.status === 'failed') {
                  return <span className="text-[var(--danger)]">下载失败，点击重试</span>;
                }
                if (installed || s?.status === 'completed') {
                  return (
                    <>
                      <span className="group-hover:hidden">下载完成</span>
                      <span className="hidden group-hover:inline">重新下载</span>
                    </>
                  );
                }
                return '立即下载';
              })()}
            </button>
          )}
          {(() => {
            const s = downloadStates[form.whisperModel];
            if (s?.status === 'failed' && s?.error) {
              return <span className="text-[10px] text-[var(--danger)]">{s.error}</span>;
            }
            return null;
          })()}
        </div>
      </div>

      <div className="auto-grid-wide items-start">
        <div className="auto-grid-panels">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">识别语言</label>
            <input
              value={form.language}
              onChange={(e) => updateForm({ language: e.target.value })}
              className="w-full px-3 py-2 bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">总结目标字数上限</label>
            <input
              inputMode="numeric"
              value={drafts.wordLimit}
              onChange={(e) => setNumberDraft('wordLimit', e.target.value)}
              onBlur={() => commitNumber('wordLimit', 'wordLimit', 50, 2000, '总结目标字数上限')}
              onKeyDown={handleNumberKeyDown}
              className="w-full px-3 py-2 bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-lg text-sm"
            />
            <p className="text-[10px] text-[var(--text-muted)] mt-1">只影响 AI 总结正文长度，不影响字幕长度；保存后新任务生效。</p>
          </div>
          {!isWhisperCppEngine && (
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">{threadLabel}</label>
              <input
                inputMode="numeric"
                value={drafts.cpuThreads}
                onChange={(e) => setNumberDraft('cpuThreads', e.target.value)}
                onBlur={() => commitNumber('cpuThreads', 'cpuThreads', 1, 128, threadLabel)}
                onKeyDown={handleNumberKeyDown}
                className="w-full px-3 py-2 bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-lg text-sm"
              />
              <p className="text-[10px] text-[var(--text-muted)] mt-1">{threadHint}</p>
            </div>
          )}
          {isWhisperCppEngine && (
            <div className="rounded-lg border border-[#dbeafe] bg-[var(--info-bg)] px-3 py-2">
              <p className="text-xs font-medium text-[#1d4ed8]">GPU 转写模式</p>
              <p className="mt-1 text-[10px] leading-4 text-[var(--info)]">当前新任务会走 whisper.cpp 外部引擎，CPU 转写线程不会保存到任务，也不会传给转写命令。若仍主要跑 CPU，通常是 whisper-cli.exe 本身未启用 Vulkan/HIP 或缺少对应参数；ffmpeg 提取音频仍会短暂使用 CPU。</p>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">compute_type</label>
            <select
              value={form.computeType}
              onChange={(e) => updateForm({ computeType: e.target.value })}
              className="w-full px-3 py-2 bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-lg text-sm"
            >
              {['int8', 'int8_float16', 'int16', 'float16', 'float32'].map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
            <p className="mt-1 text-[10px] leading-4 text-[var(--text-muted)]">只影响 faster-whisper CPU 路线；whisper.cpp 外部引擎忽略这里。</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">beam_size</label>
            <input
              inputMode="numeric"
              value={drafts.beamSize}
              onChange={(e) => setNumberDraft('beamSize', e.target.value)}
              onBlur={() => commitNumber('beamSize', 'beamSize', 1, 10, 'beam_size')}
              onKeyDown={handleNumberKeyDown}
              className="w-full px-3 py-2 bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-lg text-sm"
            />
            <p className="mt-1 text-[10px] leading-4 text-[var(--text-muted)]">候选搜索宽度。越大越稳但更慢，课程字幕一般 3-5。</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">best_of</label>
            <input
              inputMode="numeric"
              value={drafts.bestOf}
              onChange={(e) => setNumberDraft('bestOf', e.target.value)}
              onBlur={() => commitNumber('bestOf', 'bestOf', 1, 10, 'best_of')}
              onKeyDown={handleNumberKeyDown}
              className="w-full px-3 py-2 bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-lg text-sm"
            />
            <p className="mt-1 text-[10px] leading-4 text-[var(--text-muted)]">多采样后择优。temperature 为 0 时影响很小。</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">temperature</label>
            <input
              inputMode="decimal"
              value={drafts.temperature}
              onChange={(e) => setNumberDraft('temperature', e.target.value)}
              onBlur={() => commitNumber('temperature', 'temperature', 0, 1, 'temperature', false)}
              onKeyDown={handleNumberKeyDown}
              className="w-full px-3 py-2 bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-lg text-sm"
            />
            <p className="mt-1 text-[10px] leading-4 text-[var(--text-muted)]">随机度。0 最稳定，适合字幕；调高可能更灵活但更容易误识别。</p>
          </div>
          <div className="flex items-center justify-between py-2 sm:col-span-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--text-primary)]">VAD 过滤</p>
              <p className="text-xs text-[var(--text-muted)]">去掉长静音，减少空字幕；噪声很重时可关闭测试。</p>
            </div>
            <button
              onClick={() => updateForm({ vadFilter: !form.vadFilter })}
              className={`relative shrink-0 ml-2 w-10 h-5 rounded-full transition-colors ${form.vadFilter ? 'bg-[var(--accent)]' : 'bg-[#d1cdc6]'}`}
            >
              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.vadFilter ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </div>
          <div className="flex items-center justify-between py-2 sm:col-span-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--text-primary)]">字幕校对</p>
              <p className="text-xs text-[var(--text-muted)]">字幕生成后整份交给 AI 校对，不改时间轴。</p>
            </div>
            <button
              onClick={() => updateForm({
                subtitleCorrectionEnabled: !form.subtitleCorrectionEnabled,
                subtitleCorrectionScope: form.subtitleCorrectionEnabled ? 'off' : 'full',
              })}
              className={`relative shrink-0 ml-2 w-10 h-5 rounded-full transition-colors ${form.subtitleCorrectionEnabled ? 'bg-[var(--accent)]' : 'bg-[#d1cdc6]'}`}
            >
              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.subtitleCorrectionEnabled ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">LLM 使用策略</label>
            <div className="auto-grid-compact">
              {[
                { value: 'local_first', label: '先本地', desc: '本地失败再用外部' },
                { value: 'external_first', label: '先外部', desc: '外部失败再用本地' },
                { value: 'local_only', label: '只本地', desc: '不访问外部接口' },
                { value: 'external_only', label: '只外部', desc: '不尝试本地模型' },
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => updateForm({ llmUsagePolicy: item.value as TranscriptionDraft['llmUsagePolicy'] })}
                  className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                    form.llmUsagePolicy === item.value
                      ? 'border-[var(--accent)] bg-[var(--warn-bg)] text-[var(--accent-hover)]'
                      : 'border-[var(--border-light)] bg-white text-[var(--text-secondary)] hover:border-[var(--accent)]/50'
                  }`}
                >
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="mt-1 text-[10px] leading-4">{item.desc}</p>
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-[var(--text-muted)]">影响新的视频总结、字幕校对和右侧灵境小助手。保存后生效。</p>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">字幕校对提示词模板</label>
            <textarea
              value={form.subtitleCorrectionPrompt}
              onChange={(e) => updateForm({ subtitleCorrectionPrompt: e.target.value })}
              rows={4}
              className="w-full px-3 py-2 bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-lg text-sm leading-6 outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/10"
              placeholder="写入课程上下文、专有名词、常见误识别修正规则。保存后新任务生效。"
            />
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-[var(--text-muted)]">
              <span>这里只影响字幕校对阶段，不会改时间轴，不会合并或拆分字幕。</span>
              <button
                type="button"
                onClick={() => updateForm({ subtitleCorrectionPrompt: DEFAULT_SUBTITLE_CORRECTION_PROMPT })}
                className="text-[var(--accent)] hover:underline"
              >
                重置模板
              </button>
            </div>
          </div>
        </div>
        <aside className="rounded-xl border border-[var(--border-light)] bg-[var(--bg-elevated)] p-3 xl:sticky xl:top-4">
          <div className="mb-3">
            <p className="text-sm font-semibold text-[var(--text-primary)]">参数说明</p>
            <p className="mt-1 text-[11px] leading-5 text-[var(--text-secondary)]">这些参数只影响新建的转写/校对任务，已经完成的字幕不会自动重跑。</p>
          </div>
          <div className="space-y-3">
            {TRANSCRIPTION_PARAM_HELP.map((item) => (
              <div key={item.name} className="border-t border-[var(--border-light)] pt-2 first:border-t-0 first:pt-0">
                <p className="text-xs font-semibold text-[var(--accent)]">{item.name}</p>
                <p className="mt-1 text-[11px] leading-5 text-[var(--text-secondary)]">{item.desc}</p>
              </div>
            ))}
          </div>
        </aside>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => void saveForm()}
          disabled={savingSettings}
          className="px-4 py-2 text-sm font-medium text-white bg-[var(--text-primary)] border border-[#1a1a1a] rounded-lg hover:bg-[#2f2f2f] disabled:opacity-50"
        >
          {savingSettings ? '保存中...' : '保存转写设置'}
        </button>
        <button
          onClick={() => void clearJobs()}
          disabled={clearingJobs}
          className="px-4 py-2 text-sm font-medium text-[var(--danger)] border border-[#fecaca] rounded-lg hover:bg-[var(--danger-bg)] disabled:opacity-50"
        >
          {clearingJobs ? '清理中...' : '清理排队任务'}
        </button>
        <button
          onClick={() => void detectEnvironment()}
          disabled={envLoading}
          className="px-4 py-2 text-sm font-medium text-[var(--accent)] border border-[#f5d0a9] rounded-lg hover:bg-[var(--warn-bg)] disabled:opacity-50"
        >
          {envLoading ? '检测中...' : '检测环境'}
        </button>
        {saved && <span className="text-xs text-[var(--success)]">已保存</span>}
        {fieldHint && <span className="text-xs text-[var(--accent)]">{fieldHint}</span>}
        {clearMsg && <span className="text-xs text-[var(--text-secondary)]">{clearMsg}</span>}
      </div>
      {envChecks && (
        <div className="auto-grid-compact">
          {envChecks.map((check) => (
            <div key={check.name} className="flex items-start gap-2 rounded-lg border border-[var(--border-light)] bg-[var(--bg-elevated)] px-3 py-2">
              {check.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-[var(--success)]" /> : <XCircle size={14} className="mt-0.5 shrink-0 text-[var(--danger)]" />}
              <div className="min-w-0">
                <p className="text-xs font-medium text-[var(--text-primary)]">{check.name}</p>
                <p className="text-[11px] text-[var(--text-secondary)]">{check.message}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
