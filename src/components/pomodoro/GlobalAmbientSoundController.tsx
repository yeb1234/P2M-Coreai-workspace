import { usePomodoroStore } from '../../stores';
import { useAmbientSoundController } from '../../hooks/useAmbientSoundController';

export function GlobalAmbientSoundController() {
  const timerStatus = usePomodoroStore((s) => s.timer.status);
  const timerPhase = usePomodoroStore((s) => s.timer.phase);
  const ambientPlaybackMode = usePomodoroStore((s) => s.config.ambientPlaybackMode ?? 'manual');

  useAmbientSoundController({
    mode: ambientPlaybackMode,
    timerStatus,
    timerPhase,
  });

  return null;
}
