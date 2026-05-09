import React from 'react';
import { Timer } from 'lucide-react';
import { PomodoroTimer } from './PomodoroTimer';
import { PomodoroSessionList } from './PomodoroSessionList';
import { PomodoroStats } from './PomodoroStats';
import { PomodoroSettings } from './PomodoroSettings';
import { PageTitle } from '../shared';

export const PomodoroPage: React.FC = () => {
  return (
    <div className="w-full pt-2">
      <PageTitle title="番茄钟" subtitle="专注工作，高效休息" icon={<Timer size={22} />} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4 relative">
          <div className="lg:pr-6 flex flex-col items-center">
            <div className="w-full max-w-lg">
              <PomodoroTimer />
            </div>
            <div className="w-full max-w-lg">
              <PomodoroSettings />
            </div>
          </div>
          {/* Decorative vertical divider */}
          <div className="hidden lg:block absolute right-0 top-2 bottom-2" style={{ width: '2px' }}>
            <div className="h-full w-full bg-gradient-to-b from-transparent via-[#d1cdc6] to-transparent opacity-60 rounded-full" />
            <div className="absolute inset-0 w-full bg-gradient-to-b from-transparent via-[#c87d2f]/15 to-transparent blur-[2px] rounded-full" />
          </div>
        </div>
        <div className="space-y-6">
          <PomodoroStats />
          <PomodoroSessionList />
        </div>
      </div>
    </div>
  );
};
