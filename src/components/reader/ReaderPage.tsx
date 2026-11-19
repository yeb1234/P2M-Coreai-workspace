import React from 'react';
import { BookOpen, Search, ExternalLink, Clock, Star, Filter } from 'lucide-react';
import { PageTitle } from '../shared';

const MOCK_ARTICLES = [
  { title: '深入理解 JavaScript 事件循环', source: 'MDN', readTime: '12分钟', tag: 'JavaScript', starred: true },
  { title: 'React Server Components 完全指南', source: 'React Blog', readTime: '25分钟', tag: 'React', starred: true },
  { title: 'CSS Container Queries 实战', source: 'web.dev', readTime: '15分钟', tag: 'CSS', starred: false },
  { title: 'TypeScript 5.0 新特性一览', source: 'TS Blog', readTime: '10分钟', tag: 'TypeScript', starred: false },
  { title: 'WebAssembly 入门到精通', source: 'MDN', readTime: '30分钟', tag: 'Wasm', starred: false },
  { title: 'Docker 最佳实践 2026', source: 'Docker Blog', readTime: '18分钟', tag: 'DevOps', starred: true },
];

export const ReaderPage: React.FC = () => {
  return (
    <div className="w-full pt-2 space-y-6">
      <PageTitle dev
        title="阅读器"
        subtitle="收藏文章，离线阅读，标记重点"
        icon={<BookOpen size={22} />}
      />

      <div className="flex gap-3">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder="搜索文章..."
            className="w-full pl-10 pr-4 py-2.5 bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl text-sm outline-none"
          />
        </div>
        <button className="flex items-center gap-1.5 px-3 py-2 text-sm text-[var(--text-secondary)] bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl hover:bg-[var(--bg-base)]">
          <Filter size={14} />
          筛选
        </button>
      </div>

      <div className="space-y-2">
        {MOCK_ARTICLES.map((article) => (
          <div key={article.title} className="flex items-center gap-4 p-4 bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl hover:shadow-md transition-shadow cursor-pointer group">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-[var(--text-primary)] group-hover:text-[var(--info)] transition-colors truncate">
                  {article.title}
                </h3>
                {article.starred && <Star size={12} className="text-[var(--warn)] fill-[#f59e0b] flex-shrink-0" />}
              </div>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-xs text-[var(--text-muted)]">{article.source}</span>
                <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                  <Clock size={10} />
                  {article.readTime}
                </span>
                <span className="text-xs px-2 py-0.5 bg-[var(--info-bg)] text-[var(--info)] rounded-full">{article.tag}</span>
              </div>
            </div>
            <ExternalLink size={14} className="text-[var(--border-medium)] group-hover:text-[var(--text-secondary)] flex-shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
};
