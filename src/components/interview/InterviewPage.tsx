import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookMarked,
  BookOpen,
  Brain,
  CircleDot,
  Clock3,
  Flame,
  Layers,
  MessageSquare,
  Play,
  RefreshCw,
  Target,
  Telescope,
} from 'lucide-react';
import { PageTitle } from '../shared';
import type {
  InterviewAttempt,
  InterviewEvaluation,
  InterviewLibraryMeta,
  InterviewQuestion,
  InterviewQuestionSummary,
  InterviewState,
  InterviewStats,
} from '../../data/interview/types';
import {
  fetchInterviewAttempts,
  fetchInterviewLibraryMeta,
  fetchInterviewProgress,
  fetchInterviewQuestionDetail,
  fetchInterviewStats,
  fetchRandomInterviewQuestion,
  updateInterviewProgress,
} from '../../lib/interviewApi';
import { userScopedStorage } from '../../lib/userScopedStorage';
import { QuestionBankTab } from './QuestionBankTab';
import { BookReaderTab, type BookTarget } from './BookReaderTab';
import { KnowledgeBaseTab } from './KnowledgeBaseTab';
import { QuestionDrawer } from './QuestionDrawer';
import { P5CompareDrawer } from './P5CompareDrawer';
import { InterviewSearch } from './InterviewSearch';
import { useInterviewContextStore } from '../../stores/interviewContextStore';
import './InterviewPage.css';

const MockInterviewTab = React.lazy(() =>
  import('./MockInterviewTab').then((module) => ({ default: module.MockInterviewTab }))
);

type TabKey = 'all' | 'project' | 'mock' | 'books' | 'knowledge';

const STORAGE_KEY = 'p2.interview.progress.v1';

const emptyState = (questionId: string): InterviewState => ({
  questionId,
  starred: false,
  mastered: false,
  confidence: 0,
  lastScore: null,
  practiceCount: 0,
  lastPracticedAt: null,
});

function readLocalProgress(): Record<string, InterviewState> {
  try {
    const raw = userScopedStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, InterviewState>;
  } catch {
    return {};
  }
}

function verdictLabel(score: number | null): string {
  if (score == null) return '未测';
  if (score >= 80) return '能过';
  if (score >= 60) return '边缘';
  return '薄弱';
}

export const InterviewPage: React.FC = () => {
  const [tab, setTab] = useState<TabKey>('all');
  const [progress, setProgress] = useState<Record<string, InterviewState>>(readLocalProgress);
  const [stats, setStats] = useState<InterviewStats | null>(null);
  const [attempts, setAttempts] = useState<InterviewAttempt[]>([]);
  const [syncError, setSyncError] = useState('');
  const [meta, setMeta] = useState<InterviewLibraryMeta | null>(null);
  const [selectedQuestion, setSelectedQuestion] = useState<InterviewQuestion | null>(null);
  const [mockQuestionId, setMockQuestionId] = useState<string | null>(null);
  const [mockQuestion, setMockQuestion] = useState<InterviewQuestion | null>(null);
  const [bookTarget, setBookTarget] = useState<BookTarget | null>(null);
  const [p5Open, setP5Open] = useState(false);
  const [p5Seed, setP5Seed] = useState('');
  const [knowledgeFocus, setKnowledgeFocus] = useState<{ id: string; nonce: number } | null>(null);
  const [assistantQuestion, setAssistantQuestion] = useState<InterviewQuestion | null>(null);
  const setContextTab = useInterviewContextStore((state) => state.setTab);
  const setActiveContextQuestion = useInterviewContextStore((state) => state.setActiveQuestion);
  const contextQuestion = useMemo(
    () => selectedQuestion ?? assistantQuestion ?? (tab === 'mock' ? mockQuestion : null),
    [selectedQuestion, assistantQuestion, tab, mockQuestion],
  );

  useEffect(() => {
    let alive = true;
    fetchInterviewLibraryMeta()
      .then((data) => { if (alive) setMeta(data); })
      .catch(() => { if (alive) setSyncError('题库元信息读取失败，稍后重试。'); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let questionId = '';
    try {
      questionId = new URLSearchParams(window.location.search).get('q') || '';
    } catch { /* ignore */ }
    if (!questionId) return;
    let alive = true;
    fetchInterviewQuestionDetail(questionId)
      .then((question) => { if (alive) setSelectedQuestion(question); })
      .catch(() => { if (alive) setSyncError('题目详情读取失败，稍后重试。'); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!mockQuestionId) {
      setMockQuestion(null);
      return;
    }
    let alive = true;
    fetchInterviewQuestionDetail(mockQuestionId)
      .then((question) => { if (alive) setMockQuestion(question); })
      .catch(() => { if (alive) setMockQuestion(null); });
    return () => { alive = false; };
  }, [mockQuestionId]);

  useEffect(() => {
    setContextTab(tab);
    setAssistantQuestion(null);
  }, [setContextTab, tab]);

  useEffect(() => {
    setActiveContextQuestion(contextQuestion);
  }, [contextQuestion, setActiveContextQuestion]);

  useEffect(() => () => {
    setActiveContextQuestion(null);
  }, [setActiveContextQuestion]);

  const applyState = useCallback((state: InterviewState) => {
    setProgress((prev) => {
      const next = { ...prev, [state.questionId]: state };
      try {
        userScopedStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch { /* ignore */ }
      return next;
    });
  }, []);

  const refreshStats = useCallback(async () => {
    try {
      const data = await fetchInterviewStats();
      setStats(data);
    } catch {
      // 统计失败不阻塞题库；页面会退回本地汇总。
    }
  }, []);

  const refreshAttempts = useCallback(async () => {
    try {
      setAttempts(await fetchInterviewAttempts(12));
    } catch {
      // 后端不可用时留空，模拟面试仍可本地进行。
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    Promise.allSettled([fetchInterviewProgress(), fetchInterviewStats(), fetchInterviewAttempts(12)])
      .then(([progressResult, statsResult, attemptsResult]) => {
        if (cancelled) return;
        let anySuccess = false;
        if (progressResult.status === 'fulfilled') {
          anySuccess = true;
          setProgress((prev) => {
            // 服务端已有的题覆盖本机缓存（跨设备改过的状态以服务端为准）；
            // 服务端没有的题保留本地值，承接离线 / 尚未同步的改动。
            const merged: Record<string, InterviewState> = { ...prev };
            for (const item of progressResult.value) {
              merged[item.questionId] = item;
            }
            try {
              userScopedStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
            } catch { /* ignore */ }
            return merged;
          });
        }
        if (statsResult.status === 'fulfilled') {
          anySuccess = true;
          setStats(statsResult.value);
        }
        if (attemptsResult.status === 'fulfilled') {
          anySuccess = true;
          setAttempts(attemptsResult.value);
        }
        if (!anySuccess) setSyncError('后端暂不可用：学习状态保存在本机，AI 评估需要后端恢复后才能用。');
        else setSyncError('');
      })
      .catch(() => {
        if (!cancelled) setSyncError('后端暂不可用：学习状态保存在本机。');
      });
    return () => { cancelled = true; };
  }, []);

  const masteredCount = useMemo(
    () => Object.values(progress).filter((state) => state.mastered).length,
    [progress],
  );
  const practicedCount = useMemo(
    () => Object.values(progress).filter((state) => state.practiceCount > 0).length,
    [progress],
  );
  const localAvg = useMemo(() => {
    const scored = Object.values(progress).filter((state) => state.lastScore != null);
    if (!scored.length) return null;
    return Math.round(scored.reduce((sum, state) => sum + (state.lastScore || 0), 0) / scored.length);
  }, [progress]);
  const avgScore = stats?.avgScore ?? localAvg;
  const todayCount = stats?.todayAttempts ?? 0;

  const activity = useMemo(() => {
    const days = stats?.days ?? [];
    if (days.length) {
      const max = Math.max(1, ...days.map((day) => day.count));
      return days.map((day) => ({
        key: day.date,
        label: new Date(`${day.date}T00:00:00`).toLocaleDateString('zh-CN', { weekday: 'short' }),
        count: day.count,
        height: day.count ? Math.max(12, (day.count / max) * 100) : 4,
      }));
    }
    return Array.from({ length: 7 }, (_, index) => ({
      key: String(index),
      label: ['一', '二', '三', '四', '五', '六', '日'][index],
      count: 0,
      height: 4,
    }));
  }, [stats]);

  const openQuestion = async (question: InterviewQuestionSummary) => {
    setAssistantQuestion(null);
    try {
      const detail = await fetchInterviewQuestionDetail(question.id);
      setSelectedQuestion(detail);
    } catch {
      setSyncError('题目详情读取失败，稍后重试。');
    }
  };

  const openAssistant = (question: InterviewQuestion) => {
    setAssistantQuestion(question);
    setSelectedQuestion(null);
  };

  const closeQuestion = () => {
    setAssistantQuestion(null);
    setSelectedQuestion(null);
  };

  const toggleStar = async (question: { id: string }) => {
    const current = progress[question.id] || emptyState(question.id);
    const optimistic = { ...current, starred: !current.starred };
    applyState(optimistic);
    try {
      const saved = await updateInterviewProgress({ questionId: question.id, starred: optimistic.starred });
      applyState(saved);
      setSyncError('');
    } catch {
      setSyncError('收藏没有同步到后端，已保存在本机。');
    }
  };

  const setMastered = async (question: { id: string }, mastered: boolean) => {
    const current = progress[question.id] || emptyState(question.id);
    const optimistic = { ...current, mastered, confidence: mastered ? 2 : current.confidence };
    applyState(optimistic);
    try {
      const saved = await updateInterviewProgress({ questionId: question.id, mastered });
      applyState(saved);
      await refreshStats();
      setSyncError('');
    } catch {
      setSyncError('掌握状态没有同步到后端，已保存在本机。');
    }
  };

  const setConfidence = async (question: { id: string }, confidence: number) => {
    const current = progress[question.id] || emptyState(question.id);
    const optimistic = { ...current, confidence, mastered: confidence === 2 ? true : current.mastered };
    applyState(optimistic);
    try {
      const saved = await updateInterviewProgress({ questionId: question.id, confidence });
      applyState(saved);
      setSyncError('');
    } catch {
      setSyncError('自评没有同步到后端，已保存在本机。');
    }
  };

  const startPractice = (question: { id: string }) => {
    setSelectedQuestion(null);
    setMockQuestionId(question.id);
    setTab('mock');
  };

  const startRandom = async () => {
    try {
      const random = await fetchRandomInterviewQuestion();
      setSelectedQuestion(null);
      setMockQuestion(random);
      setMockQuestionId(random.id);
      setTab('mock');
      setSyncError('');
    } catch {
      setSyncError('随机题目读取失败，稍后重试。');
    }
  };

  const openBook = (question: InterviewQuestionSummary) => {
    if (!question.bookId) return;
    setSelectedQuestion(null);
    setBookTarget({
      bookId: question.bookId,
      page: Math.max(1, question.bookPage || 1),
      questionId: question.id,
    });
    setTab('books');
  };

  const onEvaluationDone = (result: InterviewEvaluation) => {
    if (result.state) applyState(result.state);
    void refreshStats();
    void refreshAttempts();
  };

  const openP5Compare = useCallback((seedText = '') => {
    setP5Seed(seedText);
    setP5Open(true);
  }, []);

  const questionCount = meta?.count ?? 0;
  const projectCount = meta?.typeCounts.project ?? 0;
  const knowledgeCount = meta?.knowledgeCount ?? 0;
  const sourceCounts = meta?.sourceCounts ?? {};
  const countBase = Math.max(1, questionCount);

  const tabs: Array<{ key: TabKey; label: string; count?: number; icon: React.ReactNode; hint: string }> = [
    { key: 'all', label: '题库', count: questionCount, icon: <Layers size={15} />, hint: '三本书 + 微调/原理 + 个人项目' },
    { key: 'project', label: '项目特训', count: projectCount, icon: <Telescope size={15} />, hint: '按面试分组深挖' },
    { key: 'mock', label: '模拟面试', icon: <MessageSquare size={15} />, hint: '作答 → 评分 → 追问' },
    { key: 'books', label: '三本书', count: 603, icon: <BookOpen size={15} />, hint: '304 + 172 + 127 页' },
    { key: 'knowledge', label: '知识库', count: knowledgeCount, icon: <BookMarked size={15} />, hint: 'DeepSeek / 微调 / 个人项目' },
  ];

  return (
    <div className="iv-page">
      <PageTitle
        title="面试 Agent"
        subtitle="三本书 + 微调/原理 + 个人项目压成题库，作答后按五个维度打分，再把薄弱点送回复习。"
        icon={<Brain size={22} />}
        action={(
          <div className="iv-title-actions">
            <InterviewSearch
              onOpenQuestion={openQuestion}
              onOpenKnowledge={(articleId) => {
                setSelectedQuestion(null);
                setAssistantQuestion(null);
                setKnowledgeFocus({ id: articleId, nonce: Date.now() });
                setTab('knowledge');
              }}
            />
            <button className="iv-btn iv-btn-ghost" onClick={() => setTab('knowledge')}>
              <BookMarked size={14} /> 知识库
            </button>
            <button className="iv-btn iv-btn-ghost" onClick={() => setTab('books')}>
              <BookOpen size={14} /> 打开书库
            </button>
            <button className="iv-btn iv-btn-primary" onClick={startRandom}>
              <Play size={14} /> 随机开考
            </button>
          </div>
        )}
      />

      <section className="iv-hero">
        <div className="iv-hero-copy">
          <span className="iv-eyebrow">PERSONAL INTERVIEW LAB · 2026</span>
          <h1>把「看过」变成「讲得出」。</h1>
          <p>
            {questionCount} 道题来自《AI Agent 应用开发宝典》《后端九件套》《后端工程学习宝典》，
            外加项目档案、个人项目题和手写底座题。每题都能落到原书页、评分点、追问链和一次 AI 压力面。
          </p>
          <div className="iv-hero-tags">
            <span>Agent / RAG</span>
            <span>微调 / DeepSeek 原理</span>
            <span>Jev / 快慢架构</span>
            <span>异步 / 连接池 / 限流</span>
            <span>任务 DAG / 事务 / 幂等</span>
            <span>个人项目 / 真实进度</span>
          </div>
        </div>
        <div className="iv-hero-index">
          <span>QUESTION INDEX</span>
          <strong>{questionCount}</strong>
          <em>题 · 3 books · 603 pages</em>
          <div className="iv-hero-index-line">
            <span style={{ width: `${Math.round((masteredCount / countBase) * 100)}%` }} />
          </div>
          <small>{masteredCount} 已收口 · {practicedCount} 已练过</small>
        </div>
      </section>

      <section className="iv-stat-strip" aria-label="学习统计">
        <div className="iv-stat">
          <span className="iv-stat-icon"><CircleDot size={16} /></span>
          <div>
            <strong>{questionCount}</strong>
            <span>总题数</span>
          </div>
          <em>B {sourceCounts['书B'] ?? 0} · C {sourceCounts['书C'] ?? 0} · D {sourceCounts['书D'] ?? 0} · 补 {sourceCounts['补充'] ?? 0}</em>
        </div>
        <div className="iv-stat">
          <span className="iv-stat-icon iv-stat-success"><Target size={16} /></span>
          <div>
            <strong>{masteredCount}</strong>
            <span>已掌握</span>
          </div>
          <em>{Math.round((masteredCount / countBase) * 100)}% 收口</em>
        </div>
        <div className="iv-stat">
          <span className="iv-stat-icon iv-stat-accent"><Flame size={16} /></span>
          <div>
            <strong>{avgScore ?? '—'}</strong>
            <span>平均评分</span>
          </div>
          <em>{avgScore == null ? '还没作答' : verdictLabel(avgScore)}</em>
        </div>
        <div className="iv-stat iv-stat-activity">
          <div className="iv-stat-activity-head">
            <span><Clock3 size={14} /> 今日 {todayCount} 次</span>
            <em>{practicedCount} 题有记录</em>
          </div>
          <div className="iv-activity-bars" aria-label="最近七天作答">
            {activity.map((day) => (
              <span key={day.key} title={`${day.label} ${day.count} 次`}>
                <i style={{ height: `${day.height}%` }} />
                <b>{day.label}</b>
              </span>
            ))}
          </div>
        </div>
      </section>

      {syncError && (
        <div className="iv-sync-banner">
          <RefreshCw size={14} />
          <span>{syncError}</span>
          <button className="iv-text-btn" onClick={() => { void refreshStats(); void refreshAttempts(); }}>重试同步</button>
        </div>
      )}

      <nav className="iv-tabs" aria-label="面试功能">
        {tabs.map((item) => (
          <button
            key={item.key}
            className={`iv-tab ${tab === item.key ? 'is-active' : ''}`}
            onClick={() => setTab(item.key)}
          >
            <span className="iv-tab-icon">{item.icon}</span>
            <span className="iv-tab-label">{item.label}</span>
            {item.count != null && <span className="iv-tab-count">{item.count}</span>}
            <span className="iv-tab-hint">{item.hint}</span>
          </button>
        ))}
        <div className="iv-tab-spacer">
          <span className="iv-sync-state">
            {syncError ? <><CircleDot size={12} className="is-warn" /> 本机模式</> : <><CircleDot size={12} /> 已同步</>}
          </span>
        </div>
      </nav>

      {tab === 'all' && (
        <QuestionBankTab mode="all" progress={progress} onOpen={openQuestion} onStar={toggleStar} />
      )}
      {tab === 'project' && (
        <QuestionBankTab mode="project" progress={progress} onOpen={openQuestion} onStar={toggleStar} />
      )}
      {tab === 'mock' && (
        <Suspense fallback={(
          <div className="iv-bank">
            <div className="iv-empty">
              <RefreshCw size={26} />
              <p>模拟面试模块加载中…</p>
            </div>
          </div>
        )}>
          <MockInterviewTab
            progress={progress}
            attempts={attempts}
            pinnedQuestionId={mockQuestionId}
            onEvaluationDone={onEvaluationDone}
            onOpenDetail={openQuestion}
            onMastered={setMastered}
            onOpenP5Compare={openP5Compare}
          />
        </Suspense>
      )}
      {tab === 'books' && <BookReaderTab target={bookTarget} onClearTarget={() => setBookTarget(null)} />}
      {tab === 'knowledge' && (
        <KnowledgeBaseTab
          onOpenQuestion={openQuestion}
          onOpenP5Compare={() => openP5Compare()}
          focusArticle={knowledgeFocus}
        />
      )}

      {selectedQuestion && (
        <QuestionDrawer
          question={selectedQuestion}
          state={progress[selectedQuestion.id]}
          onClose={closeQuestion}
          onAssistant={openAssistant}
          onStar={toggleStar}
          onMastered={setMastered}
          onConfidence={setConfidence}
          onPractice={startPractice}
          onOpenBook={openBook}
        />
      )}

      <P5CompareDrawer
        open={p5Open}
        seedText={p5Seed}
        onClose={() => setP5Open(false)}
      />
    </div>
  );
};
