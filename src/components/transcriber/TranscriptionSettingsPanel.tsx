import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { WHISPER_MODELS, DEFAULT_TRANSCRIPTION_SETTINGS } from '../../stores/transcriptionStore';
import { downloadWhisperModel, fetchDownloadStatus, fetchWhisperModels, type WhisperModelsOut } from '../../lib/videoApi';

export interface TranscriptionSettings {
  whisperEngine: string;
  whisperModel: string;
  language: string;
  doSummary: boolean;
  wordLimit: number;
  cpuThreads: number;
  computeType: string;
  beamSize: number;
  bestOf: number;
  temperature: number;
  vadFilter: boolean;
  deviceType: 'auto' | 'cuda' | 'cpu';
  subtitleCorrectionEnabled: boolean;
  subtitleCorrectionScope: 'full' | 'off';
}

export const DEFAULT_SETTINGS: TranscriptionSettings = {
  whisperEngine: DEFAULT_TRANSCRIPTION_SETTINGS.whisperEngine,
  whisperModel: DEFAULT_TRANSCRIPTION_SETTINGS.whisperModel,
  language: DEFAULT_TRANSCRIPTION_SETTINGS.language,
  doSummary: DEFAULT_TRANSCRIPTION_SETTINGS.doSummary,
  wordLimit: DEFAULT_TRANSCRIPTION_SETTINGS.wordLimit,
  cpuThreads: DEFAULT_TRANSCRIPTION_SETTINGS.cpuThreads,
  computeType: DEFAULT_TRANSCRIPTION_SETTINGS.computeType,
  beamSize: DEFAULT_TRANSCRIPTION_SETTINGS.beamSize,
  bestOf: DEFAULT_TRANSCRIPTION_SETTINGS.bestOf,
  temperature: DEFAULT_TRANSCRIPTION_SETTINGS.temperature,
  vadFilter: DEFAULT_TRANSCRIPTION_SETTINGS.vadFilter,
  deviceType: DEFAULT_TRANSCRIPTION_SETTINGS.deviceType,
  subtitleCorrectionEnabled: DEFAULT_TRANSCRIPTION_SETTINGS.subtitleCorrectionEnabled,
  subtitleCorrectionScope: DEFAULT_TRANSCRIPTION_SETTINGS.subtitleCorrectionScope,
};

const COMPUTE_TYPES_CPU = ['int8', 'int16', 'float32'];
const COMPUTE_TYPES_GPU = ['int8_float16', 'float16', 'int8', 'bfloat16', 'float32'];
const COMPUTE_TYPES_ALL = ['int8', 'int8_float16', 'int16', 'float16', 'bfloat16', 'float32'];

function allowedComputeTypes(engine: string, deviceType: 'auto' | 'cuda' | 'cpu'): string[] {
  if (engine === 'whisper.cpp') return COMPUTE_TYPES_ALL; // whisper.cpp ignores this anyway
  if (deviceType === 'cpu') return COMPUTE_TYPES_CPU;
  if (deviceType === 'cuda') return COMPUTE_TYPES_GPU;
  return COMPUTE_TYPES_ALL;
}

function allowedModels(_engine: string): typeof WHISPER_MODELS {
  return WHISPER_MODELS;
}

interface TranscriptionSettingsPanelProps {
  settings: TranscriptionSettings;
  onChange: (settings: Partial<TranscriptionSettings>) => void;
}

export function TranscriptionSettingsPanel({ settings, onChange }: TranscriptionSettingsPanelProps) {
  const [whisperModels, setWhisperModels] = useState<WhisperModelsOut | null>(null);
  interface DownloadState {
    status: string;
    error?: string;
  }
  const [downloadStates, setDownloadStates] = useState<Record<string, DownloadState>>({});

  useEffect(() => {
    void fetchWhisperModels().then((m) => {
      setWhisperModels(m);
      if (m) {
        const autoDlIds = m.items.filter((i) => i.auto_downloadable).map((i) => i.id);
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
    }).catch(() => setWhisperModels(null));
  }, []);
  const isWhisperCpp = settings.whisperEngine === 'whisper.cpp';
  const isCuda = !isWhisperCpp && settings.deviceType === 'cuda';
  const computeOptions = allowedComputeTypes(settings.whisperEngine, settings.deviceType);
  const modelOptions = allowedModels(settings.whisperEngine);
  const computeTypeInvalid = !isWhisperCpp && !computeOptions.includes(settings.computeType);
  const modelInvalid = !modelOptions.some((m) => m.id === settings.whisperModel);
  const installedModels = new Set((whisperModels?.items ?? []).filter((i) => i.installed).map((i) => i.id));
  const autoDlModels = new Set((whisperModels?.items ?? []).filter((i) => i.auto_downloadable).map((i) => i.id));
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

  // CUDA preset: faster-whisper + large-v3-turbo + float16
  const applyCudaTurbo = () => onChange({
    whisperEngine: 'faster-whisper',
    whisperModel: 'large-v3-turbo',
    deviceType: 'cuda',
    computeType: 'int8_float16',
    beamSize: 5,
    bestOf: 1,
    temperature: 0,
    vadFilter: true,
    subtitleCorrectionEnabled: false,
    subtitleCorrectionScope: 'off',
  });

  const applyLowUsage = () => onChange({
    whisperEngine: 'faster-whisper',
    whisperModel: 'medium',
    deviceType: 'cpu',
    cpuThreads: 6,
    computeType: 'int8',
    beamSize: 3,
    bestOf: 1,
    temperature: 0,
    vadFilter: true,
    subtitleCorrectionEnabled: false,
    subtitleCorrectionScope: 'off',
  });

  const applyHighPerf = () => onChange({
    whisperEngine: 'whisper.cpp',
    whisperModel: 'large-v3',
    computeType: 'int8',
    beamSize: 5,
    bestOf: 5,
    temperature: 0,
    vadFilter: true,
    subtitleCorrectionEnabled: false,
    subtitleCorrectionScope: 'full',
  });

  const applyDefault = () => onChange({ ...DEFAULT_SETTINGS });

  const handleEngineChange = (engine: string) => {
    onChange({ whisperEngine: engine });
  };

  const handleDeviceChange = (d: 'auto' | 'cuda' | 'cpu') => {
    const updates: Partial<TranscriptionSettings> = { deviceType: d };
    const next = allowedComputeTypes(settings.whisperEngine, d);
    if (!next.includes(settings.computeType)) {
      updates.computeType = d === 'cpu' ? 'int8' : 'int8_float16';
    }
    onChange(updates);
  };

  return (
    <div className="min-w-0 space-y-3">
      {/* Presets */}
      <div className="rounded-lg border border-[var(--border-light)] bg-[var(--bg-elevated)] p-2">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-xs font-semibold text-[var(--text-primary)]">模式预设</p>
          <p className="text-xs text-[var(--text-muted)]">先选预设，再微调</p>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          <button
            type="button"
            onClick={applyCudaTurbo}
            className={`rounded-md border px-2 py-1.5 text-left transition-colors ${
              isCuda && settings.whisperModel === 'large-v3-turbo'
                ? 'border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--accent)]'
                : 'border-[var(--border-light)] bg-[var(--theme-surface,white)] text-[var(--text-primary)] hover:border-[var(--accent)]'
            }`}
            title="3070Ti（8G显存）推荐：faster-whisper + large-v3-turbo + int8_float16"
          >
            <p className="text-xs font-medium">3070Ti（8G显存）推荐</p>
            <p className="mt-0.5 text-xs leading-3 text-[var(--text-muted)]">large-v3-turbo</p>
          </button>
          <button
            type="button"
            onClick={applyLowUsage}
            className={`rounded-md border px-2 py-1.5 text-left transition-colors ${
              settings.whisperEngine === 'faster-whisper' && settings.deviceType !== 'cuda'
                ? 'border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--accent)]'
                : 'border-[var(--border-light)] bg-[var(--theme-surface,white)] text-[var(--text-primary)] hover:border-[var(--accent)]'
            }`}
            title="faster-whisper CPU，参数保守，适合后台慢慢跑"
          >
            <p className="text-xs font-medium">CPU 低占用</p>
            <p className="mt-0.5 text-xs leading-3 text-[var(--text-muted)]">faster-whisper</p>
          </button>
          <button
            type="button"
            onClick={applyHighPerf}
            className={`rounded-md border px-2 py-1.5 text-left transition-colors ${
              settings.whisperEngine === 'whisper.cpp'
                ? 'border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--accent)]'
                : 'border-[var(--border-light)] bg-[var(--theme-surface,white)] text-[var(--text-primary)] hover:border-[var(--accent)]'
            }`}
            title="whisper.cpp + large-v3，适合 GPU/Vulkan/HIP 转写"
          >
            <p className="text-xs font-medium">Whisper.cpp</p>
            <p className="mt-0.5 text-xs leading-3 text-[var(--text-muted)]">外部引擎</p>
          </button>
          <button
            type="button"
            onClick={applyDefault}
            className="rounded-md border border-[var(--border-light)] bg-[var(--theme-surface,white)] px-2 py-1.5 text-left transition-colors hover:border-[var(--accent)]"
            title="恢复系统默认参数"
          >
            <p className="text-xs font-medium text-[var(--text-primary)]">恢复默认</p>
            <p className="mt-0.5 text-xs leading-3 text-[var(--text-muted)]">系统默认</p>
          </button>
        </div>
      </div>

      {/* Engine */}
      <div>
        <label htmlFor="f-1a10c7" className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">转写引擎</label>
        <select id="f-1a10c7"
          value={settings.whisperEngine}
          onChange={(e) => handleEngineChange(e.target.value)}
          className="w-full rounded-md border border-[var(--border-light)] bg-[var(--bg-elevated)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        >
          <option value="faster-whisper">faster-whisper CPU（稳定默认）</option>
          <option value="whisper.cpp">whisper.cpp 外部引擎（可接 Vulkan/HIP）</option>
        </select>
      </div>

      <div>
        <label htmlFor="f-9b3022" className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">模型尺寸</label>
        <select id="f-9b3022"
          value={settings.whisperModel}
          onChange={(e) => onChange({ whisperModel: e.target.value })}
          className="w-full rounded-md border border-[var(--border-light)] bg-[var(--bg-elevated)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        >
          {modelOptions.map((m) => {
            const installed = !whisperModels || installedModels.has(m.id);
            const autoDl = autoDlModels.has(m.id);
            const canSelect = installed || (!isWhisperCpp && autoDl);
            const dlState = downloadStates[m.id];
            let suffix = installed ? m.desc : `未安装`;
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
              <option key={m.id} value={m.id} disabled={!canSelect}>
                {m.name} — {suffix}
              </option>
            );
          })}
        </select>
        {modelInvalid && (
          <p className="mt-1 text-xs text-amber-600">
            当前模型与所选引擎不兼容，请重新选择。
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
          {whisperModels && <span>模型目录：{whisperModels.model_dir}</span>}
          <button type="button" onClick={() => void fetchWhisperModels().then((m) => setWhisperModels(m)).catch(() => setWhisperModels(null))} className="text-[var(--accent)] hover:underline">
            重新扫描
          </button>
          {!isWhisperCpp && autoDlModels.has(settings.whisperModel) && (
            <button
              type="button"
              disabled={(() => {
                const s = downloadStates[settings.whisperModel];
                return s?.status === 'started' || s?.status === 'running';
              })()}
              onClick={async () => {
                const s = downloadStates[settings.whisperModel];
                if (s?.status === 'started' || s?.status === 'running') return;
                setDownloadStates((prev) => ({ ...prev, [settings.whisperModel]: { status: 'started' } }));
                try {
                  await downloadWhisperModel(settings.whisperModel);
                  void fetchWhisperModels().then((m) => setWhisperModels(m));
                } catch (err) {
                  const msg = err instanceof Error ? err.message : '下载失败';
                  setDownloadStates((prev) => ({ ...prev, [settings.whisperModel]: { status: 'failed', error: msg } }));
                }
              }}
              className="text-[var(--accent)] hover:underline disabled:text-[var(--text-muted)] disabled:opacity-50 group"
            >
              {(() => {
                const s = downloadStates[settings.whisperModel];
                const installed = installedModels.has(settings.whisperModel);
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
            const s = downloadStates[settings.whisperModel];
            if (s?.status === 'failed' && s?.error) {
              return <span className="text-xs text-amber-600">{s.error}</span>;
            }
            return null;
          })()}
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">运行设备</label>
        <div className="flex gap-2">
          {(['auto', 'cuda', 'cpu'] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => handleDeviceChange(d)}
              className={`flex-1 rounded-md border px-2 py-1.5 text-xs transition-colors ${
                settings.deviceType === d
                  ? 'border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--accent)]'
                  : 'border-[var(--border-light)] text-[var(--text-secondary)] hover:border-[var(--accent)]'
              }`}
            >
              {d === 'auto' ? '自动' : d === 'cuda' ? 'CUDA' : 'CPU'}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-[var(--text-muted)]">只对 faster-whisper 生效。whisper.cpp 取决于 whisper-cli.exe 编译参数。</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="f-295bb7" className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">语言</label>
          <input id="f-295bb7"
            value={settings.language}
            onChange={(e) => onChange({ language: e.target.value })}
            className="w-full rounded-md border border-[var(--border-light)] bg-[var(--bg-elevated)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
        </div>
        <div>
          <label htmlFor="f-101ceb" className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">计算精度</label>
          <select id="f-101ceb"
            value={settings.computeType}
            onChange={(e) => onChange({ computeType: e.target.value })}
            disabled={isWhisperCpp}
            className="w-full rounded-md border border-[var(--border-light)] bg-[var(--bg-elevated)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)] disabled:opacity-60"
          >
            {computeOptions.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          {computeTypeInvalid ? (
            <p className="mt-1 text-xs text-amber-600">
              {settings.deviceType === 'cpu' ? 'CPU 不支持 float16/bfloat16 系列，会自动回退到 int8。' : '当前 compute_type 与设备不兼容，请重选。'}
            </p>
          ) : (
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {isWhisperCpp ? 'whisper.cpp 忽略此项' : settings.deviceType === 'cuda' ? 'CUDA: float16 速度最快，int8_float16 显存最省' : 'CPU: int8 最快、float32 最准'}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label htmlFor="f-031a56" className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">beam_size</label>
          <input id="f-031a56"
            type="number"
            min={1}
            max={10}
            value={settings.beamSize}
            onChange={(e) => onChange({ beamSize: Number(e.target.value) })}
            className="w-full rounded-md border border-[var(--border-light)] bg-[var(--bg-elevated)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
        </div>
        <div>
          <label htmlFor="f-b34449" className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">best_of</label>
          <input id="f-b34449"
            type="number"
            min={1}
            max={10}
            value={settings.bestOf}
            onChange={(e) => onChange({ bestOf: Number(e.target.value) })}
            className="w-full rounded-md border border-[var(--border-light)] bg-[var(--bg-elevated)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
        </div>
        <div>
          <label htmlFor="f-c9bf0b" className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">温度</label>
          <input id="f-c9bf0b"
            type="number"
            min={0}
            max={1}
            step={0.1}
            value={settings.temperature}
            onChange={(e) => onChange({ temperature: Number(e.target.value) })}
            className="w-full rounded-md border border-[var(--border-light)] bg-[var(--bg-elevated)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {isWhisperCpp ? (
          <div className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs leading-4 text-blue-700">
            GPU 转写模式：CPU 线程对 whisper.cpp 无效，由 whisper-cli.exe 自行决定。
          </div>
        ) : isCuda ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs leading-4 text-emerald-700">
            CUDA 模式：转写在 GPU 上跑，CPU 线程仅影响 ffmpeg 音频提取。
          </div>
        ) : (
          <div>
            <label htmlFor="f-c19562" className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">CPU 转写线程</label>
            <input id="f-c19562"
              type="number"
              min={1}
              max={128}
              value={settings.cpuThreads}
              onChange={(e) => onChange({ cpuThreads: Number(e.target.value) })}
              className="w-full rounded-md border border-[var(--border-light)] bg-[var(--bg-elevated)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
          </div>
        )}
        <div>
          <label htmlFor="f-dedcea" className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">总结字数</label>
          <input id="f-dedcea"
            type="number"
            min={50}
            max={2000}
            value={settings.wordLimit}
            onChange={(e) => onChange({ wordLimit: Number(e.target.value) })}
            className="w-full rounded-md border border-[var(--border-light)] bg-[var(--bg-elevated)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={settings.doSummary}
            onChange={(e) => onChange({ doSummary: e.target.checked })}
            className="h-3.5 w-3.5 accent-[var(--accent)]"
          />
          生成总结
        </label>
        <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={settings.vadFilter}
            onChange={(e) => onChange({ vadFilter: e.target.checked })}
            className="h-3.5 w-3.5 accent-[var(--accent)]"
          />
          VAD 过滤
        </label>
        <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={settings.subtitleCorrectionEnabled}
            onChange={(e) => onChange({
              subtitleCorrectionEnabled: e.target.checked,
              subtitleCorrectionScope: e.target.checked ? 'full' : 'off',
            })}
            className="h-3.5 w-3.5 accent-[var(--accent)]"
          />
          字幕校对
        </label>
      </div>
    </div>
  );
}
