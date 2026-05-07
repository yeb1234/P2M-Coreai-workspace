import React from 'react';
import { Compass, ExternalLink, Star, Search, Folder } from 'lucide-react';
import { PageTitle } from '../shared';

const MOCK_RESOURCES = [
  { name: 'freeCodeCamp', desc: '免费编程学习平台，项目驱动', category: '学习平台', stars: 4.8, url: 'freecodecamp.org' },
  { name: 'Roadmap.sh', desc: '前端/后端/DevOps 学习路线图', category: '学习路线', stars: 4.9, url: 'roadmap.sh' },
  { name: 'JavaScript.info', desc: '现代 JavaScript 教程', category: '教程', stars: 4.7, url: 'javascript.info' },
  { name: 'CSS-Tricks', desc: 'CSS 技巧与最佳实践', category: '教程', stars: 4.5, url: 'css-tricks.com' },
  { name: 'Web.dev', desc: 'Google 官方 Web 开发指南', category: '官方文档', stars: 4.8, url: 'web.dev' },
  { name: 'DevDocs', desc: 'API 文档聚合搜索', category: '工具', stars: 4.6, url: 'devdocs.io' },
  { name: 'Can I Use', desc: '浏览器兼容性查询', category: '工具', stars: 4.7, url: 'caniuse.com' },
  { name: 'Regex101', desc: '正则表达式在线测试', category: '工具', stars: 4.5, url: 'regex101.com' },
];

const CATS = ['全部', '学习平台', '教程', '官方文档', '工具', '学习路线'];

export const CodeNavPage: React.FC = () => {
  return (
    <div className="w-full pt-2 space-y-6">
      <PageTitle
        title="编程导航"
        subtitle="精选编程学习资源一站收录"
        icon={<Compass size={22} />}
      />

      <div className="flex gap-3">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
          <input type="text" placeholder="搜索资源..." className="w-full pl-10 pr-4 py-2.5 bg-[#faf9f7] border border-[#e5e2dd] rounded-xl text-sm outline-none" />
        </div>
        <div className="flex gap-1 overflow-x-auto">
          {CATS.map((c) => (
            <button key={c} className={`px-3 py-2 text-xs rounded-lg whitespace-nowrap transition-colors ${c === '全部' ? 'bg-[#fef7ed] text-[#c87d2f]' : 'text-[#6b7280] hover:bg-[#f3f2ef]'}`}>
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {MOCK_RESOURCES.map((r) => (
          <div key={r.name} className="bg-[#faf9f7] border border-[#e5e2dd] rounded-xl p-4 hover:shadow-md transition-shadow cursor-pointer group">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[#1a1a1a] group-hover:text-[#2563eb] transition-colors">{r.name}</h3>
                <p className="text-xs text-[#6b7280] mt-1">{r.desc}</p>
              </div>
              <ExternalLink size={14} className="text-[#d1cdc6] group-hover:text-[#6b7280] flex-shrink-0 mt-0.5" />
            </div>
            <div className="flex items-center gap-3 mt-3">
              <span className="text-[10px] px-2 py-0.5 bg-[#f3f2ef] text-[#6b7280] rounded-full">{r.category}</span>
              <span className="text-[10px] text-[#9ca3af] flex items-center gap-1"><Star size={10} className="text-[#f59e0b]" />{r.stars}</span>
              <span className="text-[10px] text-[#b8b4ac]">{r.url}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
