import type { InterviewQuestionSummary } from '../data/interview/types';

export type RoundCategory = 'agent' | 'llm' | 'backend' | 'delivery' | 'bonus' | 'project';

export type RoundConfig = Record<RoundCategory, number>;

export interface RoundPreset {
  key: 'first' | 'second' | 'custom';
  label: string;
  tagline: string;
  minutes: string;
  config: RoundConfig;
}

export const ROUND_CATEGORY_LABELS: Record<RoundCategory, string> = {
  agent: 'Agent / RAG',
  llm: 'LLM 原理',
  backend: '后端底座',
  delivery: '交付封装',
  project: '项目深挖',
  bonus: '拓展加分',
};

export const ROUND_CATEGORY_ORDER: RoundCategory[] = [
  'agent',
  'llm',
  'backend',
  'delivery',
  'project',
  'bonus',
];

/**
 * 一面默认 6 题：基础覆盖优先，项目题留到二面。
 * 这组数字不是“越多越好”，而是按面试官一面会追问的几条主线配的。
 */
export const FIRST_ROUND_CONFIG: RoundConfig = {
  agent: 2,
  llm: 1,
  backend: 2,
  delivery: 1,
  project: 0,
  bonus: 0,
};

/**
 * 二面默认 6 题：减少定义题，把预算挪给项目深挖和后端故障边界。
 */
export const SECOND_ROUND_CONFIG: RoundConfig = {
  agent: 1,
  llm: 1,
  backend: 2,
  delivery: 0,
  project: 2,
  bonus: 0,
};

export const CUSTOM_ROUND_CONFIG: RoundConfig = {
  agent: 2,
  llm: 1,
  backend: 1,
  delivery: 1,
  project: 1,
  bonus: 0,
};

export const ROUND_PRESETS: RoundPreset[] = [
  {
    key: 'first',
    label: '一面 · 基础筛',
    tagline: '概念、主链路、工程边界先过一遍',
    minutes: '约 30 分钟',
    config: FIRST_ROUND_CONFIG,
  },
  {
    key: 'second',
    label: '二面 · 深水区',
    tagline: '项目证据、故障路径、架构取舍加压',
    minutes: '约 35 分钟',
    config: SECOND_ROUND_CONFIG,
  },
  {
    key: 'custom',
    label: '自定义套卷',
    tagline: '自己配分组和题量，随机抽题不重复',
    minutes: '按题量计算',
    config: CUSTOM_ROUND_CONFIG,
  },
];

export function roundConfigTotal(config: RoundConfig): number {
  return ROUND_CATEGORY_ORDER.reduce((total, key) => total + Math.max(0, config[key]), 0);
}

export function roundConfigSummary(config: RoundConfig): string {
  return ROUND_CATEGORY_ORDER
    .filter((key) => config[key] > 0)
    .map((key) => `${ROUND_CATEGORY_LABELS[key]} ${config[key]}`)
    .join(' · ');
}

function categoryMatches(question: InterviewQuestionSummary, category: RoundCategory): boolean {
  if (category === 'project') return question.type === 'project';
  // 项目题单独走 project 槽位，避免同一道题既算后端又算项目。
  return question.group === category && question.type !== 'project';
}

/**
 * 按类别槽位抽题。某个类别题不够时，才从整套题库里补，保证套卷数量和去重。
 */
export function buildRoundQuestions(
  config: RoundConfig,
  questions: InterviewQuestionSummary[],
  random: () => number = Math.random,
): InterviewQuestionSummary[] {
  const wanted = Math.max(0, roundConfigTotal(config));
  const used = new Set<string>();
  const picked: InterviewQuestionSummary[] = [];

  for (const category of ROUND_CATEGORY_ORDER) {
    const count = Math.max(0, config[category]);
    const categoryPool = questions.filter((question) => categoryMatches(question, category));
    for (let index = 0; index < count; index += 1) {
      const available = categoryPool.filter((question) => !used.has(question.id));
      if (!available.length) break;
      const question = available[Math.floor(random() * available.length)];
      used.add(question.id);
      picked.push(question);
    }
  }

  if (picked.length < wanted) {
    const fallback = questions.filter((question) => !used.has(question.id));
    while (picked.length < wanted && fallback.length) {
      const index = Math.floor(random() * fallback.length);
      const question = fallback.splice(index, 1)[0];
      used.add(question.id);
      picked.push(question);
    }
  }

  // 一次抽题内部再打散顺序，避免每次都是同一组题从 Agent 开始。
  return picked
    .map((question) => ({ question, order: random() }))
    .sort((left, right) => left.order - right.order)
    .map((item) => item.question);
}
