import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Filter,
  Loader2,
  Search,
  Star,
  CheckCircle2,
  SlidersHorizontal,
} from 'lucide-react';
import { GROUP_LABELS, GROUP_ORDER, sourceLabel, typeLabel } from '../../data/interview/labels';
import type { InterviewQuestionSummary, InterviewState } from '../../data/interview/types';
import { fetchInterviewQuestionSummaries } from '../../lib/interviewApi';

interface QuestionBankTabProps {
  mode: 'all' | 'project';
  progress: Record<string, InterviewState>;
  onOpen: (question: InterviewQuestionSummary) => void;
  onStar: (question: InterviewQuestionSummary) => void;
}

const TYPES = ['all', 'concept', 'code', 'handwrite', 'debug', 'scenario', 'compare', 'troubleshoot', 'system', 'project', 'behavioral'];
const SOURCES = ['all', '书B', '书C', '书D', '补充', '项目', '个人项目'];
const STATUS = [
  { key: 'all', label: '全部' },
  { key: 'todo', label: '未掌握' },
  { key: 'mastered', label: '已掌握' },
  { key: 'starred', label: '收藏' },
  { key: 'weak', label: '薄弱' },
];

function scoreOf(question: InterviewQuestionSummary, progress: Record<string, InterviewState>): number | null {
  const state = progress[question.id];
  return state?.lastScore ?? null;
}

export const QuestionBankTab: React.FC<QuestionBankTabProps> = ({ mode, progress, onOpen, onStar }) => {
  const [questions, setQuestions] = useState<InterviewQuestionSummary[]>([]);
  const [bankState, setBankState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [bankError, setBankError] = useState('');
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('all');
  const [resumeGroup, setResumeGroup] = useState('all');
  const [type, setType] = useState(mode === 'project' ? 'project' : 'all');
  const [source, setSource] = useState('all');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('default');
  const [visible, setVisible] = useState(60);

  useEffect(() => {
    let alive = true;
    setBankState('loading');
    fetchInterviewQuestionSummaries({ limit: 400 })
      .then((page) => {
        if (!alive) return;
        setQuestions(page.items);
        setBankState('ready');
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setBankError(err instanceof Error ? err.message : '题库加载失败');
        setBankState('error');
      });
    return () => { alive = false; };
  }, []);

  const base = useMemo(
    () => (mode === 'project' ? questions.filter((q) => q.type === 'project') : questions),
    [mode, questions],
  );

  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const q of base) counts[q.group] = (counts[q.group] || 0) + 1;
    return counts;
  }, [base]);

  const projectGroups = useMemo(() => {
    const map = new Map<string, { label: string; count: number; mastered: number }>();
    for (const q of base) {
      const entry = map.get(q.resumeGroup) || { label: q.resumeGroupLabel, count: 0, mastered: 0 };
      entry.count += 1;
      if (progress[q.id]?.mastered) entry.mastered += 1;
      map.set(q.resumeGroup, entry);
    }
    return Array.from(map.entries());
  }, [base, progress]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const list = base.filter((q) => {
      if (group !== 'all' && q.group !== group) return false;
      if (resumeGroup !== 'all' && q.resumeGroup !== resumeGroup) return false;
      if (type !== 'all' && q.type !== type) return false;
      if (source !== 'all' && q.source !== source) return false;
      const state = progress[q.id];
      if (status === 'todo' && state?.mastered) return false;
      if (status === 'mastered' && !state?.mastered) return false;
      if (status === 'starred' && !state?.starred) return false;
      if (status === 'weak' && (!state?.practiceCount || (state.lastScore ?? 100) >= 60)) return false;
      if (!keyword) return true;
      return [q.title, q.question, q.chapter, q.groupLabel, q.tags.join(' ')].join(' ').toLowerCase().includes(keyword);
    });

    if (sort === 'weak') {
      return [...list].sort((a, b) => {
        const sa = scoreOf(a, progress);
        const sb = scoreOf(b, progress);
        if (sa == null && sb == null) return 0;
        if (sa == null) return -1;
        if (sb == null) return 1;
        return sa - sb;
      });
    }
    if (sort === 'practiced') {
      return [...list].sort((a, b) => (progress[b.id]?.practiceCount || 0) - (progress[a.id]?.practiceCount || 0));
    }
    return list;
  }, [base, group, resumeGroup, type, source, status, search, sort, progress]);

  const resetFilters = () => {
    setSearch('');
    setGroup('all');
    setResumeGroup('all');
    setType(mode === 'project' ? 'project' : 'all');
    setSource('all');
    setStatus('all');
    setSort('default');
    setVisible(60);
  };

  const shown = filtered.slice(0, visible);
  const masteredCount = filtered.filter((q) => progress[q.id]?.mastered).length;

  if (bankState !== 'ready') {
    return (
      <div className="iv-bank">
        <div className="iv-empty">
          {bankState === 'loading' ? <Loader2 size={26} className="iv-spin" /> : <Filter size={26} />}
          <p>{bankState === 'loading' ? '题库加载中…' : `题库接口不可用：${bankError}`}</p>
          {bankState === 'error' && (
            <button className="iv-btn" onClick={() => window.location.reload()}>重新加载</button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="iv-bank">
      {mode === 'project' && (
        <div className="iv-project-strip">
          <div className="iv-project-strip-head">
            <span className="iv-eyebrow">项目题矩阵</span>
            <p>面试官不会只问“做了什么”，会追“为什么这么设计、崩了怎么办、数据怎么证明”。</p>
          </div>
          <div className="iv-project-groups">
            {projectGroups.map(([key, entry]) => (
              <button
                key={key}
                className={`iv-project-group ${resumeGroup === key ? 'is-active' : ''}`}
                onClick={() => setResumeGroup(resumeGroup === key ? 'all' : key)}
              >
                <span>{entry.label}</span>
                <strong>{entry.count}</strong>
                <em>{entry.mastered} 已掌握</em>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="iv-toolbar">
        <div className="iv-search">
          <Search size={16} />
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setVisible(60);
            }}
            placeholder={mode === 'project' ? '搜项目、技术点、追问关键词…' : '搜题目、章节、标签…'}
            aria-label="搜索题目"
          />
          {search && (
            <button className="iv-search-clear" onClick={() => setSearch('')} aria-label="清空搜索">
              ×
            </button>
          )}
        </div>

        <div className="iv-filter-row">
          <span className="iv-filter-label">
            <Filter size={13} /> 分组
          </span>
          <div className="iv-chip-scroll">
            <button className={`iv-chip ${group === 'all' ? 'is-on' : ''}`} onClick={() => setGroup('all')}>
              全部
            </button>
            {GROUP_ORDER.map((key) => (
              <button
                key={key}
                className={`iv-chip ${group === key ? 'is-on' : ''}`}
                onClick={() => setGroup(key)}
              >
                {GROUP_LABELS[key]} <em>{groupCounts[key] ?? 0}</em>
              </button>
            ))}
          </div>
        </div>

        <div className="iv-filter-row iv-filter-row-wrap">
          <span className="iv-filter-label">
            <SlidersHorizontal size={13} /> 筛选
          </span>
          <label className="iv-select-wrap">
            <span className="sr-only">题型</span>
            <select value={type} onChange={(event) => setType(event.target.value)}>
              {TYPES.map((item) => (
                <option key={item} value={item}>
                  {item === 'all' ? '全部题型' : typeLabel(item)}
                </option>
              ))}
            </select>
            <ChevronDown size={13} />
          </label>
          <label className="iv-select-wrap">
            <span className="sr-only">来源</span>
            <select value={source} onChange={(event) => setSource(event.target.value)}>
              {SOURCES.map((item) => (
                <option key={item} value={item}>
                  {item === 'all' ? '全部来源' : sourceLabel(item)}
                </option>
              ))}
            </select>
            <ChevronDown size={13} />
          </label>
          <label className="iv-select-wrap">
            <span className="sr-only">状态</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              {STATUS.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
            <ChevronDown size={13} />
          </label>
          <label className="iv-select-wrap">
            <span className="sr-only">排序</span>
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="default">默认顺序</option>
              <option value="weak">薄弱优先</option>
              <option value="practiced">练习最多</option>
            </select>
            <ChevronDown size={13} />
          </label>
          {(search || group !== 'all' || resumeGroup !== 'all' || type !== (mode === 'project' ? 'project' : 'all') || source !== 'all' || status !== 'all' || sort !== 'default') && (
            <button className="iv-text-btn iv-reset" onClick={resetFilters}>
              重置
            </button>
          )}
        </div>
      </div>

      <div className="iv-bank-summary">
        <span>
          <strong>{filtered.length}</strong> 道题
          {mode === 'project' ? ' · 项目档案' : ''}
        </span>
        <span className="iv-muted">
          已掌握 {masteredCount} / {filtered.length}
        </span>
      </div>

      {shown.length === 0 ? (
        <div className="iv-empty">
          <Search size={26} />
          <p>这组条件下没有题。换个关键词，或者把状态筛选清掉。</p>
          <button className="iv-btn" onClick={resetFilters}>重置筛选</button>
        </div>
      ) : (
        <>
          <div className="iv-question-grid">
            {shown.map((question) => {
              const state = progress[question.id];
              return (
                <article
                  key={question.id}
                  className={`iv-q-card ${state?.mastered ? 'is-mastered' : ''} ${state?.starred ? 'is-starred' : ''}`}
                  data-source={question.source}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpen(question)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onOpen(question);
                    }
                  }}
                >
                  <div className="iv-q-card-top">
                    <span className={`iv-source iv-source-${question.source}`}>{question.source}</span>
                    <span className="iv-q-type">{typeLabel(question.type)}</span>
                    <span className="iv-q-difficulty">{question.difficulty}</span>
                    <button
                      className={`iv-star-btn iv-star-sm ${state?.starred ? 'is-on' : ''}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onStar(question);
                      }}
                      aria-label={state?.starred ? '取消收藏' : '收藏'}
                    >
                      <Star size={14} fill={state?.starred ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                  <h3 className="iv-q-title">{question.title}</h3>
                  <p className="iv-q-preview">{question.question}</p>
                  <div className="iv-q-meta">
                    <span>{question.chapter}</span>
                    <span className="iv-q-meta-dot" />
                    <span>{question.groupLabel}</span>
                    <span className="iv-q-meta-dot" />
                    <span>{question.resumeGroupLabel}</span>
                  </div>
                  <div className="iv-q-foot">
                    <div className="iv-q-tags">
                      {question.tags.slice(0, 3).map((tag) => (
                        <span key={tag}>#{tag}</span>
                      ))}
                    </div>
                    <div className="iv-q-state">
                      {state?.mastered && <CheckCircle2 size={14} className="iv-ok" />}
                      {state?.lastScore != null && <span className={`iv-score-mini ${state.lastScore < 60 ? 'is-low' : state.lastScore < 80 ? 'is-mid' : 'is-high'}`}>{state.lastScore}</span>}
                      <ChevronRight size={14} />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {visible < filtered.length && (
            <button className="iv-more" onClick={() => setVisible((value) => value + 60)}>
              再加载 60 道 <span>{visible} / {filtered.length}</span>
            </button>
          )}
        </>
      )}
    </div>
  );
};
