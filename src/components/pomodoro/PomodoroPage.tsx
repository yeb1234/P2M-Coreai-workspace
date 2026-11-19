import React, { useCallback, useState } from 'react';
import { Timer } from 'lucide-react';
import { PomodoroTimer } from './PomodoroTimer';
import { PomodoroSessionList } from './PomodoroSessionList';
import { PomodoroStats } from './PomodoroStats';
import { PomodoroSettings } from './PomodoroSettings';
import { PomodoroSettingsButton } from './PomodoroSettings';
import { PageTitle } from '../shared';
import { IS_DESKTOP_CLIENT } from '../../lib/clientContext';

export const PomodoroPage: React.FC = () => {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const toggleSettings = useCallback(() => setSettingsOpen((open) => !open), []);

  return (
    <div className="w-full pt-2">
      <div className={IS_DESKTOP_CLIENT ? 'pomodoro-desktop-page mx-auto w-full max-w-[1180px]' : 'w-full'}>
        <div className="hidden md:block pomodoro-page-title">
          <PageTitle title="番茄钟" subtitle="专注工作，高效休息" icon={<Timer size={22} />} />
        </div>
        <div
          className={IS_DESKTOP_CLIENT ? 'pomodoro-desktop-grid' : 'grid gap-5'}
          style={IS_DESKTOP_CLIENT ? undefined : {
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))',
          }}
        >
          <div className={`space-y-4 min-w-0 ${IS_DESKTOP_CLIENT ? 'pomodoro-timer-slot w-full max-w-[400px]' : ''}`}>
            <div className="relative flex flex-col items-center">
              <div className={`relative w-full ${IS_DESKTOP_CLIENT ? 'max-w-[400px]' : 'max-w-[440px]'}`}>
                <PomodoroTimer desktop={IS_DESKTOP_CLIENT} settingsControl={<PomodoroSettingsButton onClick={toggleSettings} />} />
                <PomodoroSettings open={settingsOpen} onOpenChange={setSettingsOpen} hideClosed compact />
              </div>
            </div>
          </div>
          <div className="min-w-0 space-y-6 pr-2 md:pr-4">
            <PomodoroStats />
            <PomodoroSessionList />
          </div>
        </div>
      </div>
    </div>
  );
};
