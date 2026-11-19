export type InterviewGroupKey = 'agent' | 'llm' | 'backend' | 'delivery' | 'bonus';

export type InterviewQuestionType =
  | 'concept'
  | 'code'
  | 'handwrite'
  | 'debug'
  | 'scenario'
  | 'compare'
  | 'troubleshoot'
  | 'system'
  | 'project'
  | 'behavioral';

export type InterviewSource = '书B' | '书C' | '书D' | '补充' | '项目' | '个人项目';

export interface InterviewQuestion {
  id: string;
  group: InterviewGroupKey;
  groupLabel: string;
  resumeGroup: string;
  resumeGroupLabel: string;
  type: InterviewQuestionType;
  difficulty: string;
  source: InterviewSource;
  bookId: 'B' | 'C' | 'D' | null;
  bookPage: number | null;
  chapter: string;
  title: string;
  question: string;
  answer: string;
  followUps: string[];
  rubric: string[];
  tags: string[];
  bookTitle?: string | null;
}

/** 列表/搜索用的轻量题目：不含参考答案、rubric 和追问。 */
export type InterviewQuestionSummary = Omit<
  InterviewQuestion,
  'answer' | 'followUps' | 'rubric'
>;

export interface InterviewLibraryMeta {
  version: string;
  count: number;
  knowledgeCount: number;
  groups: Record<string, string>;
  resumeGroups: Record<string, string>;
  sourceCounts: Record<string, number>;
  typeCounts: Record<string, number>;
  groupCounts: Record<string, number>;
}

export interface InterviewQuestionPage {
  version: string;
  total: number;
  offset: number;
  limit: number;
  items: InterviewQuestionSummary[];
}

export interface KnowledgeSummary {
  id: string;
  category: string;
  title: string;
  subtitle: string;
  readingMinutes: number;
  tags: string[];
  summary: string;
  relatedQuestions: string[];
}

export interface InterviewSearchPayload {
  version: string;
  query: string;
  questions: InterviewQuestionSummary[];
  knowledge: KnowledgeSummary[];
}

export interface InterviewBank {
  version: number;
  generated_from: string[];
  groups: Record<InterviewGroupKey, string>;
  resumeGroups: Record<string, string>;
  count: number;
  questions: InterviewQuestion[];
}

export interface InterviewState {
  questionId: string;
  starred: boolean;
  mastered: boolean;
  confidence: number;
  lastScore: number | null;
  practiceCount: number;
  lastPracticedAt: string | null;
}

export interface InterviewDimension {
  name: string;
  score: number;
  comment: string;
}

export interface InterviewEvaluation {
  attemptId?: string;
  score: number;
  verdict: 'pass' | 'borderline' | 'fail';
  dimensions: InterviewDimension[];
  strengths: string[];
  gaps: string[];
  rewrite: string;
  followUps: string[];
  provider?: string;
  model?: string;
  latencyMs?: number;
  state?: InterviewState;
  quota?: { used: number; limit: number };
}

export interface InterviewStats {
  totalAttempts: number;
  distinctQuestions: number;
  avgScore: number | null;
  todayAttempts: number;
  mastered: number;
  starred: number;
  days: Array<{ date: string; count: number }>;
}

export interface InterviewAttempt {
  id: string;
  questionId: string;
  questionTitle: string;
  score: number | null;
  verdict: string | null;
  createdAt: string | null;
  mode: string;
}

export type QuestionReportReason =
  | 'stem'
  | 'answer'
  | 'rubric'
  | 'classification'
  | 'typo'
  | 'other';

export interface InterviewQuestionReport {
  id: string;
  questionId: string;
  questionTitle: string;
  reason: QuestionReportReason;
  detail: string;
  status: 'open' | 'fixed' | 'ignored';
  createdAt: string | null;
  resolvedAt: string | null;
}

export interface KbBaselineDimension {
  key: string;
  name: string;
  weight: number;
  score: number;
  note: string;
}

export interface KbBaseline {
  projectName: string;
  subtitle: string;
  version: string;
  limits: string[];
  overall: number;
  dimensions: KbBaselineDimension[];
}

export interface KbCompareDimension {
  key: string;
  name: string;
  weight: number;
  baselineScore: number;
  candidateScore: number;
  delta: number;
  winner: 'mine' | 'candidate' | 'tie';
  comment: string;
  baselineNote: string;
}

export interface KbCompareResult {
  baseline: KbBaseline;
  candidateScore: number;
  winner: 'mine' | 'candidate' | 'tie';
  margin: number;
  dimensions: KbCompareDimension[];
  summary: string;
  candidateStrengths: string[];
  candidateGaps: string[];
  nextActions: string[];
  baselineAdvantages: Array<{ name: string; delta: number }>;
  candidateAdvantages: Array<{ name: string; delta: number }>;
  provider?: string;
  model?: string;
  latencyMs?: number;
  quota?: { used: number; limit: number };
}

export interface BookTocEntry {
  id: string;
  title: string;
  page: number;
}

export interface BookPage {
  n: number;
  text?: string;
  [key: string]: unknown;
}

export interface BookData {
  id: string;
  title: string;
  subtitle?: string;
  kind?: string;
  page_count: number;
  toc: BookTocEntry[];
  pages: BookPage[];
}

export interface BookIndexItem {
  id: string;
  title: string;
  subtitle?: string;
  kind?: string;
  page_count?: number;
  toc_count?: number;
  file: string;
}

export interface KnowledgeSource {
  title: string;
  url: string;
}

export interface KnowledgeArticle {
  id: string;
  category: string;
  title: string;
  subtitle: string;
  readingMinutes: number;
  tags: string[];
  summary: string;
  body: string;
  sources: KnowledgeSource[];
  relatedQuestions: string[];
}

export interface KnowledgeBase {
  version: number;
  generated_from: string[];
  count: number;
  articles: KnowledgeArticle[];
}
