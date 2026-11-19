import { apiFetch } from './videoApi';
import type {
  BookData,
  BookIndexItem,
  InterviewAttempt,
  InterviewEvaluation,
  InterviewLibraryMeta,
  InterviewQuestion,
  InterviewQuestionPage,
  InterviewQuestionReport,
  InterviewSearchPayload,
  InterviewState,
  InterviewStats,
  KbBaseline,
  KbCompareResult,
  KnowledgeArticle,
  KnowledgeSummary,
} from '../data/interview/types';

export async function evaluateInterviewAnswer(input: {
  questionId: string;
  question: string;
  reference: string;
  answer: string;
  qtype: string;
  difficulty: string;
  title: string;
  groupKey: string;
  projectContext?: string;
}): Promise<InterviewEvaluation> {
  return apiFetch<InterviewEvaluation>('/api/interview/evaluate', {
    method: 'POST',
    body: JSON.stringify({
      question_id: input.questionId,
      question: input.question,
      reference: input.reference,
      answer: input.answer,
      qtype: input.qtype,
      difficulty: input.difficulty,
      title: input.title,
      group_key: input.groupKey,
      project_context: input.projectContext ?? '',
    }),
    timeoutMs: 120000,
  });
}

export async function fetchP5Baseline(): Promise<KbBaseline> {
  return apiFetch<KbBaseline>('/api/interview/kb-baseline');
}

export async function compareKnowledgeBase(profile: string): Promise<KbCompareResult> {
  return apiFetch<KbCompareResult>('/api/interview/kb-compare', {
    method: 'POST',
    body: JSON.stringify({ profile }),
    timeoutMs: 150000,
  });
}

export async function fetchInterviewProgress(): Promise<InterviewState[]> {
  const result = await apiFetch<{ items: InterviewState[] }>('/api/interview/progress');
  return result.items;
}

export async function updateInterviewProgress(input: {
  questionId: string;
  starred?: boolean;
  mastered?: boolean;
  confidence?: number;
}): Promise<InterviewState> {
  return apiFetch<InterviewState>('/api/interview/progress', {
    method: 'POST',
    body: JSON.stringify({
      question_id: input.questionId,
      starred: input.starred,
      mastered: input.mastered,
      confidence: input.confidence,
    }),
  });
}

export async function fetchInterviewStats(): Promise<InterviewStats> {
  return apiFetch<InterviewStats>('/api/interview/stats');
}

export async function fetchInterviewLibraryMeta(): Promise<InterviewLibraryMeta> {
  return apiFetch<InterviewLibraryMeta>('/api/interview/library');
}

export async function fetchInterviewQuestionSummaries(input?: {
  q?: string;
  group?: string;
  qtype?: string;
  source?: string;
  offset?: number;
  limit?: number;
}): Promise<InterviewQuestionPage> {
  const params = new URLSearchParams();
  if (input?.q) params.set('q', input.q);
  if (input?.group) params.set('group', input.group);
  if (input?.qtype) params.set('qtype', input.qtype);
  if (input?.source) params.set('source', input.source);
  params.set('offset', String(input?.offset ?? 0));
  params.set('limit', String(input?.limit ?? 400));
  return apiFetch<InterviewQuestionPage>(`/api/interview/questions?${params.toString()}`);
}

export async function fetchInterviewQuestionDetail(questionId: string): Promise<InterviewQuestion> {
  return apiFetch<InterviewQuestion>(`/api/interview/questions/${encodeURIComponent(questionId)}`);
}

export async function fetchRandomInterviewQuestion(): Promise<InterviewQuestion> {
  return apiFetch<InterviewQuestion>('/api/interview/questions/random');
}

export async function fetchInterviewQuestionReport(questionId: string): Promise<{
  reported: boolean;
  latest: InterviewQuestionReport | null;
}> {
  return apiFetch(`/api/interview/question-reports/${encodeURIComponent(questionId)}`);
}

export async function reportInterviewQuestion(input: {
  questionId: string;
  reason: InterviewQuestionReport['reason'];
  detail?: string;
}): Promise<{ ok: boolean; report: InterviewQuestionReport }> {
  return apiFetch('/api/interview/question-reports', {
    method: 'POST',
    body: JSON.stringify({
      question_id: input.questionId,
      reason: input.reason,
      detail: input.detail ?? '',
    }),
  });
}

export async function fetchInterviewKnowledgeSummaries(): Promise<{
  version: string;
  count: number;
  items: KnowledgeSummary[];
}> {
  return apiFetch('/api/interview/knowledge');
}

export async function fetchInterviewKnowledgeDetail(articleId: string): Promise<KnowledgeArticle> {
  return apiFetch<KnowledgeArticle>(`/api/interview/knowledge/${encodeURIComponent(articleId)}`);
}

export async function searchInterviewLibrary(query: string, limit = 8): Promise<InterviewSearchPayload> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  return apiFetch<InterviewSearchPayload>(`/api/interview/search?${params.toString()}`);
}

export async function fetchInterviewAttempts(limit = 20): Promise<InterviewAttempt[]> {
  const result = await apiFetch<{ items: InterviewAttempt[] }>(`/api/interview/attempts?limit=${limit}`);
  return result.items;
}

export async function fetchBookIndex(): Promise<BookIndexItem[]> {
  const response = await fetch('/interview-books/index.json', { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`书库索引加载失败（HTTP ${response.status}）`);
  const payload = (await response.json()) as { books?: BookIndexItem[] };
  return payload.books ?? [];
}

export async function fetchBook(bookId: string): Promise<BookData> {
  const response = await fetch(`/interview-books/${encodeURIComponent(bookId)}.json`, {
    credentials: 'same-origin',
  });
  if (!response.ok) throw new Error(`《${bookId}》加载失败（HTTP ${response.status}）`);
  return (await response.json()) as BookData;
}
