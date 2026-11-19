import React, { useEffect, useRef, useState } from 'react';
import { BookMarked, FileQuestion, Search, X } from 'lucide-react';
import { typeLabel } from '../../data/interview/labels';
import type { InterviewQuestionSummary, InterviewSearchPayload, KnowledgeSummary } from '../../data/interview/types';
import { searchInterviewLibrary } from '../../lib/interviewApi';
import './InterviewPage.css';

interface InterviewSearchProps {
  onOpenQuestion: (question: InterviewQuestionSummary) => void;
  onOpenKnowledge: (articleId: string) => void;
}

export const InterviewSearch: React.FC<InterviewSearchProps> = ({ onOpenQuestion, onOpenKnowledge }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<InterviewSearchPayload | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const keyword = query.trim().toLowerCase();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!keyword) {
      setPayload(null);
      setStatus('idle');
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      setStatus('loading');
      searchInterviewLibrary(keyword, 6)
        .then((result) => {
          if (!alive) return;
          setPayload(result);
          setStatus('ready');
        })
        .catch(() => {
          if (!alive) return;
          setPayload(null);
          setStatus('error');
        });
    }, 180);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [keyword]);

  const questionResults = payload?.questions ?? [];
  const knowledgeResults = payload?.knowledge ?? [];
  const resultCount = questionResults.length + knowledgeResults.length;

  const selectQuestion = (question: InterviewQuestionSummary) => {
    setOpen(false);
    setQuery('');
    onOpenQuestion(question);
  };

  const selectArticle = (article: KnowledgeSummary) => {
    setOpen(false);
    setQuery('');
    onOpenKnowledge(article.id);
  };

  return (
    <div className="iv-global-search" ref={rootRef}>
      <Search size={15} />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false);
            inputRef.current?.blur();
          }
        }}
        placeholder="搜题号、题干、章节、标签…"
        aria-label="搜索面试题库和知识库"
      />
      {query && (
        <button
          className="iv-global-search-clear"
          onClick={() => {
            setQuery('');
            setOpen(false);
            inputRef.current?.focus();
          }}
          aria-label="清空搜索"
        >
          <X size={13} />
        </button>
      )}

      {open && keyword && (
        <div className="iv-global-search-pop" role="listbox" aria-label="搜索结果" aria-busy={status === 'loading'}>
          <div className="iv-global-search-head">
            <span>搜索结果</span>
            <strong>{status === 'loading' ? '搜索中…' : `${resultCount} 条`}</strong>
          </div>

          {questionResults.length > 0 && (
            <div className="iv-global-search-group">
              <span className="iv-global-search-label"><FileQuestion size={12} /> 题库 · {questionResults.length}</span>
              {questionResults.map((question) => (
                <button
                  key={question.id}
                  className="iv-global-search-item"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectQuestion(question)}
                >
                  <span className="iv-global-search-top">
                    <em>{question.id}</em>
                    <b>{typeLabel(question.type)}</b>
                    <small>{question.difficulty}</small>
                  </span>
                  <strong>{question.title}</strong>
                  <span className="iv-global-search-meta">{question.groupLabel} · {question.chapter}</span>
                </button>
              ))}
            </div>
          )}

          {knowledgeResults.length > 0 && (
            <div className="iv-global-search-group">
              <span className="iv-global-search-label"><BookMarked size={12} /> 知识库 · {knowledgeResults.length}</span>
              {knowledgeResults.map((article) => (
                <button
                  key={article.id}
                  className="iv-global-search-item"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectArticle(article)}
                >
                  <span className="iv-global-search-top">
                    <em>{article.category}</em>
                    <small>{article.readingMinutes} min</small>
                  </span>
                  <strong>{article.title}</strong>
                  <span className="iv-global-search-meta">{article.summary}</span>
                </button>
              ))}
            </div>
          )}

          {status === 'error' && (
            <div className="iv-global-search-empty">
              <p>搜索接口暂不可用，稍后再试。</p>
            </div>
          )}

          {status === 'ready' && !resultCount && (
            <div className="iv-global-search-empty">
              <p>没有匹配题或文章。换个关键词，或试试题号前缀。</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default InterviewSearch;
