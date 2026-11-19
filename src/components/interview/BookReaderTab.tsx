import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Copy,
  Loader2,
  Search,
  X,
} from 'lucide-react';
import { BOOK_TITLES } from '../../data/interview/labels';
import { fetchBook, fetchBookIndex } from '../../lib/interviewApi';
import type { BookData, BookIndexItem } from '../../data/interview/types';

export interface BookTarget {
  bookId: string;
  page: number;
  questionId?: string;
}

interface BookReaderTabProps {
  target: BookTarget | null;
  onClearTarget: () => void;
}

export const BookReaderTab: React.FC<BookReaderTabProps> = ({ target, onClearTarget }) => {
  const [index, setIndex] = useState<BookIndexItem[]>([]);
  const [indexError, setIndexError] = useState('');
  const [bookId, setBookId] = useState('B');
  const [book, setBook] = useState<BookData | null>(null);
  const [loading, setLoading] = useState(false);
  const [bookError, setBookError] = useState('');
  const [pageNumber, setPageNumber] = useState(1);
  const [tocQuery, setTocQuery] = useState('');
  const [search, setSearch] = useState('');
  const [matchPages, setMatchPages] = useState<number[]>([]);
  const [matchCursor, setMatchCursor] = useState(0);
  const [copied, setCopied] = useState(false);

  const currentBookMeta = index.find((item) => item.id === bookId);
  const title = book?.title || currentBookMeta?.title || BOOK_TITLES[bookId as 'B' | 'C' | 'D'] || bookId;
  const totalPages = book?.page_count || currentBookMeta?.page_count || 0;
  const currentPage = book?.pages.find((page) => page.n === pageNumber) || null;
  const pageText = (currentPage?.text as string | undefined) || '';
  const toc = book?.toc || [];

  useEffect(() => {
    let cancelled = false;
    fetchBookIndex()
      .then((items) => {
        if (cancelled) return;
        setIndex(items);
        setIndexError('');
        if (target?.bookId) setBookId(target.bookId);
        else if (items[0] && !items.some((item) => item.id === bookId)) setBookId(items[0].id);
      })
      .catch((err: unknown) => {
        if (!cancelled) setIndexError(err instanceof Error ? err.message : '书库索引加载失败');
      });
    return () => { cancelled = true; };
  }, []); // 只拉一次索引；target 在下面的 effect 里处理

  useEffect(() => {
    if (!target) return;
    setBookId(target.bookId);
    setPageNumber(Math.max(1, target.page || 1));
    setSearch('');
    setMatchPages([]);
  }, [target]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setBookError('');
    fetchBook(bookId)
      .then((data) => {
        if (cancelled) return;
        setBook(data);
        setPageNumber((value) => Math.min(Math.max(1, value), data.page_count));
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setBook(null);
        setLoading(false);
        setBookError(err instanceof Error ? err.message : '书加载失败');
      });
    return () => { cancelled = true; };
  }, [bookId]);

  const filteredToc = useMemo(() => {
    const keyword = tocQuery.trim().toLowerCase();
    if (!keyword) return toc;
    return toc.filter((entry) => `${entry.id} ${entry.title}`.toLowerCase().includes(keyword));
  }, [toc, tocQuery]);

  const runSearch = useCallback(() => {
    if (!book || !search.trim()) {
      setMatchPages([]);
      setMatchCursor(0);
      return;
    }
    const keyword = search.trim().toLowerCase();
    const matches = book.pages
      .filter((page) => ((page.text as string | undefined) || '').toLowerCase().includes(keyword))
      .map((page) => page.n);
    setMatchPages(matches);
    setMatchCursor(0);
    if (matches[0]) setPageNumber(matches[0]);
  }, [book, search]);

  const jumpToMatch = (direction: 1 | -1) => {
    if (!matchPages.length) return;
    const next = (matchCursor + direction + matchPages.length) % matchPages.length;
    setMatchCursor(next);
    setPageNumber(matchPages[next]);
  };

  const goPage = (value: number) => {
    if (!totalPages) return;
    setPageNumber(Math.min(Math.max(1, value), totalPages));
  };

  const copyPage = async () => {
    try {
      await navigator.clipboard.writeText(pageText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="iv-books">
      <div className="iv-books-head">
        <div>
          <span className="iv-eyebrow">Book Shelf / 三本书原文</span>
          <h2>题在库里，答案在书里。</h2>
          <p>按页读取 603 页原文；从题目里的「去书里看」会直接落到对应页。</p>
        </div>
        {target && (
          <div className="iv-book-target">
            <span>已从题目定位到 {target.bookId} · p.{target.page}</span>
            <button className="iv-icon-btn iv-icon-xs" onClick={onClearTarget} aria-label="关闭定位提示">
              <X size={14} />
            </button>
          </div>
        )}
      </div>

      <div className="iv-book-selector">
        {index.length === 0 && !indexError && <span className="iv-muted"><Loader2 size={13} className="iv-spin" /> 正在打开书库…</span>}
        {indexError && <span className="iv-inline-error"><AlertCircle size={14} /> {indexError}</span>}
        {index.map((item) => (
          <button
            key={item.id}
            className={`iv-book-tab ${bookId === item.id ? 'is-active' : ''}`}
            onClick={() => {
              setBookId(item.id);
              setPageNumber(1);
              setSearch('');
              setMatchPages([]);
            }}
          >
            <span className="iv-book-tab-id">{item.id}</span>
            <span>
              <strong>{item.title}</strong>
              <em>{item.page_count} 页 · {item.toc_count} 节</em>
            </span>
          </button>
        ))}
      </div>

      <div className="iv-book-layout">
        <aside className="iv-toc">
          <div className="iv-toc-head">
            <span className="iv-eyebrow">目录</span>
            <span className="iv-muted">{filteredToc.length} 节</span>
          </div>
          <div className="iv-toc-search">
            <Search size={14} />
            <input value={tocQuery} onChange={(event) => setTocQuery(event.target.value)} placeholder="过滤章节" aria-label="过滤目录" />
          </div>
          <div className="iv-toc-list">
            {filteredToc.map((entry) => (
              <button
                key={`${entry.id}-${entry.page}`}
                className={`iv-toc-item ${entry.page === pageNumber ? 'is-current' : ''}`}
                onClick={() => goPage(entry.page)}
              >
                <span className="iv-toc-id">{entry.id}</span>
                <span>{entry.title}</span>
                <em>{entry.page}</em>
              </button>
            ))}
          </div>
        </aside>

        <section className="iv-reader">
          <div className="iv-reader-head">
            <div className="iv-reader-title">
              <span className="iv-eyebrow">{bookId} / p.{pageNumber} of {totalPages}</span>
              <h2>{title}</h2>
            </div>
            <div className="iv-reader-tools">
              <button className="iv-icon-btn" onClick={() => goPage(pageNumber - 1)} disabled={pageNumber <= 1} aria-label="上一页">
                <ArrowLeft size={16} />
              </button>
              <label className="iv-page-input">
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, totalPages)}
                  value={pageNumber}
                  onChange={(event) => goPage(Number(event.target.value))}
                  aria-label="页码"
                />
                <span>/ {totalPages}</span>
              </label>
              <button className="iv-icon-btn" onClick={() => goPage(pageNumber + 1)} disabled={pageNumber >= totalPages} aria-label="下一页">
                <ArrowRight size={16} />
              </button>
            </div>
          </div>

          <div className="iv-reader-search">
            <div className="iv-search iv-search-compact">
              <Search size={15} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') runSearch(); }}
                placeholder="在当前这本书里搜关键词，回车跳转"
                aria-label="全书搜索"
              />
              {search && <button className="iv-search-clear" onClick={() => { setSearch(''); setMatchPages([]); }} aria-label="清空搜索">×</button>}
            </div>
            <button className="iv-btn iv-btn-sm" onClick={runSearch}>搜索</button>
            {matchPages.length > 0 && (
              <div className="iv-search-results">
                <span>{matchCursor + 1} / {matchPages.length} 页匹配</span>
                <button className="iv-icon-btn iv-icon-xs" onClick={() => jumpToMatch(-1)} aria-label="上一个匹配"><ArrowLeft size={13} /></button>
                <button className="iv-icon-btn iv-icon-xs" onClick={() => jumpToMatch(1)} aria-label="下一个匹配"><ArrowRight size={13} /></button>
              </div>
            )}
          </div>

          {loading && (
            <div className="iv-book-loading">
              <Loader2 size={22} className="iv-spin" />
              <span>正在解包 {bookId} 的页面…</span>
            </div>
          )}

          {bookError && (
            <div className="iv-error">
              <AlertCircle size={16} />
              <div><strong>书没打开</strong><p>{bookError}</p></div>
            </div>
          )}

          {!loading && !bookError && currentPage && (
            <article className="iv-paper">
              <div className="iv-paper-meta">
                <span>{title}</span>
                <span>p.{pageNumber}</span>
                <button className="iv-text-btn" onClick={copyPage}>
                  <Copy size={13} /> {copied ? '已复制' : '复制本页'}
                </button>
              </div>
              <div className="iv-paper-text">{pageText || '（这一页没有可抽取的文字，可能是纯图版式。）'}</div>
            </article>
          )}

          {!loading && !bookError && !currentPage && book && (
            <div className="iv-empty">
              <BookOpen size={24} />
              <p>这一页没有内容，试试上一页或下一页。</p>
            </div>
          )}

          <footer className="iv-reader-foot">
            <button className="iv-text-btn" onClick={() => goPage(pageNumber - 1)} disabled={pageNumber <= 1}>
              <ArrowLeft size={14} /> 上一页
            </button>
            <span>内容来自已入库的三本书；AI 题库与原文页码可能有一页以内的偏差。</span>
            <button className="iv-text-btn" onClick={() => goPage(pageNumber + 1)} disabled={pageNumber >= totalPages}>
              下一页 <ArrowRight size={14} />
            </button>
          </footer>
        </section>
      </div>
    </div>
  );
};
