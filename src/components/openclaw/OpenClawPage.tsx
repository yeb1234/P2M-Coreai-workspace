import React from 'react';
import { Search, Download, Star, GitBranch, Package, ExternalLink } from 'lucide-react';
import { PageTitle } from '../shared';

const MOCK_PACKAGES = [
  { name: 'react-use', desc: 'React Hooks 工具库', version: '17.5.0', downloads: '2.1M/周', stars: 38000, tag: 'hooks' },
  { name: 'zustand', desc: '轻量级状态管理', version: '4.5.0', downloads: '1.8M/周', stars: 45000, tag: '状态管理' },
  { name: 'date-fns', desc: '现代日期工具库', version: '3.6.0', downloads: '2.5M/周', stars: 33000, tag: '日期' },
  { name: 'axios', desc: 'HTTP 请求库', version: '1.7.0', downloads: '4.2M/周', stars: 104000, tag: '网络' },
  { name: 'tailwind-merge', desc: 'Tailwind 类名合并', version: '2.3.0', downloads: '890K/周', stars: 3800, tag: 'CSS' },
  { name: 'nanoid', desc: '轻量唯一 ID 生成', version: '5.0.0', downloads: '3.1M/周', stars: 24000, tag: '工具' },
];

export const OpenClawPage: React.FC = () => {
  return (
    <div className="w-full pt-2 space-y-6">
      <PageTitle
        title="OpenClaw"
        subtitle="开源包搜索、对比、下载管理"
        icon={<Package size={22} />}
      />

      <div className="relative max-w-xl">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
        <input type="text" placeholder="搜索 npm / pip / cargo 包..." className="w-full pl-10 pr-4 py-2.5 bg-[#faf9f7] border border-[#e5e2dd] rounded-xl text-sm outline-none" />
      </div>

      <div className="space-y-3">
        {MOCK_PACKAGES.map((pkg) => (
          <div key={pkg.name} className="bg-[#faf9f7] border border-[#e5e2dd] rounded-xl p-4 hover:shadow-md transition-shadow cursor-pointer group">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <Package size={16} className="text-[#dc3545]" />
                <h3 className="text-sm font-semibold text-[#1a1a1a] group-hover:text-[#dc3545] transition-colors">{pkg.name}</h3>
                <span className="text-[10px] px-1.5 py-0.5 bg-[#f3f2ef] text-[#6b7280] rounded font-mono">v{pkg.version}</span>
              </div>
              <div className="flex items-center gap-2">
                <button className="p-1.5 text-[#b8b4ac] hover:text-[#16a34a] hover:bg-[#f0fdf4] rounded-md"><Download size={14} /></button>
                <ExternalLink size={14} className="text-[#d1cdc6] group-hover:text-[#6b7280]" />
              </div>
            </div>
            <p className="text-xs text-[#6b7280] mt-1.5">{pkg.desc}</p>
            <div className="flex items-center gap-4 mt-2">
              <span className="text-[10px] text-[#9ca3af] flex items-center gap-1"><Star size={10} className="text-[#f59e0b]" />{(pkg.stars / 1000).toFixed(0)}k</span>
              <span className="text-[10px] text-[#9ca3af] flex items-center gap-1"><Download size={10} />{pkg.downloads}</span>
              <span className="text-[10px] px-1.5 py-0.5 bg-[#fef7ed] text-[#c87d2f] rounded-full">{pkg.tag}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
