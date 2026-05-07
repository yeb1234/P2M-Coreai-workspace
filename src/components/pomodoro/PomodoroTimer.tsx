import React, { useState, useCallback, useMemo } from 'react';
import { Play, Pause, RotateCcw, SkipForward, CloudRain, Coffee, Flame, Trees } from 'lucide-react';
import { usePomodoroStore, useTodoStore } from '../../stores';
import { formatTime, toLocalDateString } from '../../lib/date';
import { PHASE_LABELS } from '../../types';
import { ambientPlayer, type AmbientSound, AMBIENT_SOUNDS } from '../../lib/sounds';

const AMBIENT_ICONS: Record<Exclude<AmbientSound, 'none'>, React.ReactNode> = {
  rain: <CloudRain size={14} />,
  cafe: <Coffee size={14} />,
  fireplace: <Flame size={14} />,
  forest: <Trees size={14} />,
};

const PHASE_COLORS = {
  work: 'text-[#c87d2f]',
  short_break: 'text-[#16a34a]',
  long_break: 'text-[#7c3aed]',
};

const PHASE_BG_COLORS = {
  work: 'bg-[#c87d2f]',
  short_break: 'bg-[#16a34a]',
  long_break: 'bg-[#7c3aed]',
};

export const PomodoroTimer: React.FC = () => {
  const timer = usePomodoroStore((s) => s.timer);
  const sessions = usePomodoroStore((s) => s.sessions);
  const startTimer = usePomodoroStore((s) => s.startTimer);
  const pauseTimer = usePomodoroStore((s) => s.pauseTimer);
  const resumeTimer = usePomodoroStore((s) => s.resumeTimer);
  const resetTimer = usePomodoroStore((s) => s.resetTimer);
  const completePhase = usePomodoroStore((s) => s.completePhase);
  const getPhaseDuration = usePomodoroStore((s) => s.getPhaseDuration);
  const longBreakInterval = usePomodoroStore((s) => s.config.longBreakInterval);
  const linkedTodo = useTodoStore((s) => timer.linkedTodoId ? s.todos[timer.linkedTodoId] : null);

  const [ambientSound, setAmbientSound] = useState<AmbientSound>('none');

  const duration = getPhaseDuration(timer.phase);
  const progress = ((duration * 60 - timer.timeRemaining) / (duration * 60)) * 100;

  const todayPomodoros = useMemo(() => {
    const today = toLocalDateString(new Date());
    return Object.values(sessions || {}).filter(
      (s) => s.completed && toLocalDateString(s.startTime) === today
    ).length;
  }, [sessions]);

  const handleReset = useCallback(() => {
    ambientPlayer.stop();
    setAmbientSound('none');
    resetTimer();
  }, [resetTimer]);

  const handleStart = useCallback(() => {
    if (timer.status === 'idle') startTimer();
    else if (timer.status === 'paused') resumeTimer();
  }, [timer.status, startTimer, resumeTimer]);

  const handleAmbientToggle = useCallback((sound: AmbientSound) => {
    if (ambientSound === sound) {
      ambientPlayer.stop();
      setAmbientSound('none');
    } else {
      ambientPlayer.play(sound);
      setAmbientSound(sound);
    }
  }, [ambientSound]);

  return (
    <div className="flex flex-col items-center p-6 bg-[#fef7ed] rounded-2xl shadow-sm border border-[#e5e2dd]">
      {linkedTodo && (
        <div className="mb-4 px-3 py-1.5 bg-[#f3f2ef] rounded-lg">
          <p className="text-[10px] text-[#9ca3af]">当前专注</p>
          <p className="text-sm font-medium text-[#1a1a1a]">{linkedTodo.title}</p>
        </div>
      )}

      <div className="relative w-52 h-52 mb-6">
        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="45" fill="none" stroke="#e5e2dd" strokeWidth="6" />
          <circle
            cx="50" cy="50" r="45" fill="none"
            stroke="currentColor" strokeWidth="6" strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 45}`}
            strokeDashoffset={`${2 * Math.PI * 45 * (1 - progress / 100)}`}
            className={`transition-all duration-1000 ${PHASE_COLORS[timer.phase]}`}
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-4xl font-bold font-mono ${PHASE_COLORS[timer.phase]}`}>
            {formatTime(timer.timeRemaining)}
          </span>
          <span className={`mt-1 text-xs font-medium ${PHASE_COLORS[timer.phase]}`}>
            {PHASE_LABELS[timer.phase]}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4">
        {timer.status === 'idle' || timer.status === 'paused' ? (
          <button
            onClick={handleStart}
            className={`flex items-center gap-2 px-5 py-2.5 text-white rounded-xl font-medium transition-colors ${PHASE_BG_COLORS[timer.phase]} hover:opacity-90`}
          >
            <Play size={20} />
            {timer.status === 'idle' ? '开始' : '继续'}
          </button>
        ) : (
          <button
            onClick={pauseTimer}
            className="flex items-center gap-2 px-5 py-2.5 text-white bg-[#6b7280] rounded-xl font-medium hover:bg-[#4b5563] transition-colors"
          >
            <Pause size={20} />
            暂停
          </button>
        )}

        <button
          onClick={handleReset}
          className="p-2.5 text-[#9ca3af] hover:text-[#6b7280] hover:bg-[#f3f2ef] rounded-xl transition-colors"
          title="重置"
        >
          <RotateCcw size={18} />
        </button>

        {timer.status === 'running' && (
          <button
            onClick={completePhase}
            className="p-2.5 text-[#9ca3af] hover:text-[#6b7280] hover:bg-[#f3f2ef] rounded-xl transition-colors"
            title="跳过"
          >
            <SkipForward size={18} />
          </button>
        )}
      </div>

      <div className="flex items-center gap-4 text-xs text-[#9ca3af]">
        <span>本轮: {timer.sessionsCompleted % longBreakInterval}/{longBreakInterval}</span>
        <span>今日: {todayPomodoros}</span>
      </div>

      <div className="mt-3 pt-3 border-t border-[#e5e2dd] w-full">
        <div className="flex items-center justify-center gap-1.5">
          <span className="text-[10px] text-[#b8b4ac] mr-1">
            {ambientSound === 'none' ? '背景音' : AMBIENT_SOUNDS[ambientSound]?.name}
          </span>
          {(Object.keys(AMBIENT_SOUNDS) as Array<Exclude<AmbientSound, 'none'>>).map((sound) => (
            <button
              key={sound}
              onClick={() => handleAmbientToggle(sound)}
              className={`p-1.5 rounded-md transition-colors ${
                ambientSound === sound
                  ? 'bg-[#fef7ed] text-[#c87d2f]'
                  : 'text-[#b8b4ac] hover:text-[#6b7280] hover:bg-[#f3f2ef]'
              }`}
              title={AMBIENT_SOUNDS[sound].name}
            >
              {AMBIENT_ICONS[sound]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
