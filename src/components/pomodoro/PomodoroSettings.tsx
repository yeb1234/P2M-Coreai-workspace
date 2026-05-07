import React, { useState } from 'react';
import { Settings } from 'lucide-react';
import { usePomodoroStore } from '../../stores';

const WORK_PRESETS = [25, 30, 35, 45, 60];
const BREAK_PRESETS = [5, 10, 15, 20];
const LONG_BREAK_PRESETS = [15, 20, 25, 30];

export const PomodoroSettings: React.FC = () => {
  const { config, updateConfig } = usePomodoroStore();
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-2 text-sm text-[#6b7280] hover:text-[#c87d2f] hover:bg-[#fef7ed] rounded-lg transition-colors"
      >
        <Settings size={16} />
        设置
      </button>
    );
  }

  return (
    <div className="p-4 bg-[#faf9f7] rounded-2xl border border-[#e5e2dd] shadow-sm space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-[#1a1a1a] flex items-center gap-2">
          <Settings size={16} className="text-[#c87d2f]" />
          番茄钟设置
        </h3>
        <button
          onClick={() => setOpen(false)}
          className="text-xs text-[#9ca3af] hover:text-[#6b7280] transition-colors"
        >
          收起
        </button>
      </div>

      {/* Work duration */}
      <div>
        <label className="block text-xs text-[#6b7280] mb-2">专注时长（分钟）</label>
        <div className="flex gap-1.5">
          {WORK_PRESETS.map((min) => (
            <button
              key={min}
              onClick={() => updateConfig({ workDuration: min })}
              className={`flex-1 py-2 text-sm rounded-lg border transition-all ${
                config.workDuration === min
                  ? 'bg-[#c87d2f] text-white border-[#c87d2f] shadow-sm'
                  : 'bg-[#f3f2ef] text-[#6b7280] border-[#e5e2dd] hover:border-[#c87d2f]'
              }`}
            >
              {min}
            </button>
          ))}
        </div>
      </div>

      {/* Short break duration */}
      <div>
        <label className="block text-xs text-[#6b7280] mb-2">短休息（分钟）</label>
        <div className="flex gap-1.5">
          {BREAK_PRESETS.map((min) => (
            <button
              key={min}
              onClick={() => updateConfig({ shortBreakDuration: min })}
              className={`flex-1 py-2 text-sm rounded-lg border transition-all ${
                config.shortBreakDuration === min
                  ? 'bg-[#16a34a] text-white border-[#16a34a] shadow-sm'
                  : 'bg-[#f3f2ef] text-[#6b7280] border-[#e5e2dd] hover:border-[#16a34a]'
              }`}
            >
              {min}
            </button>
          ))}
        </div>
      </div>

      {/* Long break duration */}
      <div>
        <label className="block text-xs text-[#6b7280] mb-2">长休息（分钟）</label>
        <div className="flex gap-1.5">
          {LONG_BREAK_PRESETS.map((min) => (
            <button
              key={min}
              onClick={() => updateConfig({ longBreakDuration: min })}
              className={`flex-1 py-2 text-sm rounded-lg border transition-all ${
                config.longBreakDuration === min
                  ? 'bg-[#7c3aed] text-white border-[#7c3aed] shadow-sm'
                  : 'bg-[#f3f2ef] text-[#6b7280] border-[#e5e2dd] hover:border-[#7c3aed]'
              }`}
            >
              {min}
            </button>
          ))}
        </div>
      </div>

      {/* Long break interval */}
      <div>
        <label className="block text-xs text-[#6b7280] mb-2">每几个番茄后长休息</label>
        <div className="flex gap-1.5">
          {[3, 4, 5, 6].map((n) => (
            <button
              key={n}
              onClick={() => updateConfig({ longBreakInterval: n })}
              className={`flex-1 py-2 text-sm rounded-lg border transition-all ${
                config.longBreakInterval === n
                  ? 'bg-[#c87d2f] text-white border-[#c87d2f] shadow-sm'
                  : 'bg-[#f3f2ef] text-[#6b7280] border-[#e5e2dd] hover:border-[#c87d2f]'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
