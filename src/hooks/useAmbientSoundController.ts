import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AmbientSound } from '../lib/sounds';
import { AMBIENT_SOUNDS, ambientPlayer } from '../lib/sounds';
import {
  createAmbientVolumeDefaults,
  getAmbientFocusPlan,
  getAmbientTogglePlan,
  isAmbientFocusActive,
  type AmbientVolumeMap,
} from '../lib/ambientSoundRules';
import type { AmbientPlaybackMode, AmbientVolumeBySound, PomodoroPhase, PomodoroStatus } from '../types/pomodoro';

interface UseAmbientSoundControllerOptions {
  mode: AmbientPlaybackMode;
  timerStatus: PomodoroStatus;
  timerPhase: PomodoroPhase;
  enabled?: boolean;
  selectedSound?: AmbientSound;
  volumeBySound?: AmbientVolumeBySound;
  ambientWasPlaying?: boolean;
  onSelectedSoundChange?: (sound: AmbientSound) => void;
  onPlaybackStateChange?: (sound: AmbientSound, isPlaying: boolean) => void;
  onVolumeChange?: (sound: Exclude<AmbientSound, 'none'>, volume: number) => void;
}

interface AmbientControllerSnapshot {
  selectedSound: AmbientSound;
  volumeBySound: AmbientVolumeMap;
}

const ambientControllerSnapshot: AmbientControllerSnapshot = {
  selectedSound: 'none',
  volumeBySound: createAmbientVolumeDefaults(),
};

type AmbientControllerListener = () => void;
const ambientControllerListeners = new Set<AmbientControllerListener>();
const AMBIENT_PLAYBACK_STATE_KEY = 'p2m-ambient-playback-state-v1';

interface AmbientPlaybackState {
  sound: AmbientSound;
  isPlaying: boolean;
}

function isKnownAmbientSound(sound: unknown): sound is AmbientSound {
  return sound === 'none' || (typeof sound === 'string' && sound in AMBIENT_SOUNDS);
}

function clampVolumePercent(volume: unknown): number | null {
  const numberValue = typeof volume === 'number' ? volume : Number(volume);
  if (!Number.isFinite(numberValue)) return null;
  return Math.max(0, Math.min(100, Math.round(numberValue)));
}

function mergeAmbientVolumes(volumeBySound?: AmbientVolumeBySound): AmbientVolumeMap {
  const defaults = createAmbientVolumeDefaults();
  if (!volumeBySound) return defaults;

  (Object.keys(AMBIENT_SOUNDS) as Array<Exclude<AmbientSound, 'none'>>).forEach((sound) => {
    const volume = clampVolumePercent(volumeBySound[sound]);
    if (volume !== null) defaults[sound] = volume;
  });

  return defaults;
}

function areAmbientVolumesEqual(left: AmbientVolumeMap, right: AmbientVolumeMap): boolean {
  return (Object.keys(AMBIENT_SOUNDS) as Array<Exclude<AmbientSound, 'none'>>).every(
    (sound) => left[sound] === right[sound],
  );
}

function readAmbientPlaybackState(): AmbientPlaybackState {
  if (typeof localStorage === 'undefined') return { sound: 'none', isPlaying: false };
  try {
    const parsed = JSON.parse(localStorage.getItem(AMBIENT_PLAYBACK_STATE_KEY) || '{}') as Partial<AmbientPlaybackState>;
    return {
      sound: isKnownAmbientSound(parsed.sound) ? parsed.sound : 'none',
      isPlaying: parsed.isPlaying === true,
    };
  } catch {
    return { sound: 'none', isPlaying: false };
  }
}

function writeAmbientPlaybackState(sound: AmbientSound, isPlaying: boolean): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(AMBIENT_PLAYBACK_STATE_KEY, JSON.stringify({ sound, isPlaying }));
}

function notifyAmbientControllerListeners(): void {
  ambientControllerListeners.forEach((listener) => listener());
}

function subscribeAmbientController(listener: AmbientControllerListener): () => void {
  ambientControllerListeners.add(listener);
  return () => ambientControllerListeners.delete(listener);
}

export function resetAmbientControllerForTests(): void {
  ambientControllerSnapshot.selectedSound = 'none';
  ambientControllerSnapshot.volumeBySound = createAmbientVolumeDefaults();
  writeAmbientPlaybackState('none', false);
  notifyAmbientControllerListeners();
  ambientPlayer.stop();
}

export function resetAmbientSoundSelection(): void {
  ambientControllerSnapshot.selectedSound = 'none';
  writeAmbientPlaybackState('none', false);
  ambientPlayer.stop();
  notifyAmbientControllerListeners();
}

export function useAmbientSoundController({
  mode,
  timerStatus,
  timerPhase,
  enabled = true,
  selectedSound,
  volumeBySound: controlledVolumeBySound,
  ambientWasPlaying,
  onSelectedSoundChange,
  onPlaybackStateChange,
  onVolumeChange,
}: UseAmbientSoundControllerOptions) {
  const hasControlledSound = selectedSound !== undefined;
  const hasControlledVolume = controlledVolumeBySound !== undefined;
  const hasControlledPlaybackState = ambientWasPlaying !== undefined;
  const [sound, setSoundState] = useState<AmbientSound>(() => {
    if (hasControlledSound) return selectedSound;
    const playingSound = ambientPlayer.getCurrentSound();
    if (ambientPlayer.getIsPlaying() && playingSound !== 'none') return playingSound;
    return ambientControllerSnapshot.selectedSound;
  });
  const [volumeBySound, setVolumeBySoundState] = useState<AmbientVolumeMap>(() => {
    const current = hasControlledVolume
      ? mergeAmbientVolumes(controlledVolumeBySound)
      : { ...ambientControllerSnapshot.volumeBySound };
    const playingSound = ambientPlayer.getCurrentSound();
    if (ambientPlayer.getIsPlaying() && playingSound !== 'none') {
      current[playingSound] = Math.round(ambientPlayer.getCurrentVolume() * 100);
    }
    return current;
  });
  const [error, setError] = useState('');
  const commandRef = useRef(0);
  const soundRef = useRef<AmbientSound>('none');
  const volumeBySoundRef = useRef(volumeBySound);

  useEffect(() => {
    soundRef.current = sound;
    volumeBySoundRef.current = volumeBySound;
  }, [sound, volumeBySound]);

  const volume = sound === 'none' ? 0 : volumeBySound[sound];

  const setSound = useCallback((nextSound: AmbientSound) => {
    ambientControllerSnapshot.selectedSound = nextSound;
    setSoundState(nextSound);
    onSelectedSoundChange?.(nextSound);
    notifyAmbientControllerListeners();
  }, [onSelectedSoundChange]);

  const setVolumeBySound = useCallback((updater: (current: AmbientVolumeMap) => AmbientVolumeMap) => {
    setVolumeBySoundState((current) => {
      const next = updater(current);
      ambientControllerSnapshot.volumeBySound = next;
      notifyAmbientControllerListeners();
      return next;
    });
  }, []);

  const getVolumeForSound = useCallback((nextSound: AmbientSound) => {
    if (nextSound === 'none') return 0;
    return volumeBySoundRef.current[nextSound] / 100;
  }, []);

  const isFocusActive = useMemo(
    () => isAmbientFocusActive(timerStatus, timerPhase),
    [timerPhase, timerStatus],
  );

  const recordPlaybackState = useCallback((nextSound: AmbientSound, isPlaying: boolean) => {
    writeAmbientPlaybackState(nextSound, isPlaying);
    onPlaybackStateChange?.(nextSound, isPlaying);
  }, [onPlaybackStateChange]);

  const canAutoPlayForCurrentState = useCallback((nextSound: AmbientSound) => {
    if (nextSound === 'none') return false;
    if (mode === 'focus') return isFocusActive;
    if (!hasControlledSound) return true;
    if (hasControlledPlaybackState) return ambientWasPlaying === true;
    const previous = readAmbientPlaybackState();
    return previous.isPlaying && previous.sound === nextSound;
  }, [ambientWasPlaying, hasControlledPlaybackState, hasControlledSound, isFocusActive, mode]);

  const stop = useCallback(() => {
    commandRef.current += 1;
    recordPlaybackState('none', false);
    ambientPlayer.stop();
  }, [recordPlaybackState]);

  const pause = useCallback(() => {
    commandRef.current += 1;
    recordPlaybackState(soundRef.current, false);
    ambientPlayer.pause();
  }, [recordPlaybackState]);

  const stopAndClearPlayback = useCallback(() => {
    stop();
  }, [stop]);

  const play = useCallback(async (nextSound: AmbientSound, showError: boolean) => {
    if (nextSound === 'none') {
      stop();
      return;
    }

    const commandId = commandRef.current + 1;
    commandRef.current = commandId;
    const played = await ambientPlayer.play(nextSound, getVolumeForSound(nextSound));
    if (commandRef.current !== commandId) return;

    if (played) {
      setError('');
      recordPlaybackState(nextSound, true);
      return;
    }

    ambientPlayer.stop();
    setSound('none');
    recordPlaybackState('none', false);
    if (showError) {
      setError('背景音播放失败，请确认浏览器允许声音播放。');
    }
  }, [getVolumeForSound, recordPlaybackState, setSound, stop]);

  const toggle = useCallback(async (nextSound: AmbientSound) => {
    setError('');
    const plan = getAmbientTogglePlan({
      mode,
      currentSound: soundRef.current,
      clickedSound: nextSound,
      isFocusActive,
    });

    setSound(plan.nextSound);

    if (plan.playback === 'play') {
      await play(plan.nextSound, true);
      return;
    }

    if (plan.playback === 'stop') {
      stopAndClearPlayback();
    }

    if (plan.playback === 'defer') {
      stop();
    }
  }, [isFocusActive, mode, play, stop, stopAndClearPlayback, setSound]);

  const stopForTimerReset = useCallback(() => {
    setSound('none');
    stopAndClearPlayback();
    setError('');
  }, [setSound, stopAndClearPlayback]);

  const updateVolume = useCallback((nextVolume: number) => {
    const currentSound = soundRef.current;
    if (currentSound === 'none') return;

    const clampedVolume = Math.max(0, Math.min(100, Math.round(nextVolume)));
    setVolumeBySound((current) => ({
      ...current,
      [currentSound]: clampedVolume,
    }));
    ambientPlayer.setVolume(clampedVolume / 100);
    onVolumeChange?.(currentSound, clampedVolume);
  }, [onVolumeChange, setVolumeBySound]);

  useEffect(() => {
    return subscribeAmbientController(() => {
      if (!hasControlledSound) {
        setSoundState(ambientControllerSnapshot.selectedSound);
      }
      if (!hasControlledVolume) {
        setVolumeBySoundState({ ...ambientControllerSnapshot.volumeBySound });
      }
    });
  }, [hasControlledSound, hasControlledVolume]);

  useEffect(() => {
    if (!hasControlledSound) return;
    if (selectedSound === soundRef.current && selectedSound === ambientControllerSnapshot.selectedSound) return;

    ambientControllerSnapshot.selectedSound = selectedSound;
    soundRef.current = selectedSound;
    setSoundState(selectedSound);
    notifyAmbientControllerListeners();
  }, [hasControlledSound, selectedSound]);

  useEffect(() => {
    if (!hasControlledVolume) return;
    const next = mergeAmbientVolumes(controlledVolumeBySound);
    if (areAmbientVolumesEqual(volumeBySoundRef.current, next)) return;
    ambientControllerSnapshot.volumeBySound = next;
    volumeBySoundRef.current = next;
    setVolumeBySoundState(next);
    notifyAmbientControllerListeners();
  }, [controlledVolumeBySound, hasControlledVolume]);

  useEffect(() => {
    if (!enabled) return;
    const plan = getAmbientFocusPlan({
      mode,
      selectedSound: soundRef.current,
      isFocusActive,
    });

    if (plan === 'play' && canAutoPlayForCurrentState(soundRef.current)) {
      void play(soundRef.current, false);
      return;
    }

    if (plan === 'play') return;

    if (plan === 'stop') {
      if (soundRef.current === 'none') {
        stop();
      } else {
        pause();
      }
    }
  }, [canAutoPlayForCurrentState, enabled, isFocusActive, mode, pause, play, sound, stop, timerPhase, timerStatus]);

  useEffect(() => {
    if (!enabled) return;
    if (mode === 'manual') return;
    if (sound === 'none') stop();
  }, [enabled, mode, sound, stop]);

  return {
    sound,
    volume,
    error,
    isFocusActive,
    play,
    stop,
    toggle,
    stopForTimerReset,
    updateVolume,
  };
}
