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
      <div className="hidden md:block">
        <PageTitle title="番茄钟" subtitle="专注工作，高效休息" icon={<Timer size={22} />} />
      </div>
      <div
        className="grid gap-5"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))' }}
      >
        <div className="space-y-4 min-w-0">
          <div className="flex flex-col items-center">
            <div className="w-full max-w-[440px]">
              <PomodoroTimer />
            </div>
            <div className="w-full max-w-[440px]">
              <PomodoroSettings />
            </div>
          </div>
        </div>
        <div className="space-y-6 min-w-0">
          <PomodoroStats />
          <PomodoroSessionList />
        </div>
      </div>
    </div>
  );
};
