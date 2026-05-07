import React from 'react';
import { Target, Plus, Flame, Check } from 'lucide-react';
import { PageTitle } from '../shared';

const MOCK_HABITS = [
  { name: '早起 (7:00前)', streak: 12, today: true, color: '#f59e0b' },
  { name: '阅读30分钟', streak: 7, today: true, color: '#2563eb' },
  { name: '运动', streak: 5, today: false, color: '#16a34a' },
  { name: '冥想10分钟', streak: 3, today: false, color: '#8b5cf6' },
  { name: '不刷短视频', streak: 0, today: false, color: '#ec4899' },
];

const WEEK = ['一', '二', '三', '四', '五', '六', '日'];

export const HabitsPage: React.FC = () => {
  return (
    <div className="w-full pt-2 space-y-6">
      <PageTitle
        title="习惯追踪"
        subtitle="每日打卡，养成好习惯"
        icon={<Target size={22} />}
        action={
          <button className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-[#16a34a] rounded-lg hover:bg-[#15803d] transition-colors">
            <Plus size={16} />
            新建习惯
          </button>
        }
      />

      <div className="space-y-3">
        {MOCK_HABITS.map((habit) => (
          <div key={habit.name} className="bg-[#faf9f7] border border-[#e5e2dd] rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center ${habit.today ? 'bg-[#16a34a]' : 'bg-[#e5e2dd]'}`}
                >
                  {habit.today ? <Check size={16} className="text-white" /> : <span className="text-xs text-[#9ca3af]">○</span>}
                </div>
                <div>
                  <h3 className="text-sm font-medium text-[#1a1a1a]">{habit.name}</h3>
                  <span className="text-xs text-[#9ca3af] flex items-center gap-1">
                    <Flame size={10} className="text-[#f59e0b]" />
                    连续 {habit.streak} 天
                  </span>
                </div>
              </div>
              <div className="flex gap-1">
                {WEEK.map((d, i) => (
                  <div
                    key={d}
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] ${
                      i < habit.streak % 7 ? 'text-white' : 'bg-[#f3f2ef] text-[#b8b4ac]'
                    }`}
                    style={i < habit.streak % 7 ? { backgroundColor: habit.color } : undefined}
                  >
                    {d}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
