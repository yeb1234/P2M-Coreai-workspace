import { usePomodoroStore } from '../../stores';
import { useAmbientSoundController } from '../../hooks/useAmbientSoundController';
import { ambientPlayer } from '../../lib/sounds';
import { useEffect } from 'react';

interface GlobalAmbientSoundControllerProps {
  enabled?: boolean;
}

export function GlobalAmbientSoundController({ enabled = true }: GlobalAmbientSoundControllerProps) {
  const timerStatus = usePomodoroStore((s) => s.timer.status);
  const timerPhase = usePomodoroStore((s) => s.timer.phase);
  const ambientPlaybackMode = usePomodoroStore((s) => s.config.ambientPlaybackMode ?? 'manual');
  const ambientSound = usePomodoroStore((s) => s.config.ambientSound ?? 'none');
  const ambientVolumeBySound = usePomodoroStore((s) => s.config.ambientVolumeBySound);
  const ambientWasPlaying = usePomodoroStore((s) => s.config.ambientWasPlaying);
  const updateAmbientSound = usePomodoroStore((s) => s.updateAmbientSound);
  const updateAmbientPlaybackState = usePomodoroStore((s) => s.updateAmbientPlaybackState);
  const updateAmbientVolume = usePomodoroStore((s) => s.updateAmbientVolume);

  useAmbientSoundController({
    mode: ambientPlaybackMode,
    timerStatus,
    timerPhase,
    enabled,
    selectedSound: ambientSound,
    volumeBySound: ambientVolumeBySound,
    ambientWasPlaying,
    onSelectedSoundChange: updateAmbientSound,
    onPlaybackStateChange: updateAmbientPlaybackState,
    onVolumeChange: updateAmbientVolume,
  });

  useEffect(() => {
    if (!enabled) return;
    ambientPlayer.preloadAll(ambientSound);
  }, [ambientSound, enabled]);

  return null;
}
