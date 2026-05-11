import React from 'react';
import { Layers, Plus, Play, RotateCcw } from 'lucide-react';
import { PageTitle } from '../shared';

const MOCK_DECKS = [
  { name: 'JavaScript 基础', cards: 45, mastered: 30, due: 5, color: '#f59e0b' },
  { name: 'React Hooks', cards: 28, mastered: 20, due: 3, color: '#2563eb' },
  { name: 'CSS 选择器', cards: 35, mastered: 35, due: 0, color: '#16a34a' },
  { name: 'HTTP 状态码', cards: 20, mastered: 12, due: 8, color: '#ec4899' },
  { name: 'Git 命令', cards: 30, mastered: 25, due: 2, color: '#8b5cf6' },
];

export const FlashcardsPage: React.FC = () => {
  return (
    <div className="w-full pt-2 space-y-6">
      <PageTitle dev
        title="闪卡记忆"
        subtitle="间隔重复，高效记忆"
        icon={<Layers size={22} />}
        action={
          <button className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-[#f59e0b] rounded-lg hover:bg-[#d97706] transition-colors">
            <Plus size={16} />
            新建卡组
          </button>
        }
      />

      <div className="auto-grid-panels">
        {MOCK_DECKS.map((deck) => (
          <div key={deck.name} className="bg-[#faf9f7] border border-[#e5e2dd] rounded-xl p-5 hover:shadow-md transition-shadow cursor-pointer">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: deck.color }} />
              <h3 className="text-sm font-semibold text-[#1a1a1a]">{deck.name}</h3>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#6b7280] mb-4">
              <span>{deck.cards} 张卡片</span>
              <span className="text-[#16a34a]">{deck.mastered} 已掌握</span>
            </div>
            <div className="w-full bg-[#e5e2dd] rounded-full h-1.5 mb-4">
              <div
                className="h-1.5 rounded-full transition-all"
                style={{ width: `${(deck.mastered / deck.cards) * 100}%`, backgroundColor: deck.color }}
              />
            </div>
            <div className="flex gap-2">
              <button
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg transition-colors ${
                  deck.due > 0
                    ? 'bg-[#fef7ed] text-[#c87d2f] hover:bg-[#fde8d0]'
                    : 'bg-[#f3f2ef] text-[#b8b4ac] cursor-default'
                }`}
              >
                <Play size={12} />
                {deck.due > 0 ? `复习 ${deck.due} 张` : '已完成'}
              </button>
              <button className="p-2 text-[#b8b4ac] hover:text-[#6b7280] bg-[#f3f2ef] rounded-lg">
                <RotateCcw size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
