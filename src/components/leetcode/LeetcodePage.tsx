import React from 'react';
import { Code, CheckCircle, Flame, Target, TrendingUp, Filter } from 'lucide-react';
import { PageTitle } from '../shared';

const MOCK_PROBLEMS = [
  { id: 1, title: '两数之和', difficulty: 'Easy', tag: '数组/哈希', solved: true, time: '8分钟' },
  { id: 15, title: '三数之和', difficulty: 'Medium', tag: '双指针', solved: true, time: '22分钟' },
  { id: 20, title: '有效的括号', difficulty: 'Easy', tag: '栈', solved: true, time: '5分钟' },
  { id: 42, title: '接雨水', difficulty: 'Hard', tag: '动态规划', solved: false, time: '-' },
  { id: 76, title: '最小覆盖子串', difficulty: 'Hard', tag: '滑动窗口', solved: false, time: '-' },
  { id: 200, title: '岛屿数量', difficulty: 'Medium', tag: 'BFS/DFS', solved: true, time: '15分钟' },
  { id: 206, title: '反转链表', difficulty: 'Easy', tag: '链表', solved: true, time: '3分钟' },
  { id: 322, title: '零钱兑换', difficulty: 'Medium', tag: '动态规划', solved: false, time: '-' },
];

const DIFF_COLOR: Record<string, string> = {
  Easy: 'bg-[var(--success-bg)] text-[var(--success)]',
  Medium: 'bg-[var(--bg-accent)] text-[var(--accent)]',
  Hard: 'bg-[var(--danger-bg)] text-[var(--danger)]',
};

export const LeetcodePage: React.FC = () => {
  return (
    <div className="w-full pt-2 space-y-6">
      <PageTitle dev
        title="LeetCode"
        subtitle="刷题训练，算法提升"
        icon={<Code size={22} />}
      />

      {/* Stats */}
      <div className="auto-grid-cards">
        <div className="bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl p-4">
          <div className="flex items-center gap-2 text-[var(--success)] mb-2"><CheckCircle size={16} /><span className="text-xs font-medium">已解决</span></div>
          <p className="text-2xl font-bold text-[var(--text-primary)]">128</p>
          <p className="text-[10px] text-[var(--text-muted)] mt-1">/ 2500 题库</p>
        </div>
        <div className="bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl p-4">
          <div className="flex items-center gap-2 text-[var(--warn)] mb-2"><Flame size={16} /><span className="text-xs font-medium">连续打卡</span></div>
          <p className="text-2xl font-bold text-[var(--text-primary)]">14 天</p>
          <p className="text-[10px] text-[var(--success)] mt-1">保持势头!</p>
        </div>
        <div className="bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl p-4">
          <div className="flex items-center gap-2 text-[var(--info)] mb-2"><Target size={16} /><span className="text-xs font-medium">通过率</span></div>
          <p className="text-2xl font-bold text-[var(--text-primary)]">72%</p>
          <p className="text-[10px] text-[var(--success)] mt-1">+5% vs 上月</p>
        </div>
        <div className="bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl p-4">
          <div className="flex items-center gap-2 text-[#8b5cf6] mb-2"><TrendingUp size={16} /><span className="text-xs font-medium">本周刷题</span></div>
          <p className="text-2xl font-bold text-[var(--text-primary)]">12</p>
          <p className="text-[10px] text-[var(--text-muted)] mt-1">目标 15 题</p>
        </div>
      </div>

      {/* Difficulty breakdown */}
      <div className="auto-grid-compact">
        {['Easy', 'Medium', 'Hard'].map((d) => (
          <div key={d} className="flex-1 bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl p-3 text-center">
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${DIFF_COLOR[d]}`}>{d}</span>
            <p className="text-lg font-bold text-[var(--text-primary)] mt-1">{d === 'Easy' ? 68 : d === 'Medium' ? 45 : 15}</p>
          </div>
        ))}
      </div>

      {/* Problem list */}
      <div className="bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl overflow-hidden">
        <div className="p-4 border-b border-[var(--border-light)] flex items-center justify-between">
          <h3 className="text-sm font-medium text-[var(--text-primary)]">题目列表</h3>
          <button className="flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><Filter size={12} />筛选</button>
        </div>
        <div className="divide-y divide-[var(--border-light)]">
          {MOCK_PROBLEMS.map((p) => (
            <div key={p.id} className="flex min-w-0 flex-wrap items-center gap-3 px-4 py-3 hover:bg-[var(--bg-accent)] transition-colors cursor-pointer">
              <span className={`w-5 h-5 rounded-full flex items-center justify-center ${p.solved ? 'bg-[var(--success)]' : 'bg-[var(--border-light)]'}`}>
                {p.solved && <CheckCircle size={12} className="text-white" />}
              </span>
              <span className="text-xs font-mono text-[var(--text-muted)] w-8">{p.id}</span>
              <span className="min-w-[140px] flex-1 text-sm text-[var(--text-primary)]">{p.title}</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${DIFF_COLOR[p.difficulty]}`}>{p.difficulty}</span>
              <span className="text-[10px] px-2 py-0.5 bg-[var(--bg-base)] text-[var(--text-secondary)] rounded-full">{p.tag}</span>
              <span className="text-xs text-[var(--text-muted)] w-14 text-right">{p.time}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
