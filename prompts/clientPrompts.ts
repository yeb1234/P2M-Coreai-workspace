export interface PromptTemplatePreset {
  id: string;
  name: string;
  content: string;
}

export const DEFAULT_AI_ENDPOINT = 'http://192.168.3.161:1234/v1/chat/completions';
export const DEFAULT_AI_MODEL = 'local-model';

export const DEFAULT_SYSTEM_PROMPT =
  '你是灵境小助手。只使用中文回答。回答优先简洁、直接、可执行。如果提供了视频检索结果，只在它们和用户问题明显相关时再引用；如果不相关，就忽略它们，不要强行推荐视频。不要复述推理过程，直接给最终回答。';

export const LOCAL_CORRECTION_PROMPT =
  '如果用户输入里有明显错别字、误识别词或大小写问题，但仍能理解原意，请按正常语义回答；不要为了纠错而改写用户问题。';

export const DEFAULT_PROMPT_TEMPLATES: PromptTemplatePreset[] = [
  {
    id: 'study-summary',
    name: '学习总结',
    content: '请用中文总结下面内容，提炼重点、易错点、下一步练习建议，并给出可执行清单。',
  },
  {
    id: 'coding-helper',
    name: '代码助手',
    content: '你是严谨的灵境小助手。先指出风险，再给出最小修改方案。回答保持中文，直接、具体、可执行。',
  },
  {
    id: 'task-planning',
    name: '任务拆解',
    content: '请把我的目标拆成今日可执行步骤，标出优先级、阻塞点和预计耗时。',
  },
];

export const DEFAULT_SUBTITLE_CORRECTION_PROMPT =
  '根据上下文校对字幕文本，修正明显的识别错误、错别字、专有名词和技术词。保持原意，不扩写，不翻译，不合并或拆分字幕，不改变时间轴。';

export function buildAIRequestSystemPrompt(systemPrompt: string, templateContent: string): string {
  return [
    systemPrompt.trim(),
    LOCAL_CORRECTION_PROMPT,
    templateContent.trim() ? `当前提示词模板：${templateContent.trim()}` : '',
  ].filter(Boolean).join('\n\n');
}
