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
    id: 'question-answer',
    name: '问题解答',
    hint: '通用知识讲清概念，可按需推荐视频',
    content:
      '用户在问一个具体的代码或技术概念，不是让你找站内视频。' +
      '先用通用知识直接回答，必要时给一个最小代码示例或类比，把关键点讲清楚；' +
      '不要声称「视频库里讲过」，也不要为了凑引用去检索视频。' +
      '如果用户还想进一步了解，可以在结尾自然引导：「如果你想更系统地看，我可以按这个方向给你推荐站内相关视频。」' +
      '不要虚构视频标题，不要把回答写成课程清单。中文回答，技术术语保留英文原名。',
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
  {
    id: 'interview-question',
    name: '面试题讲解',
    hint: '按当前题目讲、追问、找同类题',
    content:
      '当前页面是面试题库。用户问「这题 / 继续 / 展开 / 参考答案」时，默认指页面上已打开的题，不要反问是哪道。' +
      '先给答题骨架，再给 3-5 个关键点和易错点，最后给 1-2 个面试官可能追问的问题；不要直接粘贴整篇参考答案。' +
      '如果页面上下文缺完整答案、用户提到别的题，先按题号取题；要同类题或按分组/题型练习时检索题库；' +
      '问原理、版本演进、设计取舍时检索知识库，并保留来源。' +
      '只有用户明确要视频/课程/相关视频时才推荐站内视频，正文写《标题》和时间点；没有就直说，不要拿无关课程凑数。',
  },
  {
    id: 'note-save',
    name: '保存笔记',
    hint: '把当前笔记存进个人笔记库',
    content:
      '当前页面有 Markdown 笔记，用户明确要求保存。只保存原文时调用 save_note；' +
      '用户要求「总结后保存」时调用 summarize_and_save_note。两个工具都传 confirm=true，' +
      'content 留空让工具读取页面上的完整正文。不要改写原文，也不要把聊天回答当成笔记保存。' +
      '保存后用一句话告诉用户标题和结果，不要重复整篇正文。',
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
/**
 * 剥掉口语，只留下关键词 —— 意图判断吃这一版，不吃原始口语。
 *
 * 为什么：用户原话「查询改写第一步就是用正则把句子里口气、没用的地方
 * 截取掉，然后截取关键词来做意图判断」。
 *
 * 原始口语会直接污染意图判断：
 *   「那个啥，就是垃圾回收怎么弄来着」—— detectIntent 看到「怎么」，
 *   会判成知识问答（该走"找内容"而不是"问概念"）
 *   「帮我找一下有没有讲依赖注入的视频」—— 看到「有没有…视频」才判成
 *   课程推荐，但开头那串「帮我找一下」会干扰别的模式匹配
 *
 * 后端 backend/app/services/query_rewrite.py 有一份同源规则（用于检索）。
 * 两份必须保持一致 —— 改了这边记得同步那边，反之亦然。
 */
const LEADING_FILLERS: RegExp[] = [
  /^(?:那个|这个|呃|嗯|啊)/,
  /^(?:啥|什么)[，,、\s]*/,
  /^(?:就是|也就是说|就是说|其实是)/,
  /^(?:我想|我要|我想问|想问一下|想请教|请教一下|问一下|问下)/,
  /^(?:帮我|帮忙|麻烦)/,
  /^(?:找|查|搜|看看|看下|找找)[一下]*/,
  /^(?:一下|下)/,
  /^(?:有没有|有吗|能不能|可不可以)/,
  /^(?:好的?|那么|然后|所以)/,
  /^是(?=[^的吗呢])/,
];

const TAIL_FILLERS: RegExp[] = [
  /(?:怎么弄|怎么办|怎么搞|怎么用|咋整|咋办)(?:来着|呢|啊)?$/,
  /(?:是什么|是啥|什么意思|啥意思)(?:呢|啊)?$/,
  /(?:的东西|那种东西|之类的|什么的|啥的)$/,
  /(?:是啥|是啥来着|是什么来着|来着)$/,
  /[吧呢啊呀嘛哈喽]+$/,
  /[？?！!。.，,\s]+$/,
];

const MID_DEMONSTRATIVE = /(?:那个|这个)(?=[\u4e00-\u9fa5A-Za-z])/;
const PARTICLE = /[吧呢啊呀嘛哈喽]/;

export function extractIntentKeywords(input: string): string {
  let out = (input || '').trim();
  if (!out) return '';
  // 迭代剥离：链式口语一次删不干净（「那个啥，就是…」要剥三轮）
  for (let i = 0; i < 8; i += 1) {
    const before = out;
    for (const re of LEADING_FILLERS) out = out.replace(re, '').trim();
    for (const re of TAIL_FILLERS) out = out.replace(re, '').trim();
    out = out.replace(MID_DEMONSTRATIVE, '');
    out = out.replace(PARTICLE, '');
    out = out.replace(/^[，,、；;\s]+/, '').replace(/[，,、；;\s]+$/, '');
    out = out.replace(/\s{2,}/g, ' ');
    if (out === before) break;
  }
  return out.trim();
}

// 「问题解答」只接管具体的代码/技术概念题；找站内内容仍然走库内问答。
const TECH_TOPIC_RE =
  /(?:Python|JavaScript|TypeScript|Java|Golang|Go|Rust|C\+\+|C#|PHP|Ruby|FastAPI|Django|Flask|Vue|React|Angular|Node|Next\.?js|Nuxt|SQL|MySQL|PostgreSQL|SQLite|Redis|MongoDB|Docker|Kubernetes|K8s|Linux|Git|JWT|REST|GraphQL|API|HTTP|TCP|WebSocket|CSS|HTML|DOM|LangChain|LangGraph|RAG|LLM|Agent|GC|垃圾回收|装饰器|闭包|生成器|迭代器|协程|多线程|多进程|数据结构|算法|数据库|索引|事务|缓存|消息队列|微服务|容器|镜像|虚拟DOM|组件|生命周期|钩子|路由|状态管理|依赖注入|中间件|接口|前端|后端|代码|编程|函数|变量|类|对象|报错|异常)/i;

const TECH_QUESTION_RE =
  /(?:什么是|是什么|什么意思|为什么|怎么|如何|怎样|原理|机制|区别|对比|实现|作用|用法|概念|流程|特性|优缺点|哪个|哪些|选择|面试)/i;

const VIDEO_SEEKING_RE =
  /(?:视频|课程|教程|网课|哪一?节|第几[节课集]|哪一?集|(?:这|那)一集|讲过|有讲)/;

// 「保存刚才笔记 / 总结后存到笔记」：这是写操作，必须优先于普通总结与任务拆解。
// 只认明确的笔记保存说法，避免把「保存设置」「保存代码」误判成写笔记。
const NOTE_SAVE_RE =
  /(?:(?:保存|存到|存入|写进|写入|记到|放到|归档).{0,10}(?:笔记|md|markdown)|(?:笔记|md|markdown).{0,10}(?:保存|存到|存入|归档))/i;

export function detectIntent(input: string, pageKind?: string | null): string | null {
  // 先用剥完口语的关键词判断；剥空了（「那个是啥来着」）退回原文
  const keywords = extractIntentKeywords(input);
  const text = keywords || (input || '').trim();
  const raw = (input || '').trim();
  if (!text) return null;

  // 写笔记：先判，避免「保存刚才笔记」被「总结/复盘」或兜底意图吃掉工具。
  if (NOTE_SAVE_RE.test(raw) || (/(?:总结|摘要)/.test(text) && /(?:保存|存起来|存到|归档)/.test(raw))) {
    return 'note-save';
  }

  // 面试题讲解：页面上下文优先。用户在题目页说「这题/继续/展开」，
  // 不该被课程推荐或通用知识问答抢走；但「怎么学」仍归路径规划。
  if (pageKind === 'interview') {
    if (
      /(?:这题|这道题|当前题|本页|这页|题目|题干|参考答案|标准答案|怎么答|答题|讲讲|展开|继续讲|追问|考点|评分点|评分|下一题|再来一题|同类题|相关视频|视频推荐)/.test(raw) ||
      /^(?:继续|展开|再讲|再讲讲|为什么|怎么说|还有呢|然后呢|这题呢|不会|没思路|给点提示|提示一下)[？?！!。.\s]*$/.test(raw)
    ) {
      return 'interview-question';
    }
  }

  // 路径规划：先判，避免「先学什么」被课程正则里的「学什么」吃掉
  if (/(?:路径|路线|规划|下一步|接下来|先学|怎么学|从哪开始)/.test(text)) {
    return 'learning-path';
  }

  // 课程推荐：有没有/推荐/找/适合 + 课/视频/教程
  // 用原文而不是剥完口语的 keywords：像「有没有好的视频推荐」这种，
  // 关键词清洗会把「有没有」和句尾「推荐」都剥掉，只剩「好的视频」。
  if (
    /(?:有没有|有吗|推荐|找|适合|哪个|哪些|介绍).{0,20}(?:课|课程|视频|教程)/.test(raw) ||
    /(?:课|课程|视频|教程).{0,6}(?:推荐|总结)/.test(raw) ||
    /学(?:什么|哪个|哪门|哪些)/.test(text)
  ) {
    return 'course-recommend';
  }

  // 学习总结。除了显式的「总结/复盘」，还要认「学得怎么样」这类
  // 口语化问法 —— 用户截图里问「总结我学得怎么样」被兜底成了知识问答，
  // 结果甩出三条不相关视频片段。这类问题要归到总结，才不会触发视频推荐。
  if (
    /(?:总结|梳理|回顾|概括|要点|归纳|复盘)/.test(text) ||
    /(?:学得|学的|学习).{0,4}(?:怎么样|如何|怎样|情况|进展|进度|效果)/.test(text) ||
    /(?:掌握|进步|提高).{0,4}(?:多少|怎么样|怎样|如何|情况)/.test(text)
  ) {
    return 'study-summary';
  }

  // 代码助手（含代码块直接判）
  if (/(?:代码|报错|bug|写个|写.*函数|函数.*报错|实现一下|```)/i.test(text)) {
    return 'coding-helper';
  }

  // 问题解答：用户问的是具体的代码/技术概念，直接讲知识，不先检索视频库。
  // 只要问题里出现「视频/课程/讲过」这类找库信号，就仍然交给库内问答，
  // 避免把「哪个视频讲过装饰器」误判成通用答疑。
  if (VIDEO_SEEKING_RE.test(raw)) {
    return 'knowledge-qa';
  }
  if (
    TECH_TOPIC_RE.test(raw) &&
    (TECH_QUESTION_RE.test(raw) || TECH_QUESTION_RE.test(text))
  ) {
    return 'question-answer';
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
