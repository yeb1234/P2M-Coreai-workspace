import type {
  InterviewGroupKey,
  InterviewQuestionType,
  InterviewSource,
} from './types';

/** 只放常量与文案，不导入题库 JSON，避免首屏把 964KB 题包一起拉下来。 */
export const GROUP_ORDER: InterviewGroupKey[] = ['agent', 'llm', 'backend', 'delivery', 'bonus'];

export const GROUP_LABELS: Record<InterviewGroupKey, string> = {
  agent: 'Agent / RAG',
  llm: 'LLM 微调 & 原理',
  backend: '后端底座',
  delivery: '交付封装',
  bonus: '拓展加分',
};

export const TYPE_LABELS: Record<InterviewQuestionType, string> = {
  concept: '概念',
  code: '代码',
  handwrite: '手写',
  debug: '改错',
  scenario: '场景',
  compare: '对比',
  troubleshoot: '排障',
  system: '系统设计',
  project: '项目深挖',
  behavioral: '行为面试',
};

export const SOURCE_LABELS: Record<InterviewSource, string> = {
  书B: '书 B · Agent 宝典',
  书C: '书 C · 九件套',
  书D: '书 D · 后端工程',
  补充: '手写补充',
  项目: '项目档案',
  个人项目: '个人项目 · 当前进度',
};

export const BOOK_TITLES: Record<'B' | 'C' | 'D', string> = {
  B: 'AI Agent 应用开发宝典',
  C: 'AI Agent 后端九件套',
  D: '后端工程学习宝典',
};

export const DIFFICULTY_ORDER = ['基础', '中档', '高频', '压轴'];

export function typeLabel(type: string): string {
  return TYPE_LABELS[type as InterviewQuestionType] || type;
}

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source as InterviewSource] || source;
}

export function questionHref(questionId: string): string {
  return `/interview?q=${encodeURIComponent(questionId)}`;
}
