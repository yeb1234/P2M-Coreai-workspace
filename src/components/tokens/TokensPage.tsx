import React, { useState } from 'react';
import { Coins, TrendingUp, Clock, Zap, AlertTriangle, BarChart3, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { PageTitle } from '../shared';

const MOCK_MODELS = [
  { name: 'Claude 3.5 Sonnet', provider: 'Anthropic', inputTokens: 1250000, outputTokens: 380000, cost: 4.85, requests: 1240 },
  { name: 'GPT-4o', provider: 'OpenAI', inputTokens: 890000, outputTokens: 210000, cost: 3.12, requests: 860 },
  { name: 'Claude 3 Haiku', provider: 'Anthropic', inputTokens: 2100000, outputTokens: 650000, cost: 1.28, requests: 3200 },
  { name: 'Gemini 1.5 Pro', provider: 'Google', inputTokens: 450000, outputTokens: 120000, cost: 1.05, requests: 320 },
  { name: 'DeepSeek V3', provider: 'DeepSeek', inputTokens: 1800000, outputTokens: 520000, cost: 0.68, requests: 2100 },
];

const WEEKLY_SPEND = [
  { day: '一', amount: 2.3 },
  { day: '二', amount: 3.1 },
  { day: '三', amount: 1.8 },
  { day: '四', amount: 4.2 },
  { day: '五', amount: 2.9 },
  { day: '六', amount: 0.5 },
  { day: '日', amount: 1.2 },
];

const MOCK_ALERTS = [
  { level: 'warning', msg: 'Claude 3.5 Sonnet 今日用量已达预算 80%', time: '1小时前' },
  { level: 'info', msg: 'DeepSeek V3 本月累计最低成本，推荐优先使用', time: '3小时前' },
];

function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
  return String(n);
}

export const TokensPage: React.FC = () => {
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('week');

  const totalCost = MOCK_MODELS.reduce((s, m) => s + m.cost, 0);
  const totalRequests = MOCK_MODELS.reduce((s, m) => s + m.requests, 0);
  const totalInput = MOCK_MODELS.reduce((s, m) => s + m.inputTokens, 0);
  const totalOutput = MOCK_MODELS.reduce((s, m) => s + m.outputTokens, 0);
  const maxSpend = Math.max(...WEEKLY_SPEND.map((d) => d.amount));

  return (
    <div className="w-full pt-2 space-y-6">
      <PageTitle dev
        title="Token 用量"
        subtitle="AI API 调用统计与成本监控"
        icon={<Coins size={22} />}
        action={
          <div className="flex gap-1 bg-[var(--bg-base)] rounded-lg p-0.5">
            {(['today', 'week', 'month'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  period === p ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {p === 'today' ? '今日' : p === 'week' ? '本周' : '本月'}
              </button>
            ))}
          </div>
        }
      />

      {/* Summary cards */}
      <div className="auto-grid-cards">
        <div className="bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl p-4">
          <div className="flex items-center gap-2 text-[var(--accent)] mb-2">
            <Coins size={16} />
            <span className="text-xs font-medium">总花费</span>
          </div>
          <p className="text-2xl font-bold text-[var(--text-primary)]">${totalCost.toFixed(2)}</p>
          <p className="text-[10px] text-[var(--success)] mt-1 flex items-center gap-1">
            <ArrowDownRight size={10} /> -12% vs 上周
          </p>
        </div>
        <div className="bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl p-4">
          <div className="flex items-center gap-2 text-[var(--info)] mb-2">
            <Zap size={16} />
            <span className="text-xs font-medium">请求次数</span>
          </div>
          <p className="text-2xl font-bold text-[var(--text-primary)]">{totalRequests.toLocaleString()}</p>
          <p className="text-[10px] text-[var(--success)] mt-1 flex items-center gap-1">
            <ArrowUpRight size={10} /> +8% vs 上周
          </p>
        </div>
        <div className="bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl p-4">
          <div className="flex items-center gap-2 text-[var(--success)] mb-2">
            <TrendingUp size={16} />
            <span className="text-xs font-medium">输入 Tokens</span>
          </div>
          <p className="text-2xl font-bold text-[var(--text-primary)]">{formatTokens(totalInput)}</p>
          <p className="text-[10px] text-[var(--text-muted)] mt-1">prompt 用量</p>
        </div>
        <div className="bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl p-4">
          <div className="flex items-center gap-2 text-[#8b5cf6] mb-2">
            <BarChart3 size={16} />
            <span className="text-xs font-medium">输出 Tokens</span>
          </div>
          <p className="text-2xl font-bold text-[var(--text-primary)]">{formatTokens(totalOutput)}</p>
          <p className="text-[10px] text-[var(--text-muted)] mt-1">completion 用量</p>
        </div>
      </div>

      {/* Weekly spend chart */}
      <div className="bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Clock size={14} className="text-[var(--text-secondary)]" />
          <h3 className="text-sm font-medium text-[var(--text-primary)]">本周花费趋势</h3>
        </div>
        <div className="min-w-[300px] flex items-end gap-3 h-28">
          {WEEKLY_SPEND.map((d) => (
            <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[9px] text-[var(--text-muted)]">${d.amount}</span>
              <div className="w-full flex items-end justify-center" style={{ height: '80px' }}>
                <div
                  className="w-full bg-gradient-to-t from-[var(--accent)] to-[var(--accent)] rounded-t-md transition-all"
                  style={{ height: `${(d.amount / maxSpend) * 100}%` }}
                />
              </div>
              <span className="text-xs text-[var(--text-secondary)]">{d.day}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Alerts */}
      {MOCK_ALERTS.length > 0 && (
        <div className="bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl p-4">
          <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <AlertTriangle size={14} className="text-[var(--warn)]" />
            用量预警
          </h3>
          <div className="space-y-2">
            {MOCK_ALERTS.map((alert, i) => (
              <div key={i} className={`flex items-center gap-3 p-3 rounded-lg text-xs ${
                alert.level === 'warning' ? 'bg-[var(--bg-accent)] text-[var(--accent)]' : 'bg-[var(--info-bg)] text-[var(--info)]'
              }`}>
                <span className="flex-1">{alert.msg}</span>
                <span className="text-[10px] opacity-60">{alert.time}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Model breakdown table */}
      <div className="bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl overflow-hidden">
        <div className="p-4 border-b border-[var(--border-light)]">
          <h3 className="text-sm font-medium text-[var(--text-primary)]">模型用量明细</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[var(--bg-base)]">
                <th className="text-left px-4 py-2 font-medium text-[var(--text-secondary)]">模型</th>
                <th className="text-left px-4 py-2 font-medium text-[var(--text-secondary)]">供应商</th>
                <th className="text-right px-4 py-2 font-medium text-[var(--text-secondary)]">输入 Tokens</th>
                <th className="text-right px-4 py-2 font-medium text-[var(--text-secondary)]">输出 Tokens</th>
                <th className="text-right px-4 py-2 font-medium text-[var(--text-secondary)]">请求数</th>
                <th className="text-right px-4 py-2 font-medium text-[var(--text-secondary)]">花费</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-light)]">
              {MOCK_MODELS.map((model) => (
                <tr key={model.name} className="hover:bg-[var(--bg-accent)]">
                  <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{model.name}</td>
                  <td className="px-4 py-2.5 text-[var(--text-secondary)]">{model.provider}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-[var(--success)]">{formatTokens(model.inputTokens)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-[#8b5cf6]">{formatTokens(model.outputTokens)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-[var(--text-primary)]">{model.requests.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right font-mono font-bold text-[var(--accent)]">${model.cost.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-[var(--bg-base)] font-medium">
                <td className="px-4 py-2.5 text-[var(--text-primary)]" colSpan={2}>合计</td>
                <td className="px-4 py-2.5 text-right font-mono text-[var(--success)]">{formatTokens(totalInput)}</td>
                <td className="px-4 py-2.5 text-right font-mono text-[#8b5cf6]">{formatTokens(totalOutput)}</td>
                <td className="px-4 py-2.5 text-right font-mono text-[var(--text-primary)]">{totalRequests.toLocaleString()}</td>
                <td className="px-4 py-2.5 text-right font-mono font-bold text-[var(--accent)]">${totalCost.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
};
