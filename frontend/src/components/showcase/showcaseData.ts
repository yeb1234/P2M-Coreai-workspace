export interface ShowcaseSegment {
  time: string;
  text: string;
}

export interface ShowcaseChapter {
  time: string;
  title: string;
}

export interface ShowcaseVideo {
  id: string;
  title: string;
  duration: string;
  folder: string;
  cover: string;
  status: string;
  score: number;
  hitAt: string;
  hitText: string;
  summary: string;
  tags: string[];
  chapters: ShowcaseChapter[];
  transcript: ShowcaseSegment[];
  advice: {
    headline: string;
    body: string;
    actions: string[];
  };
}

export interface ShowcaseQuery {
  label: string;
  value: string;
  hint: string;
}

/**
 * Lite 视频预览用的静态样例。
 *
 * 标题、目录和时长取自本机 P2 Media 的真实视频库；命中时间与建议是为了
 * 演示交互写的样例文案。真实搜索、播放和字幕时间轴只在 P2 Media 发生。
 */
export const SHOWCASE_QUERIES: ShowcaseQuery[] = [
  { label: 'FastAPI 多 Agent', value: 'FastAPI 多 Agent', hint: '标题 + 字幕混合排序' },
  { label: 'RAG 召回', value: 'RAG 召回', hint: '语义命中优先' },
  { label: 'LangChain MCP', value: 'LangChain MCP', hint: '工具调用链路' },
  { label: 'Agent 记忆', value: 'Agent 记忆', hint: '按章节定位' },
];

export const SHOWCASE_VIDEOS: ShowcaseVideo[] = [
  {
    id: '40676',
    title: '8-3 多Agent系统可视化配置API设计与开发',
    duration: '31:00',
    folder: 'MCP+A2A 多Agent全栈 / 第8章 LLM模块',
    cover: '/demo-video/fastapi-agent.jpg',
    status: 'AI 已总结',
    score: 94,
    hitAt: '12:40',
    hitText: 'FastAPI 的 Depends 负责把配置仓库注入路由，路由本身不关心 YAML 存在哪里。',
    summary: '从 LangChain 配置 CRUD 切入，用 FastAPI、领域模型和仓库模式把“模型配置”从路由里解耦出来。',
    tags: ['fastapi', 'api', '多agent', '配置', '依赖注入', 'repository', 'yaml'],
    chapters: [
      { time: '02:10', title: '配置对象与领域模型' },
      { time: '06:45', title: 'FastAPI 路由与依赖注入' },
      { time: '12:40', title: 'Repository 模式与文件锁' },
      { time: '22:10', title: '任务状态与后台运行' },
    ],
    transcript: [
      { time: '04:12', text: '配置不要直接写在路由里，先收敛成领域模型，路由只负责把请求转成一次业务动作。' },
      { time: '12:40', text: 'Depends 只负责装配，具体存储放在 repository 里；换 YAML、换数据库都不应该改路由。' },
      { time: '15:05', text: 'YAML 写入要加文件锁，避免两个请求同时改同一份配置，最后一个覆盖前一个。' },
      { time: '22:36', text: '长任务交给后台 worker，接口只返回任务 id，不要让 HTTP 请求一直挂着等模型跑完。' },
    ],
    advice: {
      headline: '先补 12:40–18:20，这一段正好补你项目里的依赖边界。',
      body: '你在 P2 Lite 里已经把数据库会话、笔记服务和 Agent 工具拆开了，但 FastAPI 的 Depends 还没有形成统一入口。看完这段再回去收口，比继续加接口更有收益。',
      actions: ['看完 12:40 的 Repository 段', '把 db session 收进 Depends', '用一条笔记记下 YAML 文件锁的取舍'],
    },
  },
  {
    id: '50182',
    title: 'DAY04_15_langchain使用MCP',
    duration: '27:07',
    folder: 'LangChain / day04',
    cover: '/demo-video/langchain-mcp.jpg',
    status: 'AI 已总结',
    score: 91,
    hitAt: '08:20',
    hitText: 'MCP server 通过 Streamable HTTP 挂到 ASGI，Agent 只拿到工具描述，不直接碰具体实现。',
    summary: '用 Streamable HTTP 把 MCP server 挂到 ASGI，演示 Agent 如何通过工具 schema 调用外部能力。',
    tags: ['mcp', 'langchain', 'agent', '工具', 'streamable http', 'asgi'],
    chapters: [
      { time: '03:20', title: 'MCP server 启动' },
      { time: '08:20', title: '挂到 ASGI 与 transport' },
      { time: '14:10', title: 'Agent 如何看到工具' },
      { time: '21:30', title: '接第三方 MCP' },
    ],
    transcript: [
      { time: '08:20', text: 'mcp.settings.host 指定监听地址，run 的时候把 transport 设成 streamable-http。' },
      { time: '14:10', text: 'Agent 看到的是工具 schema，不是 Python 函数；所以描述写得含糊，模型就会乱选。' },
      { time: '21:30', text: '接第三方 MCP 之前先做能力白名单，不然工具越多，路由越容易跑偏。' },
    ],
    advice: {
      headline: '把 MCP 工具描述当 API 合同来写，不要只写“查询数据”。',
      body: '你的 Lite 已经有 11 个 MCP 工具，清单是对的，但工具描述还可以更像合同：输入范围、返回字段、失败语义写清楚，模型选错工具的概率会明显下降。',
      actions: ['重读一个工具 schema', '补失败语义', '给写工具加权限边界'],
    },
  },
  {
    id: '50144',
    title: 'DAY02_14_RAG_介绍',
    duration: '13:53',
    folder: 'LangChain / day02',
    cover: '/demo-video/rag-intro.jpg',
    status: 'AI 已总结',
    score: 88,
    hitAt: '03:10',
    hitText: 'RAG 先检索外部知识，再把命中的片段拼进提示词，解决知识缺失和幻觉。',
    summary: 'RAG 的两阶段：索引（加载、切分、嵌入、存储）与检索生成（召回、拼接、生成），以及常见失败点。',
    tags: ['rag', '检索', 'embedding', '向量', '幻觉', '召回'],
    chapters: [
      { time: '03:10', title: '为什么需要 RAG' },
      { time: '06:30', title: '索引四步' },
      { time: '09:45', title: '检索生成链路' },
      { time: '12:20', title: '常见失败点' },
    ],
    transcript: [
      { time: '03:10', text: '模型不知道你私有的知识，先查再答，查不到就承认查不到。' },
      { time: '06:30', text: '文档加载、切分、embedding、入库，这四步决定后面能召回什么。' },
      { time: '09:45', text: 'query 改写、召回、重排、拼 prompt，任何一步塌了，最后都会答得很像样但不对。' },
      { time: '12:20', text: '召回错了，后面总结再漂亮也没用；先测召回，再调生成。' },
    ],
    advice: {
      headline: '你缺的不是再学一个框架，是把召回质量单独量出来。',
      body: '你已经能跑 RAG 链路，但笔记里还没有 recall@k 和 faithfulness 的记录。先做 20 条查询的小评测集，比继续换 embedding 模型更快看到瓶颈。',
      actions: ['挑 20 条真实问题', '记录 recall@5', '用 RAGAS 拆开 faithfulness 与 context recall'],
    },
  },
  {
    id: '50160',
    title: 'DAY03_10_使用milvus进行向量检索',
    duration: '44:51',
    folder: 'LangChain / day03',
    cover: '/demo-video/milvus-search.jpg',
    status: 'AI 已总结',
    score: 84,
    hitAt: '20:30',
    hitText: 'collection、index、metric、top-k 四件事定完，向量检索才可复现。',
    summary: 'Milvus 的 collection schema、索引类型、度量方式、元数据过滤和 top-k 检索完整走一遍。',
    tags: ['milvus', '向量', '检索', '索引', 'topk', 'metadata'],
    chapters: [
      { time: '05:20', title: 'Collection 与 schema' },
      { time: '12:00', title: '索引类型' },
      { time: '20:30', title: 'Search 与 top-k' },
      { time: '33:10', title: '元数据过滤' },
    ],
    transcript: [
      { time: '12:00', text: '索引不是越多越好，先看数据规模和查询延迟，再决定 IVF 还是 HNSW。' },
      { time: '20:30', text: 'top-k 不是越大越好，k 变大以后噪声也会一起进来，重排要跟上。' },
      { time: '33:10', text: '元数据过滤最好在检索前收窄范围，别把全库召回后再用 Python 过滤。' },
    ],
    advice: {
      headline: '把 top-k 和重排一起调，不要只盯召回条数。',
      body: '你现在的检索已经有 rerank，但还没有按查询类型记录 k 值。先用 10 条“精确术语”和 10 条“口语问题”分开测，确认 k 值不是拍脑袋定的。',
      actions: ['按查询类型分两组', '记录 k=5/10/20 的命中', '把重排前后对比写进评测'],
    },
  },
  {
    id: '50175',
    title: 'DAY04_09_agent当中如何添加记忆',
    duration: '11:13',
    folder: 'LangChain / day04',
    cover: '/demo-video/agent-memory.jpg',
    status: 'AI 已总结',
    score: 81,
    hitAt: '05:40',
    hitText: 'Checkpointer 把 thread 状态持久化；生产环境不要用 MemorySaver。',
    summary: 'Agent 记忆的分层：线程内状态、Checkpointer 持久化、Thread ID 隔离与生产存储选择。',
    tags: ['agent', '记忆', 'checkpointer', 'thread', 'session', '持久化'],
    chapters: [
      { time: '02:15', title: 'Thread 与状态' },
      { time: '05:40', title: 'Checkpointer 持久化' },
      { time: '08:10', title: '用户隔离' },
    ],
    transcript: [
      { time: '05:40', text: 'MemorySaver 只适合测试，进程重启状态就没了；生产要用数据库或 Redis。' },
      { time: '08:10', text: 'Thread ID 不隔离，两个用户的对话会串在同一个 checkpoint 里。' },
    ],
    advice: {
      headline: '把记忆和会话隔离当成两个问题，不要一起解决。',
      body: '你已经在 Lite 里用 AgentRun.steps 兜底确认卡恢复，下一步可以把 thread 状态和用户身份绑定，避免同一浏览器多账号时复用旧 checkpoint。',
      actions: ['检查 thread_id 生成规则', '补用户维度的隔离测试', '记录重启恢复边界'],
    },
  },
];

const QUERY_STOP_WORDS = new Set(['视频', '教程', '课程', '怎么', '如何', '什么', '一下']);

function normalizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s,，、/]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !QUERY_STOP_WORDS.has(part));
}

function scoreVideo(video: ShowcaseVideo, terms: string[]): number {
  const title = video.title.toLowerCase();
  const tags = video.tags.join(' ').toLowerCase();
  const folder = video.folder.toLowerCase();
  const body = `${video.hitText} ${video.summary}`.toLowerCase();

  return terms.reduce((total, term) => {
    let score = 0;
    if (title.includes(term)) score += 3;
    if (tags.includes(term)) score += 2;
    if (folder.includes(term)) score += 1;
    if (body.includes(term)) score += 1;
    return total + score;
  }, 0);
}

/**
 * 本地样例排序，不请求后端。
 *
 * 真实 P2 Media 走的是标题/文件夹 + 字幕三路召回 + 重排；这里用标题权重
 * 高于目录/摘要的可解释打分，目的是让演示页面能响应搜索，不冒充真实检索分数。
 */
export function rankShowcaseVideos(query: string): ShowcaseVideo[] {
  const terms = normalizeQuery(query);
  if (terms.length === 0) return SHOWCASE_VIDEOS;

  return [...SHOWCASE_VIDEOS]
    .map((video) => ({ video, matches: scoreVideo(video, terms) }))
    .filter(({ matches }) => matches > 0)
    .sort((a, b) => b.matches - a.matches || b.video.score - a.video.score)
    .map(({ video }) => video);
}
