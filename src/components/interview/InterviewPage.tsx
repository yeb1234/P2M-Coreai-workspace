import React from 'react';
import { MessageSquare, CheckCircle, Star, BookOpen, ChevronRight } from 'lucide-react';
import { PageTitle } from '../shared';

const MOCK_QUESTIONS = [
  { category: 'JavaScript', q: '说说闭包的理解和应用场景', difficulty: '高频', starred: true },
  { category: 'JavaScript', q: 'Promise.all 和 Promise.allSettled 区别', difficulty: '中频', starred: false },
  { category: 'React', q: 'useEffect 的清理函数执行时机', difficulty: '高频', starred: true },
  { category: 'React', q: '虚拟 DOM 的 diff 算法原理', difficulty: '高频', starred: true },
  { category: 'CSS', q: 'BFC 是什么，如何触发', difficulty: '中频', starred: false },
  { category: '网络', q: 'HTTPS 握手过程', difficulty: '高频', starred: true },
  { category: '网络', q: 'HTTP/2 和 HTTP/3 的区别', difficulty: '低频', starred: false },
  { category: '性能', q: '首屏加载优化方案', difficulty: '高频', starred: true },
];

const CATEGORIES = ['全部', 'JavaScript', 'React', 'CSS', '网络', '性能', '算法', '项目'];

export const InterviewPage: React.FC = () => {
  return (
    <div className="w-full pt-2 space-y-6">
      <PageTitle dev
        title="面试鸭"
        subtitle="高频面试题库，模拟面试训练"
        icon={<MessageSquare size={22} />}
      />

      {/* Stats */}
      <div className="auto-grid-compact">
        <div className="bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl p-4 text-center">
          <BookOpen size={20} className="text-[var(--info)] mx-auto mb-2" />
          <p className="text-xl font-bold text-[var(--text-primary)]">156</p>
          <p className="text-xs text-[var(--text-muted)]">总题数</p>
        </div>
        <div className="bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl p-4 text-center">
          <CheckCircle size={20} className="text-[var(--success)] mx-auto mb-2" />
          <p className="text-xl font-bold text-[var(--text-primary)]">89</p>
          <p className="text-xs text-[var(--text-muted)]">已掌握</p>
        </div>
        <div className="bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl p-4 text-center">
          <Star size={20} className="text-[var(--warn)] mx-auto mb-2" />
          <p className="text-xl font-bold text-[var(--text-primary)]">23</p>
          <p className="text-xs text-[var(--text-muted)]">收藏</p>
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {CATEGORIES.map((c) => (
          <button key={c} className={`px-3 py-1.5 text-xs rounded-lg whitespace-nowrap transition-colors ${c === '全部' ? 'bg-[var(--bg-accent)] text-[var(--accent)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-base)]'}`}>
            {c}
          </button>
        ))}
      </div>

      {/* Questions */}
      <div className="bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl overflow-hidden">
        <div className="divide-y divide-[var(--border-light)]">
          {MOCK_QUESTIONS.map((item, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3.5 hover:bg-[var(--bg-accent)] transition-colors cursor-pointer group">
              <span className={`w-5 h-5 rounded-full flex items-center justify-center ${item.starred ? 'bg-[var(--warn)]' : 'bg-[var(--border-light)]'}`}>
                {item.starred && <Star size={10} className="text-white" />}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">{item.q}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs px-1.5 py-0.5 bg-[var(--info-bg)] text-[var(--info)] rounded">{item.category}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${item.difficulty === '高频' ? 'bg-[var(--danger-bg)] text-[var(--danger)]' : item.difficulty === '中频' ? 'bg-[var(--bg-accent)] text-[var(--accent)]' : 'bg-[var(--bg-base)] text-[var(--text-muted)]'}`}>
                    {item.difficulty}
                  </span>
                </div>
              </div>
              <ChevronRight size={14} className="text-[var(--border-medium)] group-hover:text-[var(--text-secondary)]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
