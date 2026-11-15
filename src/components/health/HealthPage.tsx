import React from 'react';
import { Heart, Activity, Moon, Droplets, Weight, TrendingDown, AlertCircle } from 'lucide-react';
import { PageTitle } from '../shared';

const MOCK_HEALTH = {
  steps: { value: 8420, goal: 10000, unit: '步' },
  sleep: { value: 7.2, goal: 8, unit: '小时' },
  water: { value: 6, goal: 8, unit: '杯' },
  weight: { value: 68.5, change: -0.3, unit: 'kg' },
  heartRate: { value: 72, min: 58, max: 95, unit: 'bpm' },
};

const WEEK_WEIGHT = [
  { day: '一', value: 69.0 },
  { day: '二', value: 68.8 },
  { day: '三', value: 68.9 },
  { day: '四', value: 68.6 },
  { day: '五', value: 68.5 },
  { day: '六', value: 68.7 },
  { day: '日', value: 68.5 },
];

export const HealthPage: React.FC = () => {
  return (
    <div className="w-full pt-2 space-y-6">
      <PageTitle dev
        title="健康助手"
        subtitle="同步 P1 健康数据，关注身体状态"
        icon={<Heart size={22} />}
      />

      {/* Summary cards */}
      <div className="auto-grid-cards">
        <div className="bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl p-4">
          <div className="flex items-center gap-2 text-[var(--success)] mb-2">
            <Activity size={16} />
            <span className="text-xs font-medium">今日步数</span>
          </div>
          <p className="text-2xl font-bold text-[var(--text-primary)]">{MOCK_HEALTH.steps.value.toLocaleString()}</p>
          <div className="w-full bg-[var(--border-light)] rounded-full h-1 mt-2">
            <div className="bg-[var(--success)] h-1 rounded-full" style={{ width: `${(MOCK_HEALTH.steps.value / MOCK_HEALTH.steps.goal) * 100}%` }} />
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-1">目标 {MOCK_HEALTH.steps.goal.toLocaleString()} 步</p>
        </div>

        <div className="bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl p-4">
          <div className="flex items-center gap-2 text-[#8b5cf6] mb-2">
            <Moon size={16} />
            <span className="text-xs font-medium">昨晚睡眠</span>
          </div>
          <p className="text-2xl font-bold text-[var(--text-primary)]">{MOCK_HEALTH.sleep.value}h</p>
          <div className="w-full bg-[var(--border-light)] rounded-full h-1 mt-2">
            <div className="bg-[#8b5cf6] h-1 rounded-full" style={{ width: `${(MOCK_HEALTH.sleep.value / MOCK_HEALTH.sleep.goal) * 100}%` }} />
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-1">目标 {MOCK_HEALTH.sleep.goal} 小时</p>
        </div>

        <div className="bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl p-4">
          <div className="flex items-center gap-2 text-[#06b6d4] mb-2">
            <Droplets size={16} />
            <span className="text-xs font-medium">饮水量</span>
          </div>
          <p className="text-2xl font-bold text-[var(--text-primary)]">{MOCK_HEALTH.water.value} 杯</p>
          <div className="w-full bg-[var(--border-light)] rounded-full h-1 mt-2">
            <div className="bg-[#06b6d4] h-1 rounded-full" style={{ width: `${(MOCK_HEALTH.water.value / MOCK_HEALTH.water.goal) * 100}%` }} />
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-1">目标 {MOCK_HEALTH.water.goal} 杯</p>
        </div>

        <div className="bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl p-4">
          <div className="flex items-center gap-2 text-[#ec4899] mb-2">
            <Weight size={16} />
            <span className="text-xs font-medium">体重</span>
          </div>
          <p className="text-2xl font-bold text-[var(--text-primary)]">{MOCK_HEALTH.weight.value} kg</p>
          <p className="text-xs text-[var(--success)] mt-2 flex items-center gap-1">
            <TrendingDown size={10} />
            较昨日 {MOCK_HEALTH.weight.change} kg
          </p>
        </div>
      </div>

      {/* Weight trend */}
      <div className="bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl p-5">
        <h3 className="text-sm font-medium text-[var(--text-primary)] mb-4">本周体重趋势</h3>
        <div className="min-w-[300px] flex items-end gap-3 h-32">
          {WEEK_WEIGHT.map((d) => {
            const minW = 68;
            const maxW = 70;
            const pct = ((d.value - minW) / (maxW - minW)) * 100;
            return (
              <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-xs text-[var(--text-muted)]">{d.value}</span>
                <div className="w-full flex items-end justify-center" style={{ height: '80px' }}>
                  <div
                    className="w-full bg-gradient-to-t from-[#ec4899] to-[#f472b6] rounded-t-md"
                    style={{ height: `${pct}%` }}
                  />
                </div>
                <span className="text-xs text-[var(--text-secondary)]">{d.day}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Health report */}
      <div className="bg-[var(--bg-accent)] border border-[var(--border-light)] rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <AlertCircle size={16} className="text-[var(--accent)]" />
          <h3 className="text-sm font-medium text-[var(--text-primary)]">健康报告摘要</h3>
        </div>
        <ul className="space-y-2 text-xs text-[var(--text-secondary)]">
          <li>• 本周平均睡眠 7.1 小时，建议保持 7-8 小时</li>
          <li>• 步数达标率 5/7 天，周末活动量偏低</li>
          <li>• 体重呈下降趋势，本周减重 0.5 kg，进度良好</li>
          <li>• 饮水量不足，建议设置提醒</li>
        </ul>
      </div>
    </div>
  );
};
