import type { DEFAULT_TRANSCRIPTION_SETTINGS } from '../../stores';
import type { TranscriptionSettingsDto } from '../../lib/videoApi';

export type TranscriptionDraft = typeof DEFAULT_TRANSCRIPTION_SETTINGS;
export type NumberDrafts = Record<'wordLimit' | 'cpuThreads' | 'beamSize' | 'bestOf' | 'temperature', string>;

export const TRANSCRIPTION_PARAM_HELP = [
  {
    name: 'compute_type',
    desc: '只影响 faster-whisper CPU 路线。whisper.cpp 外部引擎会忽略这里，具体 GPU/CPU 取决于 whisper-cli.exe 和额外参数。',
  },
  {
    name: 'beam_size',
    desc: '解码时同时保留的候选路径数量。数值越大越稳但越慢，课程视频一般 3-5 足够，低占用可用 1。',
  },
  {
    name: 'best_of',
    desc: 'temperature 大于 0 时才明显影响，会多采样几个结果再挑一个。temperature 为 0 时通常不需要调高。',
  },
  {
    name: 'temperature',
    desc: '生成随机度。0 最稳定，适合字幕；调高可能救回难句，但也更容易胡编词。',
  },
  {
    name: 'VAD 过滤',
    desc: '先切掉长静音和无声片段，能减少空字幕和无效转写。背景噪声很重时可能误切，可以关闭测试。',
  },
  {
    name: 'CPU 线程',
    desc: '只控制 faster-whisper CPU 转写和 CPU 路线的 ffmpeg 提取。whisper.cpp 转写不会接收这个参数。',
  },
  {
    name: '字幕校对',
    desc: '转写完成后把整份字幕交给 LLM 校对，修正误识别词、错别字和专有名词，不改时间轴。',
  },
  {
    name: 'LLM 使用策略',
    desc: '控制总结、字幕校对和灵境小助手对话优先使用本地模型还是外部网络模型，也可以限制只用其中一种。',
  },
] as const;

export function transcriptionFormToDto(form: TranscriptionDraft): TranscriptionSettingsDto {
  return {
    whisper_engine: form.whisperEngine,
    whisper_model: form.whisperModel,
    language: form.language,
    do_summary: form.doSummary,
    word_limit: form.wordLimit,
    cpu_threads: form.cpuThreads,
    compute_type: form.computeType,
    beam_size: form.beamSize,
    best_of: form.bestOf,
    temperature: form.temperature,
    vad_filter: form.vadFilter,
    subtitle_correction_enabled: form.subtitleCorrectionEnabled,
    subtitle_correction_scope: form.subtitleCorrectionScope,
    subtitle_correction_prompt: form.subtitleCorrectionPrompt,
    llm_usage_policy: form.llmUsagePolicy,
  };
}

export function transcriptionDtoToForm(dto: TranscriptionSettingsDto): TranscriptionDraft {
  return {
    whisperEngine: dto.whisper_engine,
    whisperModel: dto.whisper_model,
    language: dto.language,
    doSummary: dto.do_summary,
    wordLimit: dto.word_limit,
    cpuThreads: dto.cpu_threads,
    computeType: dto.compute_type,
    beamSize: dto.beam_size,
    bestOf: dto.best_of,
    temperature: dto.temperature,
    vadFilter: dto.vad_filter,
    subtitleCorrectionEnabled: dto.subtitle_correction_enabled,
    subtitleCorrectionScope: dto.subtitle_correction_scope === 'off' ? 'off' : 'full',
    subtitleCorrectionPrompt: dto.subtitle_correction_prompt,
    llmUsagePolicy: dto.llm_usage_policy,
  };
}

export const STORAGE_KEYS = [
  'p2m-ui-storage',
  'p2m-pomodoro-storage',
  'p2m-pomodoro-runtime-v2',
  'p2m-pomodoro-config-v2',
  'p2m-pomodoro-history-v2',
  'p2m-todo-storage',
  'p2m-calendar-storage',
  'p2m-notes-storage',
  'p2m-plugin-storage',
  'p2m-notification-storage',
];
