import React from 'react';
import { Code2, Search, Plus, Copy, Tag } from 'lucide-react';
import { PageTitle } from '../shared';

const MOCK_SNIPPETS = [
  { title: 'React Hook 模板', lang: 'TypeScript', code: 'const useDebounce = <T>(value: T, delay: number): T => { ... }', tag: 'React' },
  { title: 'CSS Grid 快速布局', lang: 'CSS', code: 'grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));', tag: 'CSS' },
  { title: 'Git 回滚命令', lang: 'Shell', code: 'git reset --soft HEAD~1', tag: 'Git' },
  { title: 'fetch 封装', lang: 'TypeScript', code: 'const api = async <T>(url: string): Promise<T> => { ... }', tag: 'HTTP' },
  { title: '日期格式化', lang: 'TypeScript', code: 'const fmt = (d: Date) => d.toISOString().split("T")[0]', tag: '工具' },
];

export const SnippetsPage: React.FC = () => {
  return (
    <div className="w-full pt-2 space-y-6">
      <PageTitle
        title="代码片段"
        subtitle="收藏常用代码，快速复用"
        icon={<Code2 size={22} />}
        action={
          <button className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-[#8b5cf6] rounded-lg hover:bg-[#7c3aed] transition-colors">
            <Plus size={16} />
            新建片段
          </button>
        }
      />

      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
        <input type="text" placeholder="搜索代码片段..." className="w-full pl-10 pr-4 py-2.5 bg-[#faf9f7] border border-[#e5e2dd] rounded-xl text-sm outline-none" />
      </div>

      <div className="space-y-3">
        {MOCK_SNIPPETS.map((s) => (
          <div key={s.title} className="bg-[#faf9f7] border border-[#e5e2dd] rounded-xl p-4 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-[#1a1a1a]">{s.title}</h3>
              <div className="flex items-center gap-2">
                <span className="text-[10px] px-2 py-0.5 bg-[#f3e8ff] text-[#8b5cf6] rounded-full">{s.lang}</span>
                <button className="p-1 text-[#b8b4ac] hover:text-[#8b5cf6]"><Copy size={14} /></button>
              </div>
            </div>
            <pre className="text-xs bg-[#1a1a1a] text-[#a3e635] rounded-lg p-3 overflow-x-auto font-mono">
              <code>{s.code}</code>
            </pre>
            <div className="mt-2 flex items-center gap-1">
              <Tag size={10} className="text-[#9ca3af]" />
              <span className="text-[10px] text-[#9ca3af]">{s.tag}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
