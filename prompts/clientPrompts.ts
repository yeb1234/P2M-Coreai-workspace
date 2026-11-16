export interface PromptTemplatePreset {
  id: string;
  name: string;
  content: string;
  /** 一句话说明什么时候用 —— UI 上显示，让用户知道 AI 为什么这么答 */
  hint: string;
}

export const DEFAULT_AI_ENDPOINT = 'http://192.168.3.161:1234/v1/chat/completions';
export const DEFAULT_AI_MODEL = 'local-model';

export const DEFAULT_SYSTEM_PROMPT =
  '你是灵境小助手。只使用中文回答。回答优先简洁、直接、可执行。如果提供了视频检索结果，只在它们和用户问题明显相关时再引用；如果不相关，就忽略它们，不要强行推荐视频。不要复述推理过程，直接给最终回答。';

export const LOCAL_CORRECTION_PROMPT =
  '如果用户输入里有明显错别字、误识别词或大小写问题，但仍能理解原意，请按正常语义回答；不要为了纠错而改写用户问题。';

/**
 * 意图模板。
 *
 * 原来只有 3 个模板而且靠手动选，结果就是截图里那种
 * 「问课程推荐，顶部却显示学习总结」—— 用户不知道 AI 拿什么策略在答。
 *
 * 现在每个模板明确「什么时候用」，并且前端按用户问题自动识别意图。
 * 提示词的原则：说清**不要做什么**，比堆形容词有效。
 */
export const DEFAULT_PROMPT_TEMPLATES: PromptTemplatePreset[] = [
  {
    id: 'course-recommend',
    name: '课程推荐',
    hint: '挑课与观看顺序',
    content:
      '从视频库挑课，不要罗列所有沾边的。先判断用户目标与当前基础的差距，' +
      '再只推荐 2-3 门能补这个差距的：每门写清「为什么是它」和「先看哪一段（带时间点）」，' +
      '最后给总时间预算。库里没有合适的就直说，不要用通用知识编一门出来。',
  },
  {
    id: 'knowledge-qa',
    name: '知识问答',
    hint: '基于库内内容作答',
    content:
      '只依据视频库里讲过的内容回答，每条结论后面带视频名和时间点。' +
      '查不到就说「库里没有这个内容」，不要用通用知识补。先给结论，再给依据，不要铺垫。',
  },
  {
    id: 'learning-path',
    name: '路径规划',
    hint: '定下一步动作',
    content:
      '结合用户当前进度和未完成项，给出下一步唯一动作，不是一张清单。' +
      '说清为什么是这一步、做完的标志是什么。其他分支只在用户追问时展开。',
  },
  {
    id: 'study-summary',
    name: '学习总结',
    hint: '压成三层要点',
    content:
      '把内容压成三层：一句话结论 → 3-5 个关键点（每条带视频时间点）→ 下一步练什么。' +
      '不要复述原文，不要写「本文介绍了」。',
  },
  {
    id: 'coding-helper',
    name: '代码助手',
    hint: '最小修改方案',
    content:
      '先指出这段代码会出什么问题，再给最小修改。不要重写整个文件，' +
      '不要加没要求的抽象。中文回答。',
  },
  {
    id: 'task-planning',
    name: '任务拆解',
    hint: '拆成今日步骤',
    content:
      '把目标拆成今日可执行步骤，标出优先级、阻塞点和预计耗时。' +
      '只列今天能做完的，不要列三个月计划。',
  },
];

export const DEFAULT_SUBTITLE_CORRECTION_PROMPT =
  '根据上下文校对字幕文本，修正明显的识别错误、错别字、专有名词和技术词。保持原意，不扩写，不翻译，不合并或拆分字幕，不改变时间轴。';

/**
 * 从用户问题识别意图，返回模板 id；认不出来返回 null（用当前手动选的模板）。
 *
 * 顺序很关键：「怎么学」既含「怎么」（知识问答）又是路径规划，
 * 所以特殊模式必须排在通用模式前面。
 * 宁可认不出来（退回手动模板），也不要认错 —— 认错的代价比不认大。
 */
export function detectIntent(input: string): string | null {
  const text = (input || '').trim();
  if (!text) return null;

  // 课程推荐：有没有/推荐/找/适合 + 课/视频/教程
  if (
    /(?:有没有|有吗|推荐|找|适合|哪个|哪些|介绍).{0,20}(?:课|课程|视频|教程)/.test(text) ||
    /学(?:什么|哪个|哪门|哪些)/.test(text)
  ) {
    return 'course-recommend';
  }

  // 路径规划：比「怎么」更具体的模式，必须先判
  if (/(?:路径|路线|规划|下一步|接下来|先学|怎么学|从哪开始)/.test(text)) {
    return 'learning-path';
  }

  // 学习总结
  if (/(?:总结|梳理|回顾|概括|要点|归纳|复盘)/.test(text)) {
    return 'study-summary';
  }

  // 代码助手（含代码块直接判）
  if (/(?:代码|报错|bug|写个|写.*函数|函数.*报错|实现一下|```)/i.test(text)) {
    return 'coding-helper';
  }

  // 任务拆解
  if (/(?:拆解|拆成|计划|安排|todo|待办)/i.test(text)) {
    return 'task-planning';
  }

  // 知识问答：兜底
  if (/(?:怎么|为什么|是什么|讲过|哪里|如何|区别|原理)/.test(text)) {
    return 'knowledge-qa';
  }

  return null;
}

export function buildAIRequestSystemPrompt(systemPrompt: string, templateContent: string): string {
  return [
    systemPrompt.trim(),
    LOCAL_CORRECTION_PROMPT,
    templateContent.trim() ? `当前提示词模板：${templateContent.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}
