import type { AssistantPageContext } from './assistantPageContext';

// ─── 意图类型 ───

export type IntentType = 'search' | 'summary' | 'video_context' | 'learning_plan' | 'chat';

export interface IntentResult {
  type: IntentType;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  /** 前端 regex 的意图判断，传给后端 LLM 做参考 */
  intent_hint: IntentType;
}

// ─── 检索视频：明确的搜索关键词 ───

const SEARCH_PATTERNS: RegExp[] = [
  /^搜[索找]?/,
  /^找[到出]?/,
  /^查[找询]?/,
  /^检索/,
  /帮我[找搜查]/,
  /给我[找搜]/,
  /(?:有没有|有没有些|有没有点).*(?:视频|内容|资料|文章|信息|教程|课)/,
  /关于.*的.*(?:视频|内容|资料|文章|教程|课)/,
  /(?:查找|搜索|search|find)\b/i,
];

// ─── 视频上下文学习：明确针对当前视频的操作 ───

const VIDEO_CONTEXT_PATTERNS: RegExp[] = [
  /总结[一下]?/,
  /概括[一下]?/,
  /提炼[一下]?/,
  /归纳[一下]?/,
  /摘要/,
  /复盘[一下]?/,
  /(?:来个|给[份个]?|整理|梳理).*(?:要点|大纲|重点|精华|总结|摘要)/,
  /(?:讲讲|解释[一下]?|介绍[一下]?|说明[一下]?).*(?:这个|这节|这课|视频)/,
  /(?:这里|这段|这个|这节).*(?:讲[了的]?|说[了的]?|意思|内容|知识点)/,
  /(?:帮我|给[我我]).*(?:总结|梳理|整理|提炼)/,
  /(?:summarize|summary|outline)\b/i,
];

// ─── 学习路线规划 ───

const LEARNING_PLAN_PATTERNS: RegExp[] = [
  /学习路线/,
  /学习路径/,
  /学习计划/,
  /学习规划/,
  /学习指南/,
  /怎么学/,
  /如何学/,
  /从[哪哪]里.*学/,
  /(?:学[习习]?|入门|进阶|精通).*(?:路线|路径|计划|规划|指南|方向)/,
  /(?:应该|需要|想要|打算|想).*(?:学[习习]?|入门|进阶).*(?:什么|哪些|怎么)/,
  /(?:零基础|小白|初学者).*(?:怎么|如何|从哪)/,
  /推荐.*(?:学[习习]?|课程|教程|资源)/,
  /(?:learning|roadmap|study plan|learning path)\b/i,
];

// ─── 技术问题：有明确 IT 主题时走检索，而不是纯聊天 ───

const TECH_TERMS = /(?:Python|JavaScript|TypeScript|Java|Go|Golang|Rust|C\+\+|C#|PHP|Ruby|FastAPI|Django|Flask|Vue|React|Angular|Webpack|Vite|Node|Next\.?js|Nuxt|jQuery|MySQL|PostgreSQL|SQLite|Redis|MongoDB|Docker|Kubernetes|K8s|Linux|Git|JWT|REST|GraphQL|API|HTTP|TCP|CSS|HTML|DOM|闭包|装饰器|生成器|迭代器|协程|多线程|多进程|爬虫|数据结构|算法|数据库|索引|事务|缓存|消息队列|微服务|容器|镜像|虚拟DOM|组件|生命周期|钩子|路由|状态管理|依赖注入|中间件|接口|前后端|后端|前端|代码|编程|函数|变量|类|对象|报错|异常)/i;

const TECH_QUESTION_HINTS = /(?:什么是|是什么|什么意思|怎么|如何|怎样|原理|区别|对比|实现)/i;
const TECH_ERROR_HINTS = /(?:报错|异常|错误|失败|不生效|无法|崩了|挂了)/i;

// ─── 聊天：通用提问和对话 ───

const CHAT_PATTERNS: RegExp[] = [
  /^问[一下]?/,
  /为什么/,
  /怎么[做弄]?/,
  /如何[做弄实现配置部署]/,
  /什么是/,
  /什么意思/,
  /怎么样/,
  /好不好/,
  /行不行/,
  /对吗/,
  /讲讲(?!这个|这节|这课|视频)/,  // "讲讲"后面不跟"这个/这节"才走 chat
  /请教/,
  /请问/,
  /咨询/,
  /(?:what is|how to|why|what does|what are)\b/i,
];

// ─── 问候语 ───

const GREETINGS = new Set([
  '你好', '您好', '哈喽', '嗨', 'hello', 'hi', 'hey',
  '谢谢', '感谢', '多谢', 'thanks', 'thx',
  '再见', '拜拜', 'bye', 'goodbye',
]);

// ─── 主检测函数 ───

export function detectIntent(input: string, pageContext: AssistantPageContext): IntentResult {
  const text = input.trim();
  if (!text) return { type: 'chat', confidence: 'high', reason: '空输入', intent_hint: 'chat' };

  // 1. 问候语 → chat
  if (GREETINGS.has(text.toLowerCase())) {
    return { type: 'chat', confidence: 'high', reason: '问候语', intent_hint: 'chat' };
  }

  // 2. 学习路线规划（优先级高，因为关键词很明确）
  for (const p of LEARNING_PLAN_PATTERNS) {
    if (p.test(text)) return { type: 'learning_plan', confidence: 'high', reason: '学习路线关键词', intent_hint: 'learning_plan' };
  }

  // 3. 检索视频（明确搜索关键词）
  for (const p of SEARCH_PATTERNS) {
    if (p.test(text)) return { type: 'search', confidence: 'high', reason: '搜索关键词', intent_hint: 'search' };
  }

  // 4. 总结/概括模式（视频页 + 总结类关键词）→ summary
  if (pageContext.kind === 'video') {
    for (const p of VIDEO_CONTEXT_PATTERNS) {
      if (p.test(text)) return { type: 'summary', confidence: 'high', reason: '总结/概括关键词', intent_hint: 'summary' };
    }
  }

  // 5. 视频上下文学习（非总结类的视频页操作）→ video_context
  if (pageContext.kind === 'video') {
    // 这里可以放讲解类、介绍类等非总结操作
    // 当前 VIDEO_CONTEXT_PATTERNS 已在步骤 4 覆盖总结类，
    // 若后续拆分 patterns 可在此补充
  }

  // 5. 技术问题（有明确 IT 主题 + 疑问/实现意图）→ 检索
  //    原来的顺序会把“什么是闭包”“怎么配置 webpack”判成 chat，
  //    助手因此完全不检索个人视频库，只能凭模型记忆回答。
  if (TECH_TERMS.test(text) && (TECH_QUESTION_HINTS.test(text) || TECH_ERROR_HINTS.test(text))) {
    return { type: 'search', confidence: 'high', reason: '技术问题，走视频库检索', intent_hint: 'search' };
  }

  // 6. 通用提问关键词 → chat
  for (const p of CHAT_PATTERNS) {
    if (p.test(text)) return { type: 'chat', confidence: 'high', reason: '提问关键词', intent_hint: 'chat' };
  }

  // 7. 无明确关键词 → chat（不再猜测）
  return { type: 'chat', confidence: 'low', reason: '默认聊天', intent_hint: 'chat' };
}

// ─── 模板 ID 映射 ───

const INTENT_TO_TEMPLATE_IDS: Record<IntentType, string[]> = {
  search: ['video-search', 'content-search', 'search'],
  summary: ['content-summary', 'summary', 'study-summary'],
  video_context: ['video-context', 'video-study'],
  learning_plan: ['learning-plan', 'study-plan', 'learning'],
  chat: ['qa-question', 'question', 'qa'],
};

const INTENT_NAME_KEYWORDS: Record<IntentType, string[]> = {
  search: ['搜索', '检索', '查找', '内容搜索'],
  summary: ['总结', '概括', '摘要', '提炼'],
  video_context: ['讲解', '介绍', '说明', '视频学习'],
  learning_plan: ['学习路线', '学习计划', '学习规划', '路线'],
  chat: ['问答', '提问', '知识', '问题'],
};

export function getTemplateIdForIntent(
  intent: IntentType,
  availableTemplates: { id: string; name: string }[]
): string | null {
  for (const candidate of INTENT_TO_TEMPLATE_IDS[intent]) {
    const found = availableTemplates.find((t) => t.id === candidate);
    if (found) return found.id;
  }
  for (const keyword of INTENT_NAME_KEYWORDS[intent]) {
    const found = availableTemplates.find((t) => t.name.includes(keyword));
    if (found) return found.id;
  }
  return null;
}

// ─── 意图标签（UI 显示）───

export const INTENT_LABELS: Record<IntentType, string> = {
  search: '搜索',
  summary: '总结',
  video_context: '学习',
  learning_plan: '路线',
  chat: '聊天',
};
