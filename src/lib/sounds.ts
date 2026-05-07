// Sound system for Pomodoro timer
// Uses Web Audio API for notification tones
// Ambient sounds use HTML5 Audio with free sound URLs

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

// Play a pleasant chime notification
export function playNotificationSound(): void {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Three-note chime (C5, E5, G5)
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.value = freq;

      gain.gain.setValueAtTime(0, now + i * 0.15);
      gain.gain.linearRampToValueAtTime(0.3, now + i * 0.15 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 0.8);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + i * 0.15);
      osc.stop(now + i * 0.15 + 0.8);
    });
  } catch (e) {
    console.warn('Could not play notification sound:', e);
  }
}

// Play a soft tick sound (for each second, optional)
export function playTickSound(): void {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.value = 800;

    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.05);
  } catch (e) {
    // Silent fail for tick
  }
}

// Ambient sound types
export type AmbientSound = 'none' | 'rain' | 'cafe' | 'fireplace' | 'forest';

interface AmbientSoundConfig {
  name: string;
  // Replace these URLs with your own AI-generated audio files
  // Recommended: 5-10 minute loops, MP3 format
  url: string;
  volume: number;
}

export const AMBIENT_SOUNDS: Record<Exclude<AmbientSound, 'none'>, AmbientSoundConfig> = {
  rain: {
    name: '雨声',
    url: '/sounds/rain.mp3', // Place your AI-generated rain sound here
    volume: 0.3,
  },
  cafe: {
    name: '咖啡馆',
    url: '/sounds/cafe.mp3', // Place your AI-generated cafe ambient here
    volume: 0.2,
  },
  fireplace: {
    name: '壁炉',
    url: '/sounds/fireplace.mp3', // Place your AI-generated fireplace sound here
    volume: 0.25,
  },
  forest: {
    name: '森林',
    url: '/sounds/forest.mp3', // Place your AI-generated forest ambient here
    volume: 0.2,
  },
};

// Ambient sound player (singleton)
class AmbientPlayer {
  private audio: HTMLAudioElement | null = null;
  private currentSound: AmbientSound = 'none';
  private isPlaying = false;

  play(sound: AmbientSound): void {
    if (sound === 'none') {
      this.stop();
      return;
    }

    if (this.currentSound === sound && this.isPlaying) {
      return; // Already playing this sound
    }

    this.stop();

    const config = AMBIENT_SOUNDS[sound];
    if (!config) return;

    this.audio = new Audio(config.url);
    this.audio.loop = true;
    this.audio.volume = config.volume;
    this.currentSound = sound;

    this.audio.play().catch(() => {
      // Audio file not found - this is expected if sounds haven't been added yet
      console.info(`Ambient sound "${config.name}" not available. Place audio file at: ${config.url}`);
    });
    this.isPlaying = true;
  }

  stop(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.audio = null;
    }
    this.currentSound = 'none';
    this.isPlaying = false;
  }

  setVolume(volume: number): void {
    if (this.audio) {
      this.audio.volume = Math.max(0, Math.min(1, volume));
    }
  }

  getCurrentSound(): AmbientSound {
    return this.currentSound;
  }

  getIsPlaying(): boolean {
    return this.isPlaying;
  }
}

export const ambientPlayer = new AmbientPlayer();
