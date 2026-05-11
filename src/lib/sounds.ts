// Central sound system for app interactions, Pomodoro cues, and ambient loops.
// Short UI feedback uses Web Audio tones; longer cues and ambient loops use local media files.

import { useNotificationStore } from '../stores/notificationStore';

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

function shouldPlaySounds(): boolean {
  return useNotificationStore.getState().settings.soundEnabled;
}

export type InteractionSound = 'tap' | 'success' | 'error' | 'delete' | 'restore' | 'save' | 'start' | 'complete';

const INTERACTION_SOUND_NOTES: Record<InteractionSound, Array<{ frequency: number; start: number; duration: number; gain: number }>> = {
  tap: [{ frequency: 640, start: 0, duration: 0.045, gain: 0.035 }],
  success: [
    { frequency: 523.25, start: 0, duration: 0.12, gain: 0.06 },
    { frequency: 783.99, start: 0.08, duration: 0.18, gain: 0.07 },
  ],
  error: [
    { frequency: 220, start: 0, duration: 0.12, gain: 0.055 },
    { frequency: 174.61, start: 0.09, duration: 0.18, gain: 0.05 },
  ],
  delete: [
    { frequency: 392, start: 0, duration: 0.08, gain: 0.045 },
    { frequency: 246.94, start: 0.07, duration: 0.16, gain: 0.045 },
  ],
  restore: [
    { frequency: 349.23, start: 0, duration: 0.09, gain: 0.045 },
    { frequency: 523.25, start: 0.07, duration: 0.15, gain: 0.055 },
  ],
  save: [{ frequency: 698.46, start: 0, duration: 0.1, gain: 0.045 }],
  start: [
    { frequency: 440, start: 0, duration: 0.08, gain: 0.045 },
    { frequency: 659.25, start: 0.08, duration: 0.16, gain: 0.055 },
  ],
  complete: [
    { frequency: 523.25, start: 0, duration: 0.1, gain: 0.055 },
    { frequency: 659.25, start: 0.08, duration: 0.1, gain: 0.055 },
    { frequency: 783.99, start: 0.16, duration: 0.18, gain: 0.06 },
  ],
};

export type PomodoroCue = 'start' | 'break' | 'complete';

const POMODORO_CUES: Record<PomodoroCue, { url: string; volume: number }> = {
  start: { url: '/sounds/pomodoro-start.ogg', volume: 0.28 },
  break: { url: '/sounds/pomodoro-break.ogg', volume: 0.42 },
  complete: { url: '/sounds/pomodoro-complete.ogg', volume: 0.22 },
};

class SoundController {
  playInteraction(sound: InteractionSound): void {
    if (!shouldPlaySounds()) return;

    try {
      this.playToneSequence(INTERACTION_SOUND_NOTES[sound]);
    } catch {
      // UI actions should never be blocked by audio failures.
    }
  }

  playPomodoroCue(cue: PomodoroCue): void {
    if (!shouldPlaySounds()) return;

    const config = POMODORO_CUES[cue];
    const audio = new Audio(config.url);
    audio.volume = config.volume;
    audio.preload = 'auto';
    audio.play().catch((e) => {
      console.info(`Pomodoro cue "${cue}" not available: ${config.url}`, e);
    });
  }

  playNotification(): void {
    this.playPomodoroCue('start');
  }

  playBreak(): void {
    this.playPomodoroCue('break');
  }

  playTick(): void {
    if (!shouldPlaySounds()) return;

    try {
      this.playToneSequence([{ frequency: 800, start: 0, duration: 0.05, gain: 0.05 }]);
    } catch {
      // Optional ticking is best-effort only.
    }
  }

  private playToneSequence(notes: Array<{ frequency: number; start: number; duration: number; gain: number }>): void {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    notes.forEach(({ frequency, start, duration, gain: peakGain }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(peakGain, now + start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + duration);
    });
  }
}

export const soundController = new SoundController();

export function playInteractionSound(sound: InteractionSound): void {
  soundController.playInteraction(sound);
}

export function playPomodoroCue(cue: PomodoroCue): void {
  soundController.playPomodoroCue(cue);
}

export function playNotificationSound(): void {
  soundController.playNotification();
}

export function playBreakSound(): void {
  soundController.playBreak();
}

export function playTickSound(): void {
  soundController.playTick();
}

// Ambient sound types
export type AmbientSound = 'none' | 'rain' | 'cafe' | 'fireplace' | 'forest' | 'ocean' | 'stream' | 'countryside' | 'wind';

interface AmbientSoundConfig {
  name: string;
  url: string;
  volume: number;
}

export const AMBIENT_SOUNDS: Record<Exclude<AmbientSound, 'none'>, AmbientSoundConfig> = {
  rain: {
    name: '雨声',
    url: '/sounds/rain.ogg',
    volume: 0.3,
  },
  cafe: {
    name: '咖啡馆',
    url: '/sounds/cafe.ogg',
    volume: 0.1,
  },
  fireplace: {
    name: '壁炉',
    url: '/sounds/fireplace.ogg',
    volume: 0.5,
  },
  forest: {
    name: '森林',
    url: '/sounds/forest.ogg',
    volume: 0.2,
  },
  ocean: {
    name: '海浪',
    url: '/sounds/ocean.ogg',
    volume: 0.28,
  },
  stream: {
    name: '溪流',
    url: '/sounds/stream.ogg',
    volume: 0.36,
  },
  countryside: {
    name: '乡野',
    url: '/sounds/countryside.ogg',
    volume: 0.42,
  },
  wind: {
    name: '风声',
    url: '/sounds/wind.ogg',
    volume: 0.14,
  },
};

// Ambient sound player (singleton)
class AmbientPlayer {
  private audio: HTMLAudioElement | null = null;
  private currentSound: AmbientSound = 'none';
  private isPlaying = false;
  private playRequestId = 0;
  private currentVolume = 0;

  private toPerceivedVolume(volume: number): number {
    const clamped = Math.max(0, Math.min(1, volume));
    return clamped * clamped;
  }

  async play(sound: AmbientSound, volume?: number): Promise<boolean> {
    if (sound === 'none') {
      this.stop();
      return true;
    }

    if (this.currentSound === sound && this.isPlaying) {
      if (typeof volume === 'number') {
        this.setVolume(volume);
      }
      return true; // Already playing this sound
    }

    this.stop();
    const requestId = this.playRequestId;

    const config = AMBIENT_SOUNDS[sound];
    if (!config) return false;

    const audio = new Audio(config.url);
    audio.loop = true;
    this.currentVolume = volume ?? config.volume;
    audio.volume = this.toPerceivedVolume(this.currentVolume);
    audio.preload = 'auto';

    try {
      await audio.play();
      if (requestId !== this.playRequestId) {
        audio.pause();
        audio.currentTime = 0;
        return false;
      }
      this.audio = audio;
      this.currentSound = sound;
      this.isPlaying = true;
      return true;
    } catch (e) {
      audio.pause();
      this.audio = null;
      this.currentSound = 'none';
      this.isPlaying = false;
      this.currentVolume = 0;
      console.info(`Ambient sound "${config.name}" not available: ${config.url}`, e);
      return false;
    }
  }

  stop(): void {
    this.playRequestId += 1;
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.audio = null;
    }
    this.currentSound = 'none';
    this.isPlaying = false;
    this.currentVolume = 0;
  }

  setVolume(volume: number): void {
    this.currentVolume = Math.max(0, Math.min(1, volume));
    if (this.audio) {
      this.audio.volume = this.toPerceivedVolume(this.currentVolume);
    }
  }

  getCurrentSound(): AmbientSound {
    return this.currentSound;
  }

  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  getCurrentVolume(): number {
    return this.currentVolume;
  }
}

export const ambientPlayer = new AmbientPlayer();
