import React, { useCallback, useMemo, useRef } from 'react';
import { Play, Pause, RotateCcw, SkipForward, CloudRain, Coffee, Flame, Trees, Waves, Droplets, Wheat, Wind } from 'lucide-react';
import { usePomodoroStore, useTodoStore } from '../../stores';
import { formatTime, toLocalDateString } from '../../lib/date';
import { PHASE_LABELS } from '../../types';
import { type AmbientSound, AMBIENT_SOUNDS, playInteractionSound, playPomodoroCue } from '../../lib/sounds';
import { useAmbientSoundController } from '../../hooks/useAmbientSoundController';

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
  work: 'text-[var(--accent)]',
  short_break: 'text-[var(--success)]',
  long_break: 'text-[var(--warning)]',
};

const PHASE_BG_COLORS = {
  work: 'bg-[var(--accent)]',
  short_break: 'bg-[var(--success)]',
  long_break: 'bg-[var(--warning)]',
};

interface PomodoroTimerProps {
  settingsControl?: React.ReactNode;
}

export const PomodoroTimer: React.FC<PomodoroTimerProps> = ({ settingsControl }) => {
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

  const volumeTrackRef = useRef<HTMLDivElement | null>(null);
  const {
    sound: ambientSound,
    volume: ambientVolume,
    error: ambientError,
    isFocusActive: isFocusAmbientActive,
    play: playAmbient,
    toggle: toggleAmbient,
    resetForTimerReset: resetAmbientForTimerReset,
    updateVolume: updateAmbientVolume,
  } = useAmbientSoundController({
    mode: ambientPlaybackMode,
    timerStatus: timer.status,
    timerPhase: timer.phase,
  });

  const duration = getPhaseDuration(timer.phase);
  const progress = ((duration * 60 - timer.timeRemaining) / (duration * 60)) * 100;
  const ambientVolumeStyle = useMemo(() => ({
    '--ambient-volume-ratio': ambientVolume / 100,
  }) as React.CSSProperties, [ambientVolume]);
  const todayPomodoros = useMemo(() => {
    const today = toLocalDateString(new Date());
    return Object.values(sessions || {}).filter(
      (s) => s.completed && toLocalDateString(s.startTime) === today
    ).length;
  }, [sessions]);

  const handleReset = useCallback(() => {
    resetAmbientForTimerReset();
    resetTimer();
  }, [resetAmbientForTimerReset, resetTimer]);

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
    <div className="flex min-w-0 flex-col items-center rounded-2xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--accent)_8%,var(--bg-card))] p-4 shadow-sm md:p-6">
      {linkedTodo && (
        <div className="mb-3 md:mb-5 px-3 py-1.5 bg-[var(--bg-elevated)] rounded-lg">
          <p className="text-[10px] text-[var(--text-muted)]">当前专注</p>
          <p className="text-sm font-medium text-[var(--text-primary)]">{linkedTodo.title}</p>
        </div>
      )}

      <div className="relative mb-4 aspect-square w-full max-w-[260px] md:max-w-[300px]">
        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="45" fill="none" stroke="var(--border-light)" strokeWidth="5" />
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
            className="flex items-center gap-2 px-5 py-3 md:py-2.5 text-white bg-[var(--text-muted)] rounded-xl font-medium hover:opacity-90 transition-colors"
          >
            <Pause size={22} />
            暂停
          </button>
        )}

        <button
          onClick={handleReset}
          className="p-3 md:p-2.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] rounded-xl transition-colors"
          title="重置"
        >
          <RotateCcw size={20} />
        </button>

        {timer.status === 'running' && (
          <button
            onClick={completePhase}
            className="p-3 md:p-2.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] rounded-xl transition-colors"
            title="跳过"
          >
            <SkipForward size={20} />
          </button>
        )}
      </div>

      <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
        <span>本轮: {timer.sessionsCompleted % longBreakInterval}/{longBreakInterval}</span>
        <span>今日: {todayPomodoros}</span>
      </div>

      <div className="mt-3 w-full border-t border-[var(--border-light)] pt-3">
        <div className="mx-auto flex w-full max-w-[380px] flex-col gap-2.5">
          <div className="flex min-w-0 items-center gap-2">
            {settingsControl}
            <span className="shrink-0 text-[10px] text-[var(--text-muted)]">
              {ambientSound === 'none' ? '环境音' : `${AMBIENT_SOUNDS[ambientSound]?.name}${ambientPlaybackMode === 'focus' && !isFocusAmbientActive ? ' · 待启动' : ''}`}
            </span>
            <div
              ref={volumeTrackRef}
              role="slider"
              tabIndex={0}
              aria-label="环境音音量"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={ambientVolume}
              onPointerDown={handleVolumePointerDown}
              onPointerMove={handleVolumePointerMove}
              onKeyDown={handleVolumeKeyDown}
              style={ambientVolumeStyle}
              className="relative h-8 min-w-0 flex-1 cursor-pointer touch-none rounded-md px-1.5 outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--accent)_35%,transparent)]"
            >
              <div className="absolute left-1.5 right-1.5 top-1/2 h-2 -translate-y-1/2 rounded-full bg-[var(--bg-elevated)]" />
              <div
                className="absolute left-1.5 top-1/2 h-2 -translate-y-1/2 rounded-full bg-[var(--accent)]"
                style={{ width: 'calc((100% - 12px) * var(--ambient-volume-ratio))' }}
              />
              <div
                className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent)] shadow-sm"
                style={{ left: 'calc(6px + (100% - 12px) * var(--ambient-volume-ratio))' }}
              />
            </div>
            <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-[var(--text-muted)]">{ambientVolume}%</span>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {(Object.keys(AMBIENT_SOUNDS) as Array<Exclude<AmbientSound, 'none'>>).map((sound) => (
              <button
                key={sound}
                onClick={() => void toggleAmbient(sound)}
                className={`flex h-7 min-w-0 items-center justify-center rounded-md transition-colors ${
                  ambientSound === sound
                    ? 'bg-[var(--accent-bg)] text-[var(--accent)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'
                }`}
                title={AMBIENT_SOUNDS[sound].name}
              >
                {AMBIENT_ICONS[sound]}
              </button>
            ))}
          </div>
        </div>
        {ambientError && (
          <p className="mt-2 text-center text-[10px] text-[var(--danger)]">
            {ambientError}
          </p>
        )}
      </div>
    </div>
  );
};
