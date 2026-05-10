import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { idbStorage } from '../lib/idbStorage';

export const WHISPER_MODELS = [
  { id: 'tiny', name: 'tiny', desc: '最快，适合临时预览，准确率最低' },
  { id: 'base', name: 'base', desc: '很快，适合粗略字幕' },
  { id: 'small', name: 'small', desc: '速度和质量比较均衡' },
  { id: 'medium', name: 'medium', desc: '中文和技术课推荐，质量更稳' },
  { id: 'large', name: 'large', desc: 'large 系列基础版本' },
  { id: 'large-v3', name: 'large-v3', desc: '高质量推荐，资源占用最高' },
];

export const DEFAULT_SUBTITLE_CORRECTION_PROMPT =
  '根据上下文校对字幕文本，修正明显的识别错误、错别字、专有名词和技术词。保持原意，不扩写，不翻译，不合并或拆分字幕，不改变时间轴。';

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
  subtitleCorrectionEnabled: boolean;
  subtitleCorrectionScope: 'full' | 'off';
  subtitleCorrectionPrompt: string;
}

interface TranscriptionState extends TranscriptionSettings {
  updateSettings: (updates: Partial<TranscriptionSettings>) => void;
  resetSettings: () => void;
}

export const DEFAULT_TRANSCRIPTION_SETTINGS: TranscriptionSettings = {
  whisperEngine: 'whisper.cpp',
  whisperModel: 'large-v3',
  language: 'zh',
  doSummary: true,
  wordLimit: 200,
  cpuThreads: 12,
  computeType: 'int8',
  beamSize: 5,
  bestOf: 5,
  temperature: 0,
  vadFilter: true,
  subtitleCorrectionEnabled: false,
  subtitleCorrectionScope: 'full',
  subtitleCorrectionPrompt: DEFAULT_SUBTITLE_CORRECTION_PROMPT,
};

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const next = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, next));
}

function sanitizeSettings(value: Partial<TranscriptionSettings>): TranscriptionSettings {
  const modelIds = new Set(WHISPER_MODELS.map((model) => model.id));
  const rawPrompt = typeof value.subtitleCorrectionPrompt === 'string'
    ? value.subtitleCorrectionPrompt
    : DEFAULT_TRANSCRIPTION_SETTINGS.subtitleCorrectionPrompt;
  const promptLooksCorrupt = rawPrompt.includes('????') || /\u5fd9.|\ufffd/.test(rawPrompt);
  return {
    whisperModel: typeof value.whisperModel === 'string' && modelIds.has(value.whisperModel)
      ? value.whisperModel
      : DEFAULT_TRANSCRIPTION_SETTINGS.whisperModel,
    whisperEngine: typeof value.whisperEngine === 'string' && value.whisperEngine.trim()
      ? value.whisperEngine
      : DEFAULT_TRANSCRIPTION_SETTINGS.whisperEngine,
    language: typeof value.language === 'string' ? value.language : DEFAULT_TRANSCRIPTION_SETTINGS.language,
    doSummary: typeof value.doSummary === 'boolean' ? value.doSummary : DEFAULT_TRANSCRIPTION_SETTINGS.doSummary,
    wordLimit: Math.round(clampNumber(value.wordLimit, DEFAULT_TRANSCRIPTION_SETTINGS.wordLimit, 50, 2000)),
    cpuThreads: Math.round(clampNumber(value.cpuThreads, DEFAULT_TRANSCRIPTION_SETTINGS.cpuThreads, 1, 128)),
    computeType: typeof value.computeType === 'string' && value.computeType.trim()
      ? value.computeType.trim()
      : DEFAULT_TRANSCRIPTION_SETTINGS.computeType,
    beamSize: Math.round(clampNumber(value.beamSize, DEFAULT_TRANSCRIPTION_SETTINGS.beamSize, 1, 10)),
    bestOf: Math.round(clampNumber(value.bestOf, DEFAULT_TRANSCRIPTION_SETTINGS.bestOf, 1, 10)),
    temperature: clampNumber(value.temperature, DEFAULT_TRANSCRIPTION_SETTINGS.temperature, 0, 1),
    vadFilter: typeof value.vadFilter === 'boolean' ? value.vadFilter : DEFAULT_TRANSCRIPTION_SETTINGS.vadFilter,
    subtitleCorrectionEnabled: typeof value.subtitleCorrectionEnabled === 'boolean'
      ? value.subtitleCorrectionEnabled
      : DEFAULT_TRANSCRIPTION_SETTINGS.subtitleCorrectionEnabled,
    subtitleCorrectionScope: value.subtitleCorrectionScope === 'off' ? 'off' : 'full',
    subtitleCorrectionPrompt: promptLooksCorrupt ? DEFAULT_SUBTITLE_CORRECTION_PROMPT : rawPrompt,
  };
}

function migrateSettings(persistedState: unknown): TranscriptionSettings {
  const raw = (persistedState as Partial<TranscriptionSettings>) || {};
  const next = sanitizeSettings(raw);
  const wasLegacyDefault =
    (!raw.whisperEngine || raw.whisperEngine === 'faster-whisper') &&
    (!raw.whisperModel || raw.whisperModel === 'medium');
  const migrated = wasLegacyDefault
    ? { ...next, whisperEngine: DEFAULT_TRANSCRIPTION_SETTINGS.whisperEngine, whisperModel: DEFAULT_TRANSCRIPTION_SETTINGS.whisperModel }
    : next;
  const wasOldThreadDefault = raw.cpuThreads === undefined || raw.cpuThreads === 4;
  return wasOldThreadDefault ? { ...migrated, cpuThreads: DEFAULT_TRANSCRIPTION_SETTINGS.cpuThreads } : migrated;
}

export const useTranscriptionStore = create<TranscriptionState>()(
  persist(
    (set) => ({
      ...DEFAULT_TRANSCRIPTION_SETTINGS,
      updateSettings: (updates) => set((state) => sanitizeSettings({ ...state, ...updates })),
      resetSettings: () => set(DEFAULT_TRANSCRIPTION_SETTINGS),
    }),
    {
      name: 'p2m-transcription-storage',
      storage: createJSONStorage(() => idbStorage),
      version: 5,
      migrate: (persistedState: unknown) => ({
        ...DEFAULT_TRANSCRIPTION_SETTINGS,
        ...migrateSettings(persistedState),
      }),
      partialize: (state) => sanitizeSettings(state),
    }
  )
);
