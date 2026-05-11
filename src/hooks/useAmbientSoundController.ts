import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AmbientSound } from '../lib/sounds';
import { ambientPlayer } from '../lib/sounds';
import {
  createAmbientVolumeDefaults,
  getAmbientFocusPlan,
  getAmbientTogglePlan,
  isAmbientFocusActive,
  type AmbientVolumeMap,
} from '../lib/ambientSoundRules';
import type { AmbientPlaybackMode, PomodoroPhase, PomodoroStatus } from '../types/pomodoro';

interface UseAmbientSoundControllerOptions {
  mode: AmbientPlaybackMode;
  timerStatus: PomodoroStatus;
  timerPhase: PomodoroPhase;
}

interface AmbientControllerSnapshot {
  selectedSound: AmbientSound;
  volumeBySound: AmbientVolumeMap;
  shouldResumeManualPlayback: boolean;
}

const ambientControllerSnapshot: AmbientControllerSnapshot = {
  selectedSound: 'none',
  volumeBySound: createAmbientVolumeDefaults(),
  shouldResumeManualPlayback: false,
};

type AmbientControllerListener = () => void;
const ambientControllerListeners = new Set<AmbientControllerListener>();

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
  ambientControllerSnapshot.shouldResumeManualPlayback = false;
  notifyAmbientControllerListeners();
  ambientPlayer.stop();
}

export function useAmbientSoundController({
  mode,
  timerStatus,
  timerPhase,
}: UseAmbientSoundControllerOptions) {
  const [sound, setSoundState] = useState<AmbientSound>(() => {
    const playingSound = ambientPlayer.getCurrentSound();
    if (ambientPlayer.getIsPlaying() && playingSound !== 'none') return playingSound;
    return ambientControllerSnapshot.selectedSound;
  });
  const [volumeBySound, setVolumeBySoundState] = useState<AmbientVolumeMap>(() => {
    const current = {
      ...ambientControllerSnapshot.volumeBySound,
    };
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

  soundRef.current = sound;
  volumeBySoundRef.current = volumeBySound;

  const volume = sound === 'none' ? 0 : volumeBySound[sound];

  const setSound = useCallback((nextSound: AmbientSound) => {
    ambientControllerSnapshot.selectedSound = nextSound;
    setSoundState(nextSound);
    notifyAmbientControllerListeners();
  }, []);

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
    () => isAmbientFocusActive(mode, timerStatus, timerPhase),
    [mode, timerPhase, timerStatus],
  );

  const stop = useCallback(() => {
    commandRef.current += 1;
    ambientPlayer.stop();
  }, []);

  const stopAndForgetManualResume = useCallback(() => {
    ambientControllerSnapshot.shouldResumeManualPlayback = false;
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
      if (mode === 'manual') {
        ambientControllerSnapshot.shouldResumeManualPlayback = true;
      }
      return;
    }

    ambientPlayer.stop();
    ambientControllerSnapshot.shouldResumeManualPlayback = false;
    if (showError) {
      setError('背景音播放失败，请确认浏览器允许声音播放。');
    }
  }, [getVolumeForSound, mode, stop]);

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
      stopAndForgetManualResume();
    }

    if (plan.playback === 'defer') {
      stop();
    }
  }, [isFocusActive, mode, play, stop, stopAndForgetManualResume]);

  const resetForTimerReset = useCallback(() => {
    stop();
    ambientControllerSnapshot.shouldResumeManualPlayback = false;
    if (mode === 'manual') setSound('none');
    setError('');
  }, [mode, stop]);

  const updateVolume = useCallback((nextVolume: number) => {
    const currentSound = soundRef.current;
    if (currentSound === 'none') return;

    const clampedVolume = Math.max(0, Math.min(100, Math.round(nextVolume)));
    setVolumeBySound((current) => ({
      ...current,
      [currentSound]: clampedVolume,
    }));
    ambientPlayer.setVolume(clampedVolume / 100);
  }, []);

  useEffect(() => {
    return subscribeAmbientController(() => {
      setSoundState(ambientControllerSnapshot.selectedSound);
      setVolumeBySoundState({ ...ambientControllerSnapshot.volumeBySound });
    });
  }, []);

  useEffect(() => {
    const plan = getAmbientFocusPlan({
      mode,
      selectedSound: soundRef.current,
      isFocusActive,
    });

    if (plan === 'play') {
      void play(soundRef.current, false);
      return;
    }

    if (plan === 'stop') {
      stop();
    }
  }, [isFocusActive, mode, play, stop, timerPhase, timerStatus]);

  useEffect(() => {
    if (mode === 'manual') return;
    if (sound === 'none') stop();
  }, [mode, sound, stop]);

  useEffect(() => {
    if (mode !== 'manual') return;
    if (soundRef.current === 'none') return;
    if (!ambientControllerSnapshot.shouldResumeManualPlayback) return;
    if (ambientPlayer.getIsPlaying()) return;

    void play(soundRef.current, false);
  }, [mode, play]);

  return {
    sound,
    volume,
    error,
    isFocusActive,
    play,
    stop,
    toggle,
    resetForTimerReset,
    updateVolume,
  };
}
