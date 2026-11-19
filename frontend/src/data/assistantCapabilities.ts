/**
 * 灵境小助手「实际接线」的展示数据。
 *
 * 这里只放“页面怎么讲”，不放运行时实现：
 * - 意图、能力包、工具的真实清单优先从 `/api/assistant/capabilities` 读取；
 * - MCP 工具清单从 `/api/mcp/tools` 读取；
 * - 下面这些是接口不可用时的内置快照，以及意图的中文标签/触发条件。
 *
 * 这样页面不会再拿六张通用场景卡冒充完整能力，也不会因为后端加了
 * 一个工具就出现“页面写着 10 个、实际有 11 个”的漂移。
 */

export interface AssistantIntentCopy {
  id: string;
  label: string;
  skill: string;
  /** 一句话讲清这个分支到底做什么 */
  summary: string;
  /** 用户说什么会触发它 */
  triggers: string[];
  /** 回答最终交付什么 */
  output: string;
  accent: string;
  write?: boolean;
}

export const ASSISTANT_INTENTS: AssistantIntentCopy[] = [
  {
    id: 'note-save',
    label: '保存笔记',
    skill: 'note-library',
    summary: '当前页有 MD 笔记时，把原文保存；或先做 AI 总结，再把总结另存为私人笔记。',
    triggers: ['保存刚才笔记', '存到笔记', '总结后保存', '归档 Markdown'],
    output: '私人笔记；写操作必须 confirm=true',
    accent: '#b45309',
    write: true,
  },
  {
    id: 'learning-path',
    label: '路径规划',
    skill: 'learning-planning',
    summary: '结合学习目标、当前路径和未完成步骤，给下一步唯一动作，不甩一张长清单。',
    triggers: ['下一步学什么', '学习路径', '从哪开始', '怎么学'],
    output: '一个动作 + 为什么是它 + 完成标志',
    accent: '#0f766e',
  },
  {
    id: 'course-recommend',
    label: '课程推荐',
    skill: 'course-discovery',
    summary: '从本地视频库里挑 2-3 门真正补差距的课，每门给理由和先看的时间段。',
    triggers: ['有没有课', '推荐视频', '学什么', '适合我的教程'],
    output: '课程清单 + 时间预算 + 为什么是它',
    accent: '#7c3aed',
  },
  {
    id: 'study-summary',
    label: '学习总结',
    skill: 'learning-review',
    summary: '读取真实观看数据、完成率、专注时长、投入领域和活跃时段，做有数据的复盘。',
    triggers: ['学得怎么样', '总结一下', '复盘', '掌握多少'],
    output: '结论 + 3-5 个数据点 + 下一步练习',
    accent: '#0369a1',
  },
  {
    id: 'coding-helper',
    label: '代码助手',
    skill: 'coding-helper',
    summary: '代码报错或实现问题，先查站内讲解，再查历史笔记，最后给最小修改。',
    triggers: ['报错', 'bug', '写个函数', '这段代码'],
    output: '问题点 + 最小 diff + 验证方法',
    accent: '#be123c',
  },
  {
    id: 'knowledge-qa',
    label: '知识问答',
    skill: 'knowledge-lookup',
    summary: '只在本地视频库里找内容；结论带《标题》和时间点，0 命中就如实说没有。',
    triggers: ['哪个视频讲过', '找片段', '课程里有没有', '哪一集'],
    output: '结论 + 视频引用 + 替代建议',
    accent: '#2563eb',
  },
  {
    id: 'question-answer',
    label: '问题解答',
    skill: 'general-answer',
    summary: '具体技术概念用通用知识讲清；该能力包零工具，正文不依赖视频库。',
    triggers: ['什么是 X', '原理', '区别', '怎么实现', '面试'],
    output: '概念 + 最小示例 + 可选延伸推荐',
    accent: '#4f46e5',
  },
  {
    id: 'interview-question',
    label: '面试题讲解',
    skill: 'interview-coach',
    summary: '站在当前面试题上读题号、题干、评分点和追问；可继续讲、找同类题、查知识库，按需推荐站内视频。',
    triggers: ['这题怎么答', '展开讲讲', '继续', '评分点', '下一题', '推荐相关视频'],
    output: '答题骨架 + 关键点/易错点 + 追问 + 可选同类题/视频',
    accent: '#0f766e',
  },
  {
    id: 'task-planning',
    label: '任务拆解',
    skill: 'task-planning',
    summary: '把学习目标拆成今天能做完的步骤，读取目标和路径，必要时参考历史笔记。',
    triggers: ['拆解', '拆成', '计划', '安排', 'todo', '待办'],
    output: '今日步骤 + 优先级 + 阻塞点 + 耗时',
    accent: '#ca8a04',
  },
  {
    id: 'fallback',
    label: '兜底分流',
    skill: 'fallback',
    summary: '意图为空或规则没命中时的保守能力包，只允许只读检索，不做写操作。',
    triggers: ['未命中任何规则', '模糊问题'],
    output: '保守回答；必要时只读检索',
    accent: 'var(--text-muted)',
  },
];

export interface IntentPriorityRule {
  id: string;
  label: string;
  condition: string;
  skill: string;
  note?: string;
}

/** 与 configs/prompts/clientPrompts.ts 的 detectIntent() 顺序保持一致。 */
export const INTENT_PRIORITY: IntentPriorityRule[] = [
  {
    id: 'note-save',
    label: '保存笔记',
    condition: '保存/存到/写入/归档 + 笔记、md、markdown；或“总结” + “保存”同时出现。',
    skill: 'note-library',
    note: '先判写操作，避免被“总结”或“任务拆解”吃掉工具。',
  },
  {
    id: 'interview-question',
    label: '面试题讲解（题库页）',
    condition: '页面是面试题库，且问题出现这题/当前题/参考答案/展开/追问/下一题/相关视频；或页面上的短追问。',
    skill: 'interview-coach',
    note: '排在写操作之后、路径规划之前：题目页上的「继续/展开」不能被课程推荐或通用问答抢走。',
  },
  {
    id: 'learning-path',
    label: '路径规划',
    condition: '路径、路线、规划、下一步、接下来、先学、怎么学、从哪开始。',
    skill: 'learning-planning',
  },
  {
    id: 'course-recommend',
    label: '课程推荐',
    condition: '有没有/推荐/找/适合 + 课/视频/教程；或“学什么/哪门/哪些”。',
    skill: 'course-discovery',
  },
  {
    id: 'study-summary',
    label: '学习总结',
    condition: '总结、梳理、回顾、复盘、学得怎么样、掌握多少。',
    skill: 'learning-review',
  },
  {
    id: 'coding-helper',
    label: '代码助手',
    condition: '代码、报错、bug、写个函数、函数报错、代码块。',
    skill: 'coding-helper',
  },
  {
    id: 'knowledge-qa',
    label: '知识问答（显式找库）',
    condition: '问题里出现视频、课程、教程、哪一节、第几集、讲过、有讲。',
    skill: 'knowledge-lookup',
    note: '优先于通用问题解答，避免把“哪个视频讲过装饰器”误判成纯答疑。',
  },
  {
    id: 'question-answer',
    label: '问题解答',
    condition: '技术主题词 + 什么是/为什么/怎么/原理/区别/实现/面试等问法。',
    skill: 'general-answer',
    note: '零工具能力包；不检索视频，不声称站内讲过。',
  },
  {
    id: 'task-planning',
    label: '任务拆解',
    condition: '拆解、拆成、计划、安排、todo、待办。',
    skill: 'task-planning',
  },
  {
    id: 'knowledge-qa',
    label: '知识问答（兜底）',
    condition: '怎么、为什么、是什么、哪里、如何、区别、原理。',
    skill: 'knowledge-lookup',
  },
  {
    id: 'null',
    label: '未识别',
    condition: '以上规则都没命中。',
    skill: 'fallback',
    note: '走保守只读包，不暴露写工具。',
  },
];

export interface PageContextFeature {
  page: string;
  context: string;
  actions: string;
}

/** 当前已经接线的页面上下文；和 assistantPageContext.ts 的 kind 对应。 */
export const PAGE_CONTEXT_FEATURES: PageContextFeature[] = [
  {
    page: '视频页',
    context: '当前视频标题、摘要、字幕与时间轴',
    actions: '总结本段、解释术语、找相关片段、基于内容记笔记',
  },
  {
    page: '便签 / 笔记',
    context: '当前便签或 Markdown 正文；笔记页可单独保存全文',
    actions: '围绕当前内容检索、整理、总结后保存',
  },
  {
    page: '面试题库',
    context: '当前题号、题型、题干、评分点、追问和参考答案开头',
    actions: '讲题、追问、找同类题、查知识库、按需推荐视频',
  },
  {
    page: '学习路径',
    context: '当前 STEP、完成状态与未完成项',
    actions: '下一步动作、调整节奏、解释为什么是这一步',
  },
];

export interface RuntimePromptLayer {
  title: string;
  source: string;
  description: string;
}

/** 与 backend/app/agents/chat_agent.py 的 build_system_prompt() 拼装顺序一致。 */
export const RUNTIME_PROMPT_LAYERS: RuntimePromptLayer[] = [
  {
    title: '基础人设与硬规则',
    source: 'BASE_PROMPT',
    description: '学习教练身份、中文回答、引用必须带《标题》和时间点、0 命中不编造、生活/健康不检索、纯消遣一句话回应。',
  },
  {
    title: '用户自定义要求',
    source: 'system_prompt_extra',
    description: '就是上面「系统提示词」输入框里的内容。它只是运行时提示词的一层，不是全部。',
  },
  {
    title: '学习者真实数据',
    source: 'get_profile_data()',
    description: '累计观看、完成率、专注时长、投入领域、活跃时段；回答“学得怎么样”前必须读。',
  },
  {
    title: '用户档案 + 助手设定',
    source: 'read_user_settings()',
    description: '昵称、职业、目标、每周可投入、时区、语气、主动程度、是否引用来源。',
  },
  {
    title: '长期记忆',
    source: 'memory_text()',
    description: '用户已确认的事实与偏好，最多取 10 条；跨会话保持连续性。',
  },
  {
    title: '当前学习路径',
    source: 'active_path_text()',
    description: '用户确认过的步骤与节奏，优先级高于模型临场发挥；回答“下一步”时先对齐它。',
  },
  {
    title: '当前页面上下文',
    source: 'page_context',
    description: '当前页面标题/正文；面试题库页会带当前题号、题型、题干、评分点、追问和参考答案开头，后端最多取 2200 字。',
  },
  {
    title: '本轮意图规则',
    source: 'intent',
    description: '按 detectIntent() 结果补规则：问题解答零工具；保存笔记必须 confirm；知识问答只依据库内内容；面试题讲解可查题库/知识库。',
  },
];

export interface AssistantToolSnapshot {
  name: string;
  description: string;
  scopes: string[];
  timeout_s: number;
  max_calls_per_turn: number;
  requires_login: boolean;
  read_only: boolean;
  enabled: boolean;
  version: string;
}

/** `/api/assistant/capabilities` 不可用时的只读快照。 */
export const TOOL_SNAPSHOT: AssistantToolSnapshot[] = [
  {
    name: 'search_videos',
    description: '在本地视频库中混合检索讲解片段，返回标题、时间段和相关度。',
    scopes: ['library:read'],
    timeout_s: 20,
    max_calls_per_turn: 2,
    requires_login: false,
    read_only: true,
    enabled: true,
    version: '1.0.0',
  },
  {
    name: 'search_video_titles',
    description: '按标题找课程/视频，返回可选视频清单。',
    scopes: ['library:read'],
    timeout_s: 8,
    max_calls_per_turn: 2,
    requires_login: false,
    read_only: true,
    enabled: true,
    version: '1.0.0',
  },
  {
    name: 'get_video_summary',
    description: '获取某个视频的摘要、时长、分类和字幕状态。',
    scopes: ['library:read'],
    timeout_s: 8,
    max_calls_per_turn: 2,
    requires_login: false,
    read_only: true,
    enabled: true,
    version: '1.0.0',
  },
  {
    name: 'get_learning_profile',
    description: '读取学习画像：累计观看时长、完成率、专注时长、投入最多的领域、活跃时段。',
    scopes: ['profile:read'],
    timeout_s: 10,
    max_calls_per_turn: 1,
    requires_login: true,
    read_only: true,
    enabled: true,
    version: '1.0.0',
  },
  {
    name: 'get_recent_activity',
    description: '最近 N 天的观看与学习活动，用于回答“我最近看了什么”。',
    scopes: ['profile:read'],
    timeout_s: 10,
    max_calls_per_turn: 1,
    requires_login: true,
    read_only: true,
    enabled: true,
    version: '1.0.0',
  },
  {
    name: 'get_learning_goal',
    description: '读取当前学习目标与已有学习路径的进度。',
    scopes: ['learning:read'],
    timeout_s: 8,
    max_calls_per_turn: 1,
    requires_login: true,
    read_only: true,
    enabled: true,
    version: '1.0.0',
  },
  {
    name: 'get_my_learning_path',
    description: '读取正在推进的学习路径：每步做什么、进度、绑定的视频。',
    scopes: ['learning:read'],
    timeout_s: 8,
    max_calls_per_turn: 1,
    requires_login: true,
    read_only: true,
    enabled: true,
    version: '1.0.0',
  },
  {
    name: 'recommend_next_videos',
    description: '基于学习画像推荐接下来该看什么；优先未看过、方向一致、非入门级。',
    scopes: ['library:read', 'profile:read', 'learning:read'],
    timeout_s: 20,
    max_calls_per_turn: 1,
    requires_login: true,
    read_only: true,
    enabled: true,
    version: '1.0.0',
  },
  {
    name: 'search_notes',
    description: '在历史学习笔记中检索；shared 可看，private 只有本人可看。',
    scopes: ['notes:read'],
    timeout_s: 8,
    max_calls_per_turn: 1,
    requires_login: true,
    read_only: true,
    enabled: true,
    version: '1.0.0',
  },
  {
    name: 'search_interview_questions',
    description: '检索本地结构化面试题库，返回题号、题型、难度和题干开头。',
    scopes: ['interview:read'],
    timeout_s: 8,
    max_calls_per_turn: 2,
    requires_login: false,
    read_only: true,
    enabled: true,
    version: '1.0.0',
  },
  {
    name: 'get_interview_question',
    description: '按题号或标题取完整题干、评分点、追问和参考答案。',
    scopes: ['interview:read'],
    timeout_s: 8,
    max_calls_per_turn: 2,
    requires_login: false,
    read_only: true,
    enabled: true,
    version: '1.0.0',
  },
  {
    name: 'search_interview_knowledge',
    description: '检索面试知识库专题文章，返回摘要、正文节选和来源链接。',
    scopes: ['interview:read', 'knowledge:read'],
    timeout_s: 8,
    max_calls_per_turn: 2,
    requires_login: false,
    read_only: true,
    enabled: true,
    version: '1.0.0',
  },
  {
    name: 'save_note',
    description: '把当前 MD 笔记或给定正文保存到个人笔记库；必须用户明确确认。',
    scopes: ['notes:write'],
    timeout_s: 12,
    max_calls_per_turn: 1,
    requires_login: true,
    read_only: false,
    enabled: true,
    version: '1.0.0',
  },
  {
    name: 'summarize_and_save_note',
    description: '对当前 MD 笔记做 AI 总结，并把总结另存为新的私人笔记；必须用户明确确认。',
    scopes: ['notes:write', 'notes:ai'],
    timeout_s: 70,
    max_calls_per_turn: 1,
    requires_login: true,
    read_only: false,
    enabled: true,
    version: '1.0.0',
  },
];

export interface AssistantSkillSnapshot {
  name: string;
  version: string;
  description: string;
  intents: string[];
  tools: string[];
  max_total_tool_calls: number;
}

/** `/api/assistant/capabilities` 不可用时的能力包快照。 */
export const SKILL_SNAPSHOT: AssistantSkillSnapshot[] = [
  {
    name: 'general-answer',
    version: '1.0.0',
    description: '纯知识/代码讲解，正文不依赖本地视频库，不挂检索工具。',
    intents: ['question-answer'],
    tools: [],
    max_total_tool_calls: 0,
  },
  {
    name: 'knowledge-lookup',
    version: '1.0.0',
    description: '在本地视频库里找某节课、某个片段或某个视频的摘要。',
    intents: ['knowledge-qa'],
    tools: ['search_videos', 'search_video_titles', 'get_video_summary'],
    max_total_tool_calls: 4,
  },
  {
    name: 'course-discovery',
    version: '1.0.0',
    description: '用户明确要课程/视频推荐时，先看学习目标，再检索候选。',
    intents: ['course-recommend'],
    tools: ['recommend_next_videos', 'search_videos', 'search_video_titles', 'get_video_summary'],
    max_total_tool_calls: 4,
  },
  {
    name: 'learning-review',
    version: '1.0.0',
    description: '复盘学习情况：画像、最近活动、当前路径与目标。',
    intents: ['study-summary'],
    tools: ['get_learning_profile', 'get_recent_activity', 'get_my_learning_path', 'get_learning_goal'],
    max_total_tool_calls: 4,
  },
  {
    name: 'learning-planning',
    version: '1.0.0',
    description: '制定或调整学习路径，基于已有目标和路径做增量规划。',
    intents: ['learning-path'],
    tools: ['get_learning_goal', 'get_my_learning_path', 'recommend_next_videos', 'search_videos'],
    max_total_tool_calls: 4,
  },
  {
    name: 'coding-helper',
    version: '1.0.0',
    description: '具体代码问题：优先本地视频讲解，其次历史笔记。',
    intents: ['coding-helper'],
    tools: ['search_videos', 'search_video_titles', 'search_notes'],
    max_total_tool_calls: 4,
  },
  {
    name: 'task-planning',
    version: '1.0.0',
    description: '把学习任务拆成可执行步骤，读取目标与路径，必要时参考笔记。',
    intents: ['task-planning'],
    tools: ['get_learning_goal', 'get_my_learning_path', 'search_notes'],
    max_total_tool_calls: 3,
  },
  {
    name: 'interview-coach',
    version: '1.0.0',
    description: '当前面试题讲解、同类题检索、知识库检索，并按需推荐站内视频。',
    intents: ['interview-question'],
    tools: [
      'get_interview_question',
      'search_interview_questions',
      'search_interview_knowledge',
      'search_videos',
      'get_video_summary',
    ],
    max_total_tool_calls: 5,
  },
  {
    name: 'note-library',
    version: '1.0.0',
    description: '用户明确要求保存当前 MD 笔记，或总结后另存为私人笔记。',
    intents: ['note-save'],
    tools: ['save_note', 'summarize_and_save_note'],
    max_total_tool_calls: 2,
  },
  {
    name: 'fallback',
    version: '1.0.0',
    description: '意图为空或无法识别时的保守能力包：只允许只读检索。',
    intents: [],
    tools: ['search_videos', 'search_video_titles', 'get_video_summary'],
    max_total_tool_calls: 3,
  },
];

export const TOOL_LABELS: Record<string, string> = {
  search_videos: '视频片段检索',
  search_video_titles: '按标题找课',
  get_video_summary: '视频摘要',
  get_learning_profile: '学习画像',
  get_recent_activity: '最近学习活动',
  get_learning_goal: '学习目标',
  get_my_learning_path: '当前学习路径',
  recommend_next_videos: '下一步推荐',
  search_notes: '历史笔记检索',
  search_interview_questions: '题库检索',
  get_interview_question: '取完整题目',
  search_interview_knowledge: '知识库检索',
  save_note: '保存当前笔记',
  summarize_and_save_note: '总结后另存',
};

export const MCP_TOTAL_SNAPSHOT = 19;

export interface McpToolCopy {
  name: string;
  title: string;
  description: string;
  destructive: boolean;
  readOnly: boolean;
}

/** MCP 原生 AI/写操作工具；页面只展开这 6 个，其余只读 Agent 工具只显示计数。 */
export const MCP_NATIVE_TOOLS: McpToolCopy[] = [
  {
    name: 'note_summarize',
    title: '总结笔记',
    description: '把 Markdown 笔记压缩成 3-6 条复习要点，并给一个下一步动作。只读，不写笔记。',
    destructive: false,
    readOnly: true,
  },
  {
    name: 'note_polish',
    title: '润色笔记',
    description: '重写 Markdown 笔记，保留事实、代码块和结构，输出更清楚紧凑的正文。只读，不写笔记。',
    destructive: false,
    readOnly: true,
  },
  {
    name: 'note_detect_actions',
    title: '从笔记抽取待办和日程',
    description: '抽取明确的待办和日程建议，只返回建议，不创建任何记录；创建必须由用户确认。',
    destructive: false,
    readOnly: true,
  },
  {
    name: 'note_create',
    title: '保存私人笔记',
    description: '用户确认后把正文保存为当前用户的私人笔记；可附带 summary，写成「AI 总结 + 原文」。',
    destructive: true,
    readOnly: false,
  },
  {
    name: 'todo_create',
    title: '创建待办',
    description: '用户确认后创建一条待办；没有明确时间时不擅自占用日程时段。',
    destructive: true,
    readOnly: false,
  },
  {
    name: 'calendar_create',
    title: '创建日历日程',
    description: '用户确认后创建一条日程；日期和时间必须来自用户或笔记中的明确安排。',
    destructive: true,
    readOnly: false,
  },
];

