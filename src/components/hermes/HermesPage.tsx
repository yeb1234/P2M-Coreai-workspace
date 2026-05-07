import React from 'react';
import { Workflow, Play, Pause, CheckCircle, Clock, ArrowRight, Zap, GitBranch } from 'lucide-react';
import { PageTitle } from '../shared';

const MOCK_WORKFLOWS = [
  { name: '每日代码质量检查', trigger: '定时 09:00', steps: 4, status: 'active', lastRun: '今天 09:00', result: 'success' },
  { name: 'PR 自动审查', trigger: 'GitHub Webhook', steps: 3, status: 'active', lastRun: '2小时前', result: 'success' },
  { name: '依赖安全扫描', trigger: '定时 周一', steps: 5, status: 'active', lastRun: '3天前', result: 'warning' },
  { name: '部署后冒烟测试', trigger: 'Vercel 部署完成', steps: 6, status: 'paused', lastRun: '上周', result: 'success' },
  { name: '周报自动生成', trigger: '定时 周五 17:00', steps: 3, status: 'active', lastRun: '上周五', result: 'success' },
];

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  active: { label: '运行中', color: 'bg-[#f0fdf4] text-[#16a34a]' },
  paused: { label: '已暂停', color: 'bg-[#f3f2ef] text-[#9ca3af]' },
};

const RESULT_MAP: Record<string, { icon: React.ReactNode; color: string }> = {
  success: { icon: <CheckCircle size={12} />, color: 'text-[#16a34a]' },
  warning: { icon: <Clock size={12} />, color: 'text-[#f59e0b]' },
  error: { icon: <Zap size={12} />, color: 'text-[#dc3545]' },
};

export const HermesPage: React.FC = () => {
  return (
    <div className="w-full pt-2 space-y-6">
      <PageTitle
        title="Hermes"
        subtitle="工作流自动化编排引擎"
        icon={<Workflow size={22} />}
      />

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-[#faf9f7] border border-[#e5e2dd] rounded-xl p-4 text-center">
          <Workflow size={20} className="text-[#c87d2f] mx-auto mb-2" />
          <p className="text-xl font-bold text-[#1a1a1a]">5</p>
          <p className="text-[10px] text-[#9ca3af]">工作流</p>
        </div>
        <div className="bg-[#faf9f7] border border-[#e5e2dd] rounded-xl p-4 text-center">
          <CheckCircle size={20} className="text-[#16a34a] mx-auto mb-2" />
          <p className="text-xl font-bold text-[#1a1a1a]">127</p>
          <p className="text-[10px] text-[#9ca3af]">成功执行</p>
        </div>
        <div className="bg-[#faf9f7] border border-[#e5e2dd] rounded-xl p-4 text-center">
          <Zap size={20} className="text-[#f59e0b] mx-auto mb-2" />
          <p className="text-xl font-bold text-[#1a1a1a]">3</p>
          <p className="text-[10px] text-[#9ca3af]">本周触发</p>
        </div>
      </div>

      <div className="space-y-3">
        {MOCK_WORKFLOWS.map((wf) => {
          const status = STATUS_MAP[wf.status];
          const result = RESULT_MAP[wf.result];
          return (
            <div key={wf.name} className="bg-[#faf9f7] border border-[#e5e2dd] rounded-xl p-4 hover:shadow-md transition-shadow cursor-pointer group">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <GitBranch size={14} className="text-[#6b7280]" />
                  <h3 className="text-sm font-semibold text-[#1a1a1a] group-hover:text-[#c87d2f] transition-colors">{wf.name}</h3>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${status.color}`}>{status.label}</span>
                  <button className="p-1 text-[#b8b4ac] hover:text-[#16a34a]">
                    {wf.status === 'active' ? <Pause size={14} /> : <Play size={14} />}
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs text-[#6b7280]">
                <span className="flex items-center gap-1"><Clock size={10} />{wf.trigger}</span>
                <span>{wf.steps} 步骤</span>
                <span className="flex items-center gap-1">
                  <span className={result.color}>{result.icon}</span>
                  上次: {wf.lastRun}
                </span>
              </div>
              {/* Steps visualization */}
              <div className="flex items-center gap-1 mt-3">
                {Array.from({ length: wf.steps }).map((_, i) => (
                  <React.Fragment key={i}>
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-bold ${
                      i < wf.steps - 1 ? 'bg-[#16a34a] text-white' : 'bg-[#e5e2dd] text-[#6b7280]'
                    }`}>
                      {i + 1}
                    </div>
                    {i < wf.steps - 1 && <ArrowRight size={10} className="text-[#d1cdc6]" />}
                  </React.Fragment>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
