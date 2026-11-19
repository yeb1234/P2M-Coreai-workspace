import type { AmbientSound } from './sounds';
import { AMBIENT_SOUNDS } from './sounds';
import type { AmbientPlaybackMode, PomodoroPhase, PomodoroStatus } from '../types/pomodoro';

export type AmbientPlaybackPlan = 'play' | 'stop' | 'defer' | 'none';
export type AmbientVolumeMap = Record<Exclude<AmbientSound, 'none'>, number>;

export interface AmbientToggleInput {
  mode: AmbientPlaybackMode;
  currentSound: AmbientSound;
  clickedSound: AmbientSound;
  isFocusActive: boolean;
}

export interface AmbientTogglePlan {
  nextSound: AmbientSound;
  playback: AmbientPlaybackPlan;
}

export interface AmbientFocusInput {
  mode: AmbientPlaybackMode;
  selectedSound: AmbientSound;
  isFocusActive: boolean;
}

export function isAmbientFocusActive(
  status: PomodoroStatus,
  phase: PomodoroPhase,
): boolean {
  return status === 'running' && phase === 'work';
}

export function getAmbientTogglePlan({
  mode,
  currentSound,
  clickedSound,
  isFocusActive,
}: AmbientToggleInput): AmbientTogglePlan {
  if (currentSound === clickedSound) {
    return { nextSound: 'none', playback: 'stop' };
  }

  if (mode === 'focus' && !isFocusActive) {
    return { nextSound: clickedSound, playback: 'defer' };
  }

  return { nextSound: clickedSound, playback: 'play' };
}

export function getAmbientFocusPlan({
  mode,
  selectedSound,
  isFocusActive,
}: AmbientFocusInput): AmbientPlaybackPlan {
  if (mode === 'manual') {
    return selectedSound === 'none' ? 'stop' : 'play';
  }
  if (isFocusActive && selectedSound !== 'none') return 'play';
  return 'stop';
}

export function createAmbientVolumeDefaults(): AmbientVolumeMap {
  return Object.fromEntries(
    Object.entries(AMBIENT_SOUNDS).map(([sound, config]) => [
      sound,
      Math.round(config.volume * 100),
    ]),
  ) as AmbientVolumeMap;
}
