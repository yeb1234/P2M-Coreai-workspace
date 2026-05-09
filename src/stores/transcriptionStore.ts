import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { idbStorage } from '../lib/idbStorage';

export const WHISPER_MODELS = [
  { id: 'tiny', name: 'tiny', desc: '最快，适合临时预览，准确率最低' },
  { id: 'base', name: 'base', desc: '很快，适合粗略字幕' },
  { id: 'small', name: 'small', desc: '速度和质量比较均衡' },
  { id: 'medium', name: 'medium', desc: '中文和技术课推荐，质量更稳' },
  { id: 'large-v1', name: 'large-v1', desc: '旧版大模型，质量高但慢' },
  { id: 'large-v2', name: 'large-v2', desc: '新版大模型之一，质量高' },
  { id: 'large-v3', name: 'large-v3', desc: '高质量推荐，资源占用最高' },
  { id: 'large', name: 'large', desc: '通常指向当前 large 系列默认版本' },
];

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
  subtitleCorrectionPrompt: string;
}

interface TranscriptionState extends TranscriptionSettings {
  updateSettings: (updates: Partial<TranscriptionSettings>) => void;
  resetSettings: () => void;
}

export const DEFAULT_TRANSCRIPTION_SETTINGS: TranscriptionSettings = {
  whisperEngine: 'faster-whisper',
  whisperModel: 'medium',
  language: 'zh',
  doSummary: true,
  wordLimit: 200,
  cpuThreads: 4,
  computeType: 'int8',
  beamSize: 5,
  bestOf: 5,
  temperature: 0,
  vadFilter: true,
  subtitleCorrectionEnabled: true,
  subtitleCorrectionPrompt: '根据上下文修正明显识别错误。技术课里优先保留 Git、GitHub、commit、branch、merge、Python、JavaScript、API 等术语。',
};

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const next = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, next));
}

function sanitizeSettings(value: Partial<TranscriptionSettings>): TranscriptionSettings {
  const modelIds = new Set(WHISPER_MODELS.map((model) => model.id));
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
    subtitleCorrectionPrompt: typeof value.subtitleCorrectionPrompt === 'string'
      ? value.subtitleCorrectionPrompt
      : DEFAULT_TRANSCRIPTION_SETTINGS.subtitleCorrectionPrompt,
  };
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
      version: 1,
      migrate: (persistedState: unknown) => ({
        ...DEFAULT_TRANSCRIPTION_SETTINGS,
        ...sanitizeSettings((persistedState as Partial<TranscriptionSettings>) || {}),
      }),
      partialize: (state) => sanitizeSettings(state),
    }
  )
);
