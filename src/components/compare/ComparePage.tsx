import React from 'react';
import { GitCompare, Plus, Star, Check, X } from 'lucide-react';
import { PageTitle } from '../shared';

const MOCK_COMPARE = [
  {
    name: '状态管理',
    items: [
      { name: 'Zustand', stars: '45k', pros: ['轻量', 'TypeScript友好', '无boilerplate'], cons: ['大型项目需规划'] },
      { name: 'Redux Toolkit', stars: '52k', pros: ['生态完善', 'DevTools强大', '中间件丰富'], cons: ['较重', '学习曲线陡'] },
      { name: 'Jotai', stars: '18k', pros: ['原子化', '极简API', '性能好'], cons: ['生态较小', '调试不便'] },
    ],
  },
  {
    name: '构建工具',
    items: [
      { name: 'Vite', stars: '65k', pros: ['极快HMR', 'ESM原生', '配置简单'], cons: ['生产构建用Rollup'] },
      { name: 'Turbopack', stars: '25k', pros: ['Rust编写', '增量编译', 'Next.js集成'], cons: ['生态不成熟', '绑定Next'] },
      { name: 'Rspack', stars: '12k', pros: ['Webpack兼容', 'Rust编写', '迁移成本低'], cons: ['生态较小'] },
    ],
  },
];

export const ComparePage: React.FC = () => {
  return (
    <div className="w-full pt-2 space-y-6">
      <PageTitle dev
        title="产品对比"
        subtitle="技术选型一目了然"
        icon={<GitCompare size={22} />}
        action={
          <button className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-[#06b6d4] rounded-lg hover:bg-[#0891b2] transition-colors">
            <Plus size={16} />
            新建对比
          </button>
        }
      />

      <div className="space-y-8">
        {MOCK_COMPARE.map((group) => (
          <div key={group.name}>
            <h3 className="text-sm font-semibold text-[#1a1a1a] mb-3">{group.name}</h3>
            <div className="auto-grid-panels">
              {group.items.map((item, idx) => (
                <div
                  key={item.name}
                  className={`bg-[#faf9f7] border rounded-xl p-5 hover:shadow-md transition-shadow ${
                    idx === 0 ? 'border-[#c87d2f] ring-1 ring-[#c87d2f]/20' : 'border-[#e5e2dd]'
                  }`}
                >
                  {idx === 0 && (
                    <span className="text-[10px] px-2 py-0.5 bg-[#fef7ed] text-[#c87d2f] rounded-full font-medium">推荐</span>
                  )}
                  <div className="flex items-center justify-between mt-2 mb-3">
                    <h4 className="text-base font-semibold text-[#1a1a1a]">{item.name}</h4>
                    <span className="text-xs text-[#9ca3af] flex items-center gap-1">
                      <Star size={10} className="text-[#f59e0b]" />
                      {item.stars}
                    </span>
                  </div>
                  <div className="space-y-2">
                    <div>
                      {item.pros.map((p) => (
                        <div key={p} className="flex items-center gap-2 text-xs text-[#16a34a] py-0.5">
                          <Check size={12} />
                          {p}
                        </div>
                      ))}
                    </div>
                    <div>
                      {item.cons.map((c) => (
                        <div key={c} className="flex items-center gap-2 text-xs text-[#dc3545] py-0.5">
                          <X size={12} />
                          {c}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
