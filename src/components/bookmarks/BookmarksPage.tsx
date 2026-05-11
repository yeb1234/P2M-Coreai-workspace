import React from 'react';
import { Bookmark, Plus, Search, ExternalLink } from 'lucide-react';
import { PageTitle } from '../shared';

const MOCK_BOOKMARKS = [
  { title: 'React 官方文档', url: 'react.dev', folder: '前端', favicon: '⚛️' },
  { title: 'TypeScript Handbook', url: 'typescriptlang.org', folder: '前端', favicon: '📘' },
  { title: 'GitHub', url: 'github.com', folder: '工具', favicon: '🐙' },
  { title: 'Stack Overflow', url: 'stackoverflow.com', folder: '工具', favicon: '📚' },
  { title: 'Figma', url: 'figma.com', folder: '设计', favicon: '🎨' },
  { title: 'Vercel Dashboard', url: 'vercel.com', folder: '部署', favicon: '▲' },
  { title: 'npm Registry', url: 'npmjs.com', folder: '前端', favicon: '📦' },
  { title: 'Can I Use', url: 'caniuse.com', folder: '前端', favicon: '🔍' },
];

const FOLDERS = ['全部', '前端', '工具', '设计', '部署'];

export const BookmarksPage: React.FC = () => {
  return (
    <div className="w-full pt-2 space-y-6">
      <PageTitle dev
        title="书签收藏"
        subtitle="收藏常用网站，快速访问"
        icon={<Bookmark size={22} />}
        action={
          <button className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-[#06b6d4] rounded-lg hover:bg-[#0891b2] transition-colors">
            <Plus size={16} />
            添加书签
          </button>
        }
      />

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
          <input type="text" placeholder="搜索书签..." className="w-full pl-10 pr-4 py-2.5 bg-[#faf9f7] border border-[#e5e2dd] rounded-xl text-sm outline-none" />
        </div>
        <div className="flex flex-wrap gap-1">
          {FOLDERS.map((f) => (
            <button key={f} className={`px-3 py-2 text-xs rounded-lg transition-colors ${f === '全部' ? 'bg-[#fef7ed] text-[#c87d2f]' : 'text-[#6b7280] hover:bg-[#f3f2ef]'}`}>
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="auto-grid-panels">
        {MOCK_BOOKMARKS.map((bm) => (
          <div key={bm.title} className="flex items-center gap-3 p-3 bg-[#faf9f7] border border-[#e5e2dd] rounded-xl hover:shadow-md transition-shadow cursor-pointer group">
            <span className="text-xl">{bm.favicon}</span>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-medium text-[#1a1a1a] group-hover:text-[#06b6d4] transition-colors truncate">{bm.title}</h3>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[#9ca3af]">{bm.url}</span>
                <span className="text-[10px] px-1.5 py-0.5 bg-[#f3f2ef] text-[#6b7280] rounded">{bm.folder}</span>
              </div>
            </div>
            <ExternalLink size={12} className="text-[#d1cdc6] group-hover:text-[#6b7280] flex-shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
};
