import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  BookMarked,
  Check,
  ChevronRight,
  ExternalLink,
  Filter,
  GraduationCap,
  Search,
  Sparkles,
} from 'lucide-react';
import knowledgeRaw from '../../data/interview/knowledge.json';
import type { InterviewQuestionSummary, KnowledgeArticle, KnowledgeBase } from '../../data/interview/types';
import { fetchInterviewQuestionSummaries } from '../../lib/interviewApi';
import { userScopedStorage } from '../../lib/userScopedStorage';
import { renderMarkdown } from '../../lib/markdown';
import './KnowledgeBaseTab.css';

const KNOWLEDGE = knowledgeRaw as unknown as KnowledgeBase;
const READ_KEY = 'p2.interview.knowledge.read.v1';

interface KnowledgeBaseTabProps {
  onOpenQuestion: (question: InterviewQuestionSummary) => void;
  onOpenP5Compare: () => void;
  focusArticle?: { id: string; nonce: number } | null;
}

function readArticles(): Record<string, boolean> {
  try {
    const raw = userScopedStorage.getItem(READ_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

const QUESTION_MAP_START = new Map<string, InterviewQuestionSummary>();

export const KnowledgeBaseTab: React.FC<KnowledgeBaseTabProps> = ({ onOpenQuestion, onOpenP5Compare, focusArticle }) => {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [activeId, setActiveId] = useState(KNOWLEDGE.articles[0]?.id ?? '');
  const [read, setRead] = useState<Record<string, boolean>>(readArticles);
  const [questionMap, setQuestionMap] = useState<Map<string, InterviewQuestionSummary>>(QUESTION_MAP_START);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetchInterviewQuestionSummaries({ limit: 400 })
      .then((page) => {
        if (!alive) return;
        setQuestionMap(new Map(page.items.map((question) => [question.id, question])));
      })
      .catch(() => { /* 知识库正文不受题库接口影响 */ });
    return () => { alive = false; };
  }, []);

  const categories = useMemo(() => {
    const list = Array.from(new Set(KNOWLEDGE.articles.map((article) => article.category)));
    return ['all', ...list];
  }, []);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return KNOWLEDGE.articles.filter((article) => {
      if (category !== 'all' && article.category !== category) return false;
      if (!keyword) return true;
      return [article.title, article.subtitle, article.summary, article.tags.join(' '), article.category]
        .join(' ')
        .toLowerCase()
        .includes(keyword);
    });
  }, [category, search]);

  const active = useMemo(
    () => filtered.find((article) => article.id === activeId) ?? filtered[0] ?? null,
    [activeId, filtered],
  );

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [active?.id]);

  useEffect(() => {
    if (!focusArticle) return;
    const article = KNOWLEDGE.articles.find((item) => item.id === focusArticle.id);
    if (!article) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearch('');
    setCategory('all');
    setActiveId(article.id);
  }, [focusArticle]);

  const openArticle = (article: KnowledgeArticle) => {
    setActiveId(article.id);
    setRead((prev) => {
      if (prev[article.id]) return prev;
      const next = { ...prev, [article.id]: true };
      try {
        userScopedStorage.setItem(READ_KEY, JSON.stringify(next));
      } catch { /* ignore */ }
      return next;
    });
  };

  const readCount = Object.values(read).filter(Boolean).length;
  const html = useMemo(() => renderMarkdown(active?.body ?? ''), [active]);

  return (
    <div className="kb-shell">
      <aside className="kb-sidebar" aria-label="知识库目录">
        <div className="kb-sidebar-head">
          <span className="kb-eyebrow"><GraduationCap size={14} /> 专题知识库</span>
          <h2>先读原理，再背答案</h2>
          <p>把 DeepSeek 各代、LoRA 全谱系、Jev 快慢架构串成能口述的链路。每篇末尾都能跳到对应题。</p>
          <button className="kb-p5-entry" onClick={onOpenP5Compare}>
            <BarChart3 size={14} />
            <span>
              <strong>P5 知识库对标</strong>
              <small>我的基线 vs 考生方案 · 八维复杂度评分</small>
            </span>
          </button>
        </div>

        <div className="kb-search">
          <Search size={15} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜文章、标签、关键词…"
            aria-label="搜索知识库"
          />
          {search && <button onClick={() => setSearch('')} aria-label="清空搜索">×</button>}
        </div>

        <div className="kb-cats" aria-label="知识库分类">
          {categories.map((item) => (
            <button
              key={item}
              className={`kb-cat ${category === item ? 'is-on' : ''}`}
              onClick={() => setCategory(item)}
            >
              {item === 'all' ? '全部' : item}
            </button>
          ))}
        </div>

        <div className="kb-progress-line">
          <span><Filter size={12} /> {filtered.length} 篇</span>
          <span>{readCount} 篇已读</span>
        </div>

        <nav className="kb-article-list">
          {filtered.map((article) => (
            <button
              key={article.id}
              className={`kb-article-item ${active?.id === article.id ? 'is-active' : ''} ${read[article.id] ? 'is-read' : ''}`}
              onClick={() => openArticle(article)}
            >
              <span className="kb-article-item-top">
                <em>{article.category}</em>
                {read[article.id] ? <Check size={13} /> : <span>{article.readingMinutes} min</span>}
              </span>
              <strong>{article.title}</strong>
              <small>{article.summary}</small>
            </button>
          ))}
          {!filtered.length && <div className="kb-empty">没有匹配文章，换个词。</div>}
        </nav>
      </aside>

      <main className="kb-main">
        {active ? (
          <>
            <header className="kb-article-head">
              <div className="kb-article-meta">
                <span className="kb-category">{active.category}</span>
                <span>{active.readingMinutes} 分钟</span>
                <span>{active.sources.length} 条核验来源</span>
              </div>
              <h1>{active.title}</h1>
              <p className="kb-subtitle">{active.subtitle}</p>
              <div className="kb-tags">
                {active.tags.map((tag) => <span key={tag}>#{tag}</span>)}
              </div>
            </header>

            <div className="kb-body markdown-body" ref={bodyRef} dangerouslySetInnerHTML={{ __html: html }} />

            {active.relatedQuestions.length > 0 && (
              <section className="kb-related">
                <div className="kb-section-title">
                  <Sparkles size={15} />
                  <span>读完直接练</span>
                </div>
                <div className="kb-related-grid">
                  {active.relatedQuestions.map((id) => {
                    const question = questionMap.get(id);
                    if (!question) return null;
                    return (
                      <button key={id} className="kb-related-card" onClick={() => onOpenQuestion(question)}>
                        <span>
                          <em>{question.type === 'project' ? '项目' : question.difficulty}</em>
                          <small>{id}</small>
                        </span>
                        <strong>{question.title}</strong>
                        <ChevronRight size={15} />
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {active.sources.length > 0 && (
              <section className="kb-sources">
                <div className="kb-section-title">
                  <BookMarked size={15} />
                  <span>核验来源</span>
                  <small>面试报数字前，先确认口径</small>
                </div>
                <ul>
                  {active.sources.map((source) => {
                    const isLocal = source.url.startsWith('file://');
                    return (
                      <li key={source.url}>
                        {isLocal ? (
                          <span className="kb-source-local" title={decodeURI(source.url.replace('file:///', ''))}>
                            <span>{source.title}</span>
                            <small>本地文档</small>
                          </span>
                        ) : (
                          <a href={source.url} target="_blank" rel="noreferrer noopener">
                            <span>{source.title}</span>
                            <ExternalLink size={13} />
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </>
        ) : (
          <div className="kb-empty-large">知识库暂时没有文章。</div>
        )}
      </main>
    </div>
  );
};
