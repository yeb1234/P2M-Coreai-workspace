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
    volume: 0.3,
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

export const AMBIENT_PRELOAD_ORDER: Array<Exclude<AmbientSound, 'none'>> = [
  'rain',
  'fireplace',
  'forest',
  'ocean',
  'countryside',
  'stream',
  'wind',
  'cafe',
];

// Ambient sound player (singleton)
class AmbientPlayer {
  private audio: HTMLAudioElement | null = null;
  private currentSound: AmbientSound = 'none';
  private isPlaying = false;
  private playRequestId = 0;
  private currentVolume = 0;
  private preloadedAudio = new Map<Exclude<AmbientSound, 'none'>, HTMLAudioElement>();
  private preloadPromises = new Map<Exclude<AmbientSound, 'none'>, Promise<boolean>>();
  private preloadFailures = new Set<Exclude<AmbientSound, 'none'>>();
  private preloadQueue: Array<Exclude<AmbientSound, 'none'>> = [];
  private isPreloading = false;
  private pendingPlay: {
    sound: Exclude<AmbientSound, 'none'>;
    audio: HTMLAudioElement;
    promise: Promise<boolean>;
  } | null = null;

  private toPerceivedVolume(volume: number): number {
    const clamped = Math.max(0, Math.min(1, volume));
    return clamped * clamped;
  }

  private createAmbientAudio(sound: Exclude<AmbientSound, 'none'>, volume?: number): HTMLAudioElement | null {
    const config = AMBIENT_SOUNDS[sound];
    if (!config) return null;

    const audio = new Audio(config.url);
    audio.loop = true;
    audio.volume = this.toPerceivedVolume(volume ?? config.volume);
    audio.preload = 'auto';
    return audio;
  }

  private async preloadNow(sound: Exclude<AmbientSound, 'none'>): Promise<boolean> {
    if (this.preloadedAudio.has(sound)) return true;

    const existing = this.preloadPromises.get(sound);
    if (existing) return existing;

    const audio = this.createAmbientAudio(sound);
    if (!audio) return false;

    const promise = new Promise<boolean>((resolve) => {
      let settled = false;
      const cleanup = () => {
        audio.removeEventListener('canplaythrough', onReady);
        audio.removeEventListener('canplay', onReady);
        audio.removeEventListener('loadeddata', onReady);
        audio.removeEventListener('error', onError);
      };
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        cleanup();
        this.preloadPromises.delete(sound);
        if (ok) {
          this.preloadedAudio.set(sound, audio);
          this.preloadFailures.delete(sound);
        } else {
          this.preloadFailures.add(sound);
        }
        resolve(ok);
      };
      const onReady = () => finish(true);
      const onError = () => finish(false);

      audio.addEventListener('canplaythrough', onReady, { once: true });
      audio.addEventListener('canplay', onReady, { once: true });
      audio.addEventListener('loadeddata', onReady, { once: true });
      audio.addEventListener('error', onError, { once: true });

      try {
        audio.load();
      } catch {
        finish(false);
      }
    });

    this.preloadPromises.set(sound, promise);
    return promise;
  }

  private async drainPreloadQueue(): Promise<void> {
    if (this.isPreloading) return;
    this.isPreloading = true;

    try {
      while (this.preloadQueue.length > 0) {
        const sound = this.preloadQueue.shift()!;
        if (sound === this.currentSound && this.audio) continue;
        if (this.preloadedAudio.has(sound) || this.preloadPromises.has(sound)) continue;
        await this.preloadNow(sound);
      }
    } finally {
      this.isPreloading = false;
      if (this.preloadQueue.length > 0) {
        void this.drainPreloadQueue();
      }
    }
  }

  preload(sound: AmbientSound, priority = false): void {
    if (sound === 'none') return;
    if (this.preloadedAudio.has(sound) || this.preloadPromises.has(sound)) return;
    if (this.preloadQueue.includes(sound)) {
      if (priority) {
        this.preloadQueue = [sound, ...this.preloadQueue.filter((item) => item !== sound)];
      }
      return;
    }

    if (priority) {
      this.preloadQueue.unshift(sound);
    } else {
      this.preloadQueue.push(sound);
    }
    void this.drainPreloadQueue();
  }

  /**
   * 预加载环境音。
   *
   * 只加载「当前选中的那一个」，不再全量排队。
   *
   * 原来会把 AMBIENT_PRELOAD_ORDER 里所有声音都排队下载 —— 实测首屏
   * 因此发出 15 个 audio 请求、共 1147KB，占整个首屏传输量的 98%
   * （js + css 才 20KB 左右）。而绝大多数用户根本不切环境音。
   *
   * 取舍：切声音时如果那个文件没缓存，会等一下才出声。换首屏快 1MB，
   * 划算。
   */
  preloadAll(preferredSound: AmbientSound = 'none'): void {
    if (preferredSound !== 'none') {
      this.preload(preferredSound, true);
    }
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

    if (this.pendingPlay?.sound === sound) {
      if (typeof volume === 'number') {
        this.currentVolume = Math.max(0, Math.min(1, volume));
        this.pendingPlay.audio.volume = this.toPerceivedVolume(this.currentVolume);
      }
      return this.pendingPlay.promise;
    }

    if (this.currentSound === sound && this.audio && !this.isPlaying) {
      if (typeof volume === 'number') {
        this.setVolume(volume);
      }
      const requestId = this.playRequestId + 1;
      this.playRequestId = requestId;
      try {
        await this.audio.play();
        if (requestId !== this.playRequestId) return true;
        this.isPlaying = true;
        return true;
      } catch (e) {
        if (requestId !== this.playRequestId) return true;
        const config = AMBIENT_SOUNDS[sound];
        console.info(`Ambient sound "${config?.name ?? sound}" resume failed`, e);
        return false;
      }
    }

    this.stop();
    const requestId = this.playRequestId;

    const config = AMBIENT_SOUNDS[sound];
    if (!config) return false;

    const audio = this.preloadedAudio.get(sound) ?? this.createAmbientAudio(sound, volume);
    if (!audio) return false;
    this.preloadedAudio.delete(sound);
    this.preloadFailures.delete(sound);
    this.currentVolume = volume ?? config.volume;
    audio.volume = this.toPerceivedVolume(this.currentVolume);
    audio.loop = true;
    audio.preload = 'auto';

    const playPromise = (async () => {
      try {
        await audio.play();
        if (requestId !== this.playRequestId) {
          audio.pause();
          audio.currentTime = 0;
          return true;
        }
        this.audio = audio;
        this.currentSound = sound;
        this.isPlaying = true;
        return true;
      } catch (e) {
        audio.pause();
        if (requestId !== this.playRequestId) {
          return true;
        }
        if (this.preloadedAudio.get(sound) === audio) {
          this.preloadedAudio.delete(sound);
        }
        this.audio = null;
        this.currentSound = 'none';
        this.isPlaying = false;
        this.currentVolume = 0;
        console.info(`Ambient sound "${config.name}" not available: ${config.url}`, e);
        return false;
      } finally {
        if (this.pendingPlay?.audio === audio) {
          this.pendingPlay = null;
        }
      }
    })();

    this.pendingPlay = { sound, audio, promise: playPromise };
    return playPromise;
  }

  stop(): void {
    this.playRequestId += 1;
    if (this.pendingPlay) {
      this.pendingPlay.audio.pause();
      this.pendingPlay.audio.currentTime = 0;
      this.pendingPlay = null;
    }
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.audio = null;
    }
    this.currentSound = 'none';
    this.isPlaying = false;
    this.currentVolume = 0;
  }

  pause(): void {
    this.playRequestId += 1;
    if (this.pendingPlay) {
      this.pendingPlay.audio.pause();
      this.pendingPlay = null;
    }
    if (this.audio) {
      this.audio.pause();
    }
    this.isPlaying = false;
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
