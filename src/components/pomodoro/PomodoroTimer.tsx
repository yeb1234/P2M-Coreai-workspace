import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Play, Pause, RotateCcw, SkipForward, CloudRain, Coffee, Flame, Trees, Waves, Droplets, Wheat, Wind } from 'lucide-react';
import { usePomodoroStore, useTodoStore } from '../../stores';
import { formatTime, toLocalDateString } from '../../lib/date';
import { PHASE_LABELS } from '../../types';
import { ambientPlayer, type AmbientSound, AMBIENT_SOUNDS, playInteractionSound, playPomodoroCue } from '../../lib/sounds';

const AMBIENT_ICONS: Record<Exclude<AmbientSound, 'none'>, React.ReactNode> = {
  rain: <CloudRain size={14} />,
  cafe: <Coffee size={14} />,
  fireplace: <Flame size={14} />,
  forest: <Trees size={14} />,
  ocean: <Waves size={14} />,
  stream: <Droplets size={14} />,
  countryside: <Wheat size={14} />,
  wind: <Wind size={14} />,
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
  const ambientPlaybackMode = usePomodoroStore((s) => s.config.ambientPlaybackMode ?? 'manual');
  const linkedTodo = useTodoStore((s) => timer.linkedTodoId ? s.todos[timer.linkedTodoId] : null);

  const [ambientSound, setAmbientSound] = useState<AmbientSound>('none');
  const [ambientVolume, setAmbientVolume] = useState(50);
  const [ambientError, setAmbientError] = useState('');
  const volumeTrackRef = useRef<HTMLDivElement | null>(null);
  const ambientCommandRef = useRef(0);
  const ambientSoundRef = useRef<AmbientSound>('none');
  const ambientVolumeRef = useRef(50);
  ambientSoundRef.current = ambientSound;
  ambientVolumeRef.current = ambientVolume;

  const duration = getPhaseDuration(timer.phase);
  const progress = ((duration * 60 - timer.timeRemaining) / (duration * 60)) * 100;
  const isFocusAmbientActive = ambientPlaybackMode === 'focus' && timer.status === 'running' && timer.phase === 'work';

  const todayPomodoros = useMemo(() => {
    const today = toLocalDateString(new Date());
    return Object.values(sessions || {}).filter(
      (s) => s.completed && toLocalDateString(s.startTime) === today
    ).length;
  }, [sessions]);

  const handleReset = useCallback(() => {
    ambientCommandRef.current += 1;
    ambientPlayer.stop();
    if (ambientPlaybackMode === 'manual') setAmbientSound('none');
    setAmbientError('');
    resetTimer();
  }, [ambientPlaybackMode, resetTimer]);

  const stopAmbient = useCallback(() => {
    ambientCommandRef.current += 1;
    ambientPlayer.stop();
  }, []);

  const playAmbient = useCallback(async (sound: AmbientSound, showError: boolean) => {
    if (sound === 'none') {
      stopAmbient();
      return;
    }

    const commandId = ambientCommandRef.current + 1;
    ambientCommandRef.current = commandId;
    const played = await ambientPlayer.play(sound, ambientVolumeRef.current / 100);
    if (ambientCommandRef.current !== commandId) return;

    if (played) {
      setAmbientError('');
      return;
    }

    ambientPlayer.stop();
    if (showError) {
      setAmbientError('背景音播放失败，请确认浏览器允许声音播放。');
    }
  }, [stopAmbient]);

  const handleStart = useCallback(() => {
    if (timer.status === 'idle') {
      startTimer();
      playPomodoroCue('start');
      if (ambientPlaybackMode === 'focus' && timer.phase === 'work' && ambientSound !== 'none') {
        void playAmbient(ambientSound, true);
      }
    } else if (timer.status === 'paused') {
      resumeTimer();
      playInteractionSound('start');
      if (ambientPlaybackMode === 'focus' && timer.phase === 'work' && ambientSound !== 'none') {
        void playAmbient(ambientSound, true);
      }
    }
  }, [ambientPlaybackMode, ambientSound, playAmbient, timer.phase, timer.status, startTimer, resumeTimer]);

  const handleAmbientToggle = useCallback(async (sound: AmbientSound) => {
    setAmbientError('');

    if (ambientSound === sound) {
      stopAmbient();
      setAmbientSound('none');
      return;
    }

    setAmbientSound(sound);

    if (ambientPlaybackMode === 'focus' && !isFocusAmbientActive) {
      stopAmbient();
      return;
    }

    await playAmbient(sound, true);
  }, [ambientSound, ambientPlaybackMode, isFocusAmbientActive, playAmbient, stopAmbient]);

  useEffect(() => {
    if (ambientPlaybackMode !== 'focus') return;

    const selectedSound = ambientSoundRef.current;
    if (isFocusAmbientActive && selectedSound !== 'none') {
      void playAmbient(selectedSound, false);
      return;
    }

    stopAmbient();
  }, [ambientPlaybackMode, isFocusAmbientActive, playAmbient, stopAmbient, timer.phase, timer.status]);

  useEffect(() => {
    if (ambientPlaybackMode === 'manual') {
      return;
    }
    if (ambientSound === 'none') {
      stopAmbient();
    }
  }, [ambientPlaybackMode, ambientSound, stopAmbient]);

  const updateAmbientVolume = useCallback((nextVolume: number) => {
    const clampedVolume = Math.max(0, Math.min(100, Math.round(nextVolume)));
    setAmbientVolume(clampedVolume);
    ambientPlayer.setVolume(clampedVolume / 100);
  }, []);

  const handleVolumePointer = useCallback((clientX: number) => {
    const track = volumeTrackRef.current;
    if (!track) return;

    const rect = track.getBoundingClientRect();
    const nextVolume = ((clientX - rect.left) / rect.width) * 100;
    updateAmbientVolume(nextVolume);
  }, [updateAmbientVolume]);

  const handleVolumePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    handleVolumePointer(event.clientX);
  }, [handleVolumePointer]);

  const handleVolumePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.buttons !== 1) return;
    handleVolumePointer(event.clientX);
  }, [handleVolumePointer]);

  const handleVolumeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      updateAmbientVolume(ambientVolume - 5);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      updateAmbientVolume(ambientVolume + 5);
    } else if (event.key === 'Home') {
      event.preventDefault();
      updateAmbientVolume(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      updateAmbientVolume(100);
    }
  }, [ambientVolume, updateAmbientVolume]);

  return (
    <div className="flex min-w-0 flex-col items-center rounded-2xl border border-[#e5e2dd] bg-[#fef7ed] p-4 shadow-sm md:p-6">
      {linkedTodo && (
        <div className="mb-3 md:mb-5 px-3 py-1.5 bg-[#f3f2ef] rounded-lg">
          <p className="text-[10px] text-[#9ca3af]">当前专注</p>
          <p className="text-sm font-medium text-[#1a1a1a]">{linkedTodo.title}</p>
        </div>
      )}

      <div className="relative mb-4 aspect-square w-full max-w-[260px] md:max-w-[300px]">
        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="45" fill="none" stroke="#e5e2dd" strokeWidth="5" />
          <circle
            cx="50" cy="50" r="45" fill="none"
            stroke="currentColor" strokeWidth="5" strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 45}`}
            strokeDashoffset={`${2 * Math.PI * 45 * (1 - progress / 100)}`}
            className={`transition-all duration-1000 ${PHASE_COLORS[timer.phase]}`}
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-4xl md:text-6xl font-bold font-mono ${PHASE_COLORS[timer.phase]}`}>
            {formatTime(timer.timeRemaining)}
          </span>
          <span className={`mt-1 text-xs md:text-sm font-medium ${PHASE_COLORS[timer.phase]}`}>
            {PHASE_LABELS[timer.phase]}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-3 md:mb-4">
        {timer.status === 'idle' || timer.status === 'paused' ? (
          <button
            onClick={handleStart}
            className={`flex items-center gap-2 px-5 py-3 md:py-2.5 text-white rounded-xl font-medium transition-colors ${PHASE_BG_COLORS[timer.phase]} hover:opacity-90`}
          >
            <Play size={22} />
            {timer.status === 'idle' ? '开始' : '继续'}
          </button>
        ) : (
          <button
            onClick={pauseTimer}
            className="flex items-center gap-2 px-5 py-3 md:py-2.5 text-white bg-[#6b7280] rounded-xl font-medium hover:bg-[#4b5563] transition-colors"
          >
            <Pause size={22} />
            暂停
          </button>
        )}

        <button
          onClick={handleReset}
          className="p-3 md:p-2.5 text-[#9ca3af] hover:text-[#6b7280] hover:bg-[#f3f2ef] rounded-xl transition-colors"
          title="重置"
        >
          <RotateCcw size={20} />
        </button>

        {timer.status === 'running' && (
          <button
            onClick={completePhase}
            className="p-3 md:p-2.5 text-[#9ca3af] hover:text-[#6b7280] hover:bg-[#f3f2ef] rounded-xl transition-colors"
            title="跳过"
          >
            <SkipForward size={20} />
          </button>
        )}
      </div>

      <div className="flex items-center gap-4 text-xs text-[#9ca3af]">
        <span>本轮: {timer.sessionsCompleted % longBreakInterval}/{longBreakInterval}</span>
        <span>今日: {todayPomodoros}</span>
      </div>

      <div className="mt-3 w-full border-t border-[#e5e2dd] pt-3">
        <div className="mx-auto flex w-full max-w-[340px] flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="shrink-0 text-[10px] text-[#b8b4ac]">
            {ambientSound === 'none' ? '背景音' : `${AMBIENT_SOUNDS[ambientSound]?.name}${ambientPlaybackMode === 'focus' && !isFocusAmbientActive ? ' · 待专注' : ''}`}
            </span>
            <div
              ref={volumeTrackRef}
              role="slider"
              tabIndex={0}
              aria-label="背景音音量"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={ambientVolume}
              onPointerDown={handleVolumePointerDown}
              onPointerMove={handleVolumePointerMove}
              onKeyDown={handleVolumeKeyDown}
              className="relative h-7 min-w-0 flex-1 cursor-pointer touch-none rounded-md px-1.5 outline-none focus-visible:ring-2 focus-visible:ring-[#c87d2f]/30"
            >
              <div className="absolute left-1.5 right-1.5 top-1/2 h-2 -translate-y-1/2 rounded-full bg-[#eadfce]" />
              <div
                className="absolute left-1.5 top-1/2 h-2 -translate-y-1/2 rounded-full bg-[#c87d2f]"
                style={{ width: `calc((100% - 12px) * ${ambientVolume / 100})` }}
              />
              <div
                className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#c87d2f] shadow-sm"
                style={{ left: `calc(6px + (100% - 12px) * ${ambientVolume / 100})` }}
              />
            </div>
            <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-[#b8b4ac]">{ambientVolume}%</span>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {(Object.keys(AMBIENT_SOUNDS) as Array<Exclude<AmbientSound, 'none'>>).map((sound) => (
              <button
                key={sound}
                onClick={() => void handleAmbientToggle(sound)}
                className={`flex h-7 min-w-0 items-center justify-center rounded-md transition-colors ${
                  ambientSound === sound
                    ? 'bg-[#f6e7cf] text-[#c87d2f]'
                    : 'text-[#b8b4ac] hover:text-[#6b7280] hover:bg-[#f3f2ef]'
                }`}
                title={AMBIENT_SOUNDS[sound].name}
              >
                {AMBIENT_ICONS[sound]}
              </button>
            ))}
          </div>
        </div>
        {ambientError && (
          <p className="mt-2 text-center text-[10px] text-[#dc3545]">
            {ambientError}
          </p>
        )}
      </div>
    </div>
  );
};
