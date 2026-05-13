import { WHISPER_MODELS, DEFAULT_TRANSCRIPTION_SETTINGS } from '../../stores/transcriptionStore';

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

const COMPUTE_TYPES = ['int8', 'int8_float16', 'int16', 'float16', 'float32'];

interface TranscriptionSettingsPanelProps {
  settings: TranscriptionSettings;
  onChange: (settings: Partial<TranscriptionSettings>) => void;
}

export function TranscriptionSettingsPanel({ settings, onChange }: TranscriptionSettingsPanelProps) {
  const isWhisperCpp = settings.whisperEngine === 'whisper.cpp';

  const applyLowUsage = () => onChange({
    whisperEngine: 'faster-whisper',
    cpuThreads: 12,
    computeType: 'int8',
    beamSize: 1,
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

  return (
    <div className="min-w-0 space-y-3">
      {/* Presets */}
      <div className="rounded-lg border border-[var(--border-light)] bg-[var(--bg-elevated)] p-2">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-[11px] font-semibold text-[var(--text-primary)]">模式预设</p>
          <p className="text-[10px] text-[var(--text-muted)]">先选预设，再微调</p>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <button
            type="button"
            onClick={applyLowUsage}
            className="rounded-md border border-[var(--border-light)] bg-[var(--theme-surface,white)] px-2 py-1.5 text-left transition-colors hover:border-[var(--accent)]"
            title="faster-whisper CPU，参数保守，适合后台慢慢跑"
          >
            <p className="text-[11px] font-medium text-[var(--text-primary)]">低占用</p>
            <p className="mt-0.5 text-[10px] leading-3 text-[var(--text-muted)]">CPU 路线</p>
          </button>
          <button
            type="button"
            onClick={applyHighPerf}
            className="rounded-md border border-[var(--accent)] bg-[var(--accent)] px-2 py-1.5 text-left text-white transition-colors hover:opacity-90"
            title="whisper.cpp + large-v3，适合 GPU/Vulkan/HIP 转写"
          >
            <p className="text-[11px] font-medium">高性能</p>
            <p className="mt-0.5 text-[10px] leading-3 text-white/80">whisper.cpp</p>
          </button>
          <button
            type="button"
            onClick={applyDefault}
            className="rounded-md border border-[var(--border-light)] bg-[var(--theme-surface,white)] px-2 py-1.5 text-left transition-colors hover:border-[var(--accent)]"
            title="恢复系统默认参数"
          >
            <p className="text-[11px] font-medium text-[var(--text-primary)]">恢复默认</p>
            <p className="mt-0.5 text-[10px] leading-3 text-[var(--text-muted)]">系统默认</p>
          </button>
        </div>
      </div>

      {/* Engine */}
      <div>
        <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">转写引擎</label>
        <select
          value={settings.whisperEngine}
          onChange={(e) => onChange({ whisperEngine: e.target.value })}
          className="w-full rounded-md border border-[var(--border-light)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        >
          <option value="faster-whisper">faster-whisper CPU（稳定默认）</option>
          <option value="whisper.cpp">whisper.cpp 外部引擎（可接 Vulkan/HIP）</option>
        </select>
      </div>

      <div>
        <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">模型尺寸</label>
        <select
          value={settings.whisperModel}
          onChange={(e) => onChange({ whisperModel: e.target.value })}
          className="w-full rounded-md border border-[var(--border-light)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        >
          {WHISPER_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} — {m.desc}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">运行设备</label>
        <div className="flex gap-2">
          {(['auto', 'cuda', 'cpu'] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onChange({ deviceType: d })}
              className={`flex-1 rounded-md border px-2 py-1.5 text-[11px] transition-colors ${
                settings.deviceType === d
                  ? 'border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--accent)]'
                  : 'border-[var(--border-light)] text-[var(--text-secondary)] hover:border-[var(--accent)]'
              }`}
            >
              {d === 'auto' ? '自动' : d === 'cuda' ? 'CUDA' : 'CPU'}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[10px] text-[var(--text-muted)]">只对 faster-whisper 生效。whisper.cpp 取决于 whisper-cli.exe 编译参数。</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">语言</label>
          <input
            value={settings.language}
            onChange={(e) => onChange({ language: e.target.value })}
            className="w-full rounded-md border border-[var(--border-light)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">计算精度</label>
          <select
            value={settings.computeType}
            onChange={(e) => onChange({ computeType: e.target.value })}
            className="w-full rounded-md border border-[var(--border-light)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          >
            {COMPUTE_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <p className="mt-1 text-[10px] text-[var(--text-muted)]">只影响 faster-whisper；whisper.cpp 忽略。</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">beam_size</label>
          <input
            type="number"
            min={1}
            max={10}
            value={settings.beamSize}
            onChange={(e) => onChange({ beamSize: Number(e.target.value) })}
            className="w-full rounded-md border border-[var(--border-light)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">best_of</label>
          <input
            type="number"
            min={1}
            max={10}
            value={settings.bestOf}
            onChange={(e) => onChange({ bestOf: Number(e.target.value) })}
            className="w-full rounded-md border border-[var(--border-light)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">温度</label>
          <input
            type="number"
            min={0}
            max={1}
            step={0.1}
            value={settings.temperature}
            onChange={(e) => onChange({ temperature: Number(e.target.value) })}
            className="w-full rounded-md border border-[var(--border-light)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {!isWhisperCpp ? (
          <div>
            <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">CPU 转写线程</label>
            <input
              type="number"
              min={1}
              max={128}
              value={settings.cpuThreads}
              onChange={(e) => onChange({ cpuThreads: Number(e.target.value) })}
              className="w-full rounded-md border border-[var(--border-light)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
          </div>
        ) : (
          <div className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-[10px] leading-4 text-blue-700">
            GPU 转写模式：CPU 线程对 whisper.cpp 无效，由 whisper-cli.exe 自行决定。
          </div>
        )}
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">总结字数</label>
          <input
            type="number"
            min={50}
            max={2000}
            value={settings.wordLimit}
            onChange={(e) => onChange({ wordLimit: Number(e.target.value) })}
            className="w-full rounded-md border border-[var(--border-light)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={settings.doSummary}
            onChange={(e) => onChange({ doSummary: e.target.checked })}
            className="h-3.5 w-3.5 accent-[var(--accent)]"
          />
          生成总结
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={settings.vadFilter}
            onChange={(e) => onChange({ vadFilter: e.target.checked })}
            className="h-3.5 w-3.5 accent-[var(--accent)]"
          />
          VAD 过滤
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)]">
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
