import type { InterviewQuestion } from './types';

/**
 * 项目档案是「我自己的项目」模式的唯一事实源。
 *
 * 这里只放能拿去面试里讲、且当前项目真实存在的约束与证据，不写愿景。
 * 项目题正文后续还会细写；档案先作为评分时的对齐基准，避免 AI 用通用
 * 八股答案给高分。
 */
export interface ProjectProfile {
  id: string;
  short: string;
  name: string;
  role: string;
  summary: string;
  stack: string[];
  proofs: string[];
  focus: string[];
  boundaries: string[];
}

export const PROJECT_PROFILES: ProjectProfile[] = [
  {
    id: 'ZB02',
    short: 'ZB02',
    name: 'ZB02 Deepresearch 2',
    role: '深度调研 Agent',
    summary: '围绕一个主题做多源网页抓取、正文抽取、去重、RRF 融合、事实校验和长报告生成；重点不是“搜到”，而是每个 claim 能回链到原文。',
    stack: ['多源抓取', '正文抽取', 'BM25 + 向量', 'RRF', '事实校验', '长报告分段生成'],
    proofs: [
      'URL canonical + 正文 simhash/MinHash + 近似标题三层去重，同一事实允许多源保留',
      'BM25 + 向量召回后 RRF 融合，按来源权威性加权',
      'claim 抽取后做多源 entailment，冲突不强行统一，标出来源差异',
      '报告按大纲分节生成，引用表与正文 citation id 对齐',
    ],
    focus: ['去重误杀阈值', '冲突信息处理', '引用可追溯', '长文 token 预算'],
    boundaries: ['抓取成功率与报告采纳率需要真实样本持续统计', '反爬与代理池只做到退避和缓存，不是生产级采集'],
  },
  {
    id: 'ZB03',
    short: 'ZB03',
    name: 'ZB03 HR Assistant',
    role: 'HR 垂直 Agent',
    summary: '把简历解析、实体抽取、岗位匹配打分和多轮追问收成一条 HR 业务链路；核心是结构化字段和可解释的匹配分。',
    stack: ['简历解析', '实体抽取', '岗位画像', '匹配打分', '多轮对话'],
    proofs: [
      '简历字段先落结构化 schema，再做实体归一和缺失字段追问',
      '岗位要求拆成技能/经验/行业/硬性条件，匹配分按维度可解释',
      '低置信字段不直接写死，进入澄清或人工复核',
    ],
    focus: ['字段抽取准确率', '匹配分可解释', '多轮上下文', '隐私与权限'],
    boundaries: ['简历样本量与标注质量决定上限', '复杂版式简历仍需要 OCR/多模态兜底'],
  },
  {
    id: 'P4',
    short: 'P4',
    name: 'P4 Agent 电商',
    role: '电商 Agent / MCP 工具编排',
    summary: '用户一句话里可能同时包含指代、退款、再下单和权限校验；用会话实体表、MCP 工具注册、订单 DAG 和租户权限把动作串起来。',
    stack: ['MCP 工具注册', '指代消解', 'SQL 工具', '订单 DAG', 'RBAC / 租户隔离'],
    proofs: [
      '会话实体表保存 entity_id、type、attributes、ttl，按最近提及 + 类型消解“刚才那个”',
      '写操作按 DAG 串行：查订单 → 校验状态/权限 → 幂等退款 → 原子扣库存 → 创建新单 → 通知',
      '工具 scopes 按租户/用户收口，退款金额和订单归属服务端二次校验',
      '工具错误结构化回灌，缺槽位反问，不替用户猜',
    ],
    focus: ['指代与权限冲突', '订单 DAG 顺序', '幂等与超时重试', '高风险二次确认'],
    boundaries: ['真实支付/库存只做到本地幂等与事务，未接生产支付通道', '多 Agent 分流没有落地成独立网关'],
  },
  {
    id: 'P3',
    short: 'P3',
    name: 'P3 June 产品对比',
    role: '对比分析 Agent',
    summary: '从多个来源抓产品参数，做结构化抽取和字段对齐，遇到冲突不硬合并，最后输出可解释的对比结论。',
    stack: ['多源抓取', '结构化抽取', '字段对齐', '冲突识别', '对比报告'],
    proofs: [
      '先定义对比 schema，再做来源到字段的映射，避免“抓到什么写什么”',
      '同一参数多源冲突时保留来源、时间和置信度，标记差异',
      '结论区分硬参数、主观体验和缺失项，不把缺失当劣势',
    ],
    focus: ['字段对齐', '冲突标记', '来源可信度', '结论边界'],
    boundaries: ['部分商品参数需要人工校对', '多源反爬与更新频率未做长期调度'],
  },
  {
    id: 'P10',
    short: 'P10',
    name: 'P10 ProjectManager',
    role: '项目管理 Agent',
    summary: '文档 RAG、会议摘要、任务拆解和状态持久化组合成项目管理助手；重点在“任务能落到人和状态”，不是只生成一段总结。',
    stack: ['文档 RAG', '会议摘要', '任务拆解', '状态持久化', '多轮上下文'],
    proofs: [
      '会议内容先抽决议/风险/待办，再映射到负责人、截止时间和依赖',
      '任务状态落库，支持后续追问“这件事到哪了”',
      'RAG 引用回到会议原文或项目文档，摘要不脱离来源',
    ],
    focus: ['任务拆解粒度', '状态一致性', '引用回溯', '多轮追问'],
    boundaries: ['没有接真实企业 IM/日历写回', '任务依赖图只做到轻量 DAG'],
  },
  {
    id: 'P6',
    short: 'P6',
    name: 'P6 视频管线',
    role: '异步视频处理流水线',
    summary: 'Celery/Redis 驱动视频处理，GPU 队列单卡并发受限；重点在资源控制、限流熔断、失败重试、死信和 worker 重启恢复。',
    stack: ['Celery', 'Redis', 'GPU 队列', '限流 / 熔断', '死信 / 重放'],
    proofs: [
      'GPU 队列单卡并发=1，任务声明资源需求，调度器按容量放行',
      '每租户/任务类型令牌桶，下游连续失败熔断并降级',
      '重试只覆盖网络/429/5xx，401 和参数错误不重试',
      '幂等键 video_id+stage+model_version，超次数进死信保留输入引用与最后日志',
      'worker 重启用 lease 超时 + advisory lock + 启动恢复扫描，已完成阶段不重跑',
    ],
    focus: ['GPU 资源隔离', '重试分类', '幂等键', '死信与恢复'],
    boundaries: ['GPU 透传和长稳只在本机验证', '没有做多机调度与弹性扩缩容'],
  },
  {
    id: 'P2',
    short: 'P2',
    name: 'P2 Yeb 视频站',
    role: '站点后端 / 个人内容与面试底座',
    summary: '个人站的后端与内容底座：FastAPI + PostgreSQL/pgvector + Redis/RQ，除视频、笔记、待办外，还承载面试题库、知识库、项目档案和带 HITL 的问答助手。',
    stack: ['React', 'FastAPI', 'PostgreSQL / pgvector', 'Redis / RQ', 'Docker Compose'],
    proofs: [
      '接口按 router/service/repository 分层，连接池参数和超时统一配置',
      'RBAC 与用户数据隔离，文件存储走统一上传/下载路径',
      '异步任务用 RQ + Redis，失败重试和状态回写 PostgreSQL',
      'GPU 字幕 worker 用 PostgreSQL advisory lock + Redis 启动恢复锁，分批回填避免启动死锁',
      '面试题库 summary/detail 分离 + Redis 读穿缓存；知识库 12 篇；项目题与个人项目题分开筛选',
      '问答助手按页面注入题库/知识库上下文，LangGraph HITL 用 A/B/C/其它澄清后 resume',
    ],
    focus: ['连接池与超时', 'RBAC', '任务恢复', '接口分层', '按需加载', 'HITL'],
    boundaries: ['单机 Compose，没有多副本压测', '部分后台任务只保证最终一致，不是强事务'],
  },
  {
    id: 'P8',
    short: 'P8',
    name: 'P8 全栈抽卡',
    role: '业务系统 / 并发与事务',
    summary: '抽卡业务用来练并发控制、事务、库存防超卖和幂等；核心是把“扣库存 + 写记录 + 发奖励”放进可控事务边界。',
    stack: ['事务', '行锁 / 乐观锁', '库存防超卖', '幂等', '并发控制'],
    proofs: [
      '库存扣减带条件更新，失败快速返回，不做“先查再减”',
      '抽卡记录用幂等键防重复提交，重试不重复发奖',
      '事务边界只包住必须一致的写操作，通知等副作用后置',
    ],
    focus: ['防超卖', '事务边界', '幂等键', '并发压测'],
    boundaries: ['压测规模有限，没做分布式库存', '奖励发放的最终一致依赖补偿任务'],
  },
  {
    id: 'P7',
    short: 'P7',
    name: 'P7 HarnessAuto',
    role: 'CI/CD 自动化编排',
    summary: '把流水线、测试调度、交付脚本和版本管理收成一套可重复执行的交付编排；重点在失败可定位、版本可回滚。',
    stack: ['流水线编排', '测试调度', '交付脚本', '版本管理', 'Docker'],
    proofs: [
      '流水线阶段化，测试任务按依赖调度，失败阶段保留日志与产物',
      '交付脚本参数化，版本与构建产物绑定',
      '回滚路径和冒烟脚本一起交付，不把“能构建”当“能交付”',
    ],
    focus: ['阶段依赖', '失败定位', '版本回滚', '交付冒烟'],
    boundaries: ['没有接生产级 CI 集群', '多环境密钥管理只做到环境变量'],
  },
  {
    id: 'P1',
    short: 'P1',
    name: 'P1 SimTrack',
    role: '仿真追踪调度 / 可观测',
    summary: '仿真任务监控、状态采集和链路埋点；把任务生命周期、耗时和失败原因变成可查询的状态，而不是只看日志。',
    stack: ['任务监控', '状态采集', '链路埋点', '调度', '看板'],
    proofs: [
      '任务状态机落库，状态变更带时间戳和 trace_id',
      '关键阶段埋点耗时、失败原因和重试次数',
      '看板按任务/阶段聚合，能定位卡在哪一步',
    ],
    focus: ['状态机', '埋点粒度', '失败定位', '看板口径'],
    boundaries: ['没有接完整告警通道', '长期存储与采样策略未做压测'],
  },
  {
    id: 'P5',
    short: 'P5',
    name: 'P5 企业级知识库',
    role: '企业知识库 / RAG 资源系统',
    summary: 'React + FastAPI + PostgreSQL + Milvus + Redis/Celery + DeepSeek。核心不是“能问答”，而是把多租户权限、版本可追溯、大文件异步入库和检索融合做成可验收链路。',
    stack: ['React 18', 'FastAPI', 'PostgreSQL', 'Milvus 2.6', 'Redis / Celery', 'DeepSeek V4.1-Flash'],
    proofs: [
      '2GB 大文件分片上传：8MiB 固定片、MinIO 合并、SHA256 校验、断点续传、同 checksum 秒传',
      '入库：Celery 轻/重队列 + 页级 chord 并行 + 四层进度 + PG 任务台账 + 心跳捞回',
      '检索：PG 全文/标签/属性 + Milvus 语义 + RRF 融合 + 权限二次过滤 + 结果缓存',
      '权限：tenant_id 强制、部门物化路径、RBAC、显式 ACL、片段级 ACL 预留',
      '追溯：不可变版本快照、行级 diff、追加式回滚、引用页码、trace_id 全链路',
    ],
    focus: ['权限前置过滤', '大文件与批次状态', '引用可回溯', '检索融合', '评测边界'],
    boundaries: [
      'embedding 仍可能是 stub，不能拿它证明语义召回',
      'pypdf 解析没有 OCR / MinerU 兜底',
      '没有 PG 主备切换与容灾演练',
      'RAGAS 只有部分真实集，context precision 0.18',
    ],
  },
  {
    id: 'P9',
    short: 'P9',
    name: 'P9 AI 点餐',
    role: '轻量业务 Demo / 小程序 Agent',
    summary: '点餐场景的轻量 Agent：小程序对接、意图识别和工具调用；目标是把“一句话点餐”跑通，不堆重后端。',
    stack: ['小程序', '意图识别', '工具调用', '轻量 Agent', '菜单数据'],
    proofs: [
      '意图先分点餐/改单/查询/闲聊，再决定是否调工具',
      '菜单、规格、加料做成槽位，缺槽位反问',
      '下单动作服务端校验库存与价格，前端只做交互',
    ],
    focus: ['意图边界', '槽位填充', '工具调用', '轻量交付'],
    boundaries: ['没有接真实支付与门店系统', '多轮复杂改单只覆盖主路径'],
  },
  {
    id: 'P1D',
    short: 'P1D',
    name: 'P1D SlimTrack 1.2',
    role: '健康管理 Agent / 结构化健康数据底座',
    summary: '单健康助手 + 结构化健康接口 + MCP Server + 睡眠追踪 + 双报告生成。重点不是聊天，而是把体重单位、健康常识校验、报告口径和缓存落成可验收链路。',
    stack: ['FastAPI', 'MCP', 'PostgreSQL', 'Redis', 'SQLite', 'React', 'Docker'],
    proofs: [
      'kg / 公斤 / 千克 / 斤统一归一，2 斤 = 1 kg；对「掉了两斤肉」先做意图判断',
      '极端体重、短期大幅变化做常识校验；记录不足 7 天阻止生成报告',
      '报告评分结合趋势、BMI、饮水、蛋白、波动和停滞风险',
      'L1 TTL+LRU + Redis L2 + singleflight；报告缓存演示 TTL 1 分钟，生产建议 12 小时',
      'JWT + PBKDF2 多租户鉴权；MCP resources / tools / prompts 分层',
    ],
    focus: ['单位归一', '报告口径', '缓存一致性', '多租户', '可观测'],
    boundaries: [
      '单机 demo，未完成云端压测与长期稳定性',
      '演示缓存 TTL 不是生产值',
      'Demo 场景不代表真实用户分布',
    ],
  },
  {
    id: 'P7E',
    short: 'P7E',
    name: 'P7E Agent Engineering Harness',
    role: 'Agent 测试 / 评估 / 发布门禁平台',
    summary: '8 个真实项目按同一协议接入，用同一 Golden Set 输出可复现的 trace、指标和证据包；门禁按硬事实、阈值、基线和人工审批分层。',
    stack: ['Python', 'FastAPI', 'SQLite', 'Pydantic', 'React'],
    proofs: [
      '8 个 connected 项目：P1 / P2 / P4 / P5 / P6 / P7 / ZB01 / ZB03',
      'P5 用 47 条用例（业务 9 + real 8 + real-cn 30），不把外部切片冒充业务评估',
      'p4 retry-hardened 命中 HARD_BLOCK:DUPLICATE_WRITE(1)；p5 cost-opt 因 correctness 0.548 / 回退 -0.452 被 BLOCK',
      'p2 11/11、p6 10/10 能 PASS，证明门禁不是一律拦截',
      '每次 run 留 spec/commit、Golden Set、trace、指标、diff 和门禁决策',
    ],
    focus: ['硬事实优先', '配对基线', '证据链', '可重放', 'adapter 边界'],
    boundaries: [
      '单机运行，不是生产 CI 集群',
      '部分 adapter 是 simulated',
      'P8D 仍在 onboarding，P3 / ZB02 在 backlog',
    ],
  },
  {
    id: 'P8D',
    short: 'P8D',
    name: 'P8D 多模型前端设计打样台 0.3.0',
    role: '多模型视觉方向并行生成 / 评审',
    summary: '同一份需求拆成多条视觉方向，多模型并行产出单文件 HTML 样张，并排评分、收藏、SpecBus 版本审批；重点是可复现和限流，不是“生成一张图”。',
    stack: ['Node.js', 'node:sqlite', 'React / Vite', 'Docker', 'Chromium'],
    proofs: [
      'industrial / brutalist / editorial / glass 四方向真实生成；approved v2 8,379 B',
      '全栈盲评 4.1（后端 4.0 / 前端 4.2）；主 run 376,431 ms',
      'token 记账 127,991 = 81,905 + 46,086',
      'TPM 桶按 provider.id::model，提交前预扣、真实 usage 回填，429 清桶并冷却 20 秒',
      'runs / artifacts 用 node:sqlite WAL，旧 JSON run 迁移与 artifact 幂等回填',
    ],
    focus: ['spec 版本', 'run 复现', '429/TPM', '盲评', '迟到日志'],
    boundaries: [
      '本地工具，不上线',
      'P7 里仍是 onboarding，adapter pending',
      '历史方向保留 v1 稿，不能混成最新版本',
    ],
  },
  {
    id: 'FOUNDATION',
    short: 'BASE',
    name: '底座模板 v1',
    role: 'FastAPI / PG / Redis / Docker 底座',
    summary: '把 FastAPI 高并发服务、异步任务、权限多租户和 Docker 交付抽成可复用底座；项目题里用来回答通用底座设计。',
    stack: ['FastAPI', 'PostgreSQL', 'Redis', 'Celery / RQ', 'Docker Compose'],
    proofs: [
      '连接池、超时、限流、幂等、分布式锁和事务边界有统一约定',
      '异步任务有 DAG、失败重试、死信和进度回调',
      'RBAC + 行级过滤，权限在检索/查询前生效',
    ],
    focus: ['连接池', '限流熔断', '任务 DAG', '事务与幂等', '多租户'],
    boundaries: ['这是模板级底座，不是每个项目都做了同等强度的压测', '部分能力按项目需要裁剪'],
  },
];

const PROFILE_MAP = new Map(PROJECT_PROFILES.map((profile) => [profile.id, profile]));

/** 33 道项目题到项目档案的显式映射；不靠关键词猜。 */
export const PROFILE_BY_QUESTION: Record<string, string> = {
  'X-PROJ-01': 'ZB02',
  'X-PROJ-02': 'P4',
  'X-PROJ-03': 'P6',
  'X-PROJ-04': 'P2',
  'X-PROJ-05': 'P8',
  'X-PROJ-06': 'P7',
  'X-PROJ-07': 'P1',
  'X-PROJ-08': 'ZB03',
  'X-PROJ-09': 'P10',
  'X-PROJ-10': 'P7',
  'X-PROJ-11': 'FOUNDATION',
  'X-PROJ-12': 'FOUNDATION',
  'X-PROJ-13': 'FOUNDATION',
  'X-PROJ-14': 'FOUNDATION',
  'X-PROJ-15': 'P5',
  'X-PROJ-16': 'P4',
  'X-PROJ-17': 'P4',
  'X-PROJ-18': 'P5',
  'X-PROJ-19': 'P5',
  'X-PROJ-20': 'P9',
  'X-PROJ-21': 'P1',
  'X-PROJ-22': 'P3',
  'X-PROJ-23': 'P9',
  'X-MINE-01': 'P2',
  'X-MINE-02': 'P2',
  'X-MINE-03': 'P4',
  'X-MINE-04': 'P4',
  'X-MINE-05': 'P5',
  'X-MINE-06': 'P5',
  'X-MINE-07': 'P6',
  'X-MINE-08': 'P7E',
  'X-MINE-09': 'P1D',
  'X-MINE-10': 'P8D',
};

export function profileForQuestion(question: Pick<InterviewQuestion, 'id' | 'type'>): ProjectProfile | null {
  if (question.type !== 'project') return null;
  const id = PROFILE_BY_QUESTION[question.id];
  return id ? PROFILE_MAP.get(id) ?? null : null;
}

export function projectProfilePrompt(profile: ProjectProfile): string {
  return [
    `项目：${profile.name}（${profile.short}）`,
    `定位：${profile.role}`,
    `一句话：${profile.summary}`,
    `技术栈：${profile.stack.join('、')}`,
    '真实证据：',
    ...profile.proofs.map((item) => `- ${item}`),
    `面试官会追：${profile.focus.join('、')}`,
    '已知边界：',
    ...profile.boundaries.map((item) => `- ${item}`),
  ].join('\n');
}
