import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playInteractionSound, playPomodoroCue, playTickSound, soundController } from '../lib/sounds';
import { useNotificationStore } from '../stores/notificationStore';

const defaultSettings = {
  enablePomodoroNotif: true,
  enableTodoNotif: true,
  enableSystemNotif: true,
  soundEnabled: true,
};

async function flushMicrotasks(times = 20): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

describe('soundController', () => {
  const originalAudio = globalThis.Audio;
  const originalAudioContext = globalThis.AudioContext;
  let audioPlay: ReturnType<typeof vi.fn>;
  let createOscillator: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    useNotificationStore.setState({
      settings: defaultSettings,
    });

    audioPlay = vi.fn().mockResolvedValue(undefined);
    class MockAudio {
      src: string;
      volume = 1;
      preload = '';

      constructor(src: string) {
        this.src = src;
      }

      play = audioPlay;
    }
    globalThis.Audio = MockAudio as unknown as typeof Audio;

    const gain = {
      gain: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    };
    const oscillator = {
      type: 'sine',
      frequency: { value: 0 },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    createOscillator = vi.fn(() => oscillator);
    class MockAudioContext {
      currentTime = 0;
      destination = {};
      createOscillator = createOscillator;
      createGain = vi.fn(() => gain);
    }
    globalThis.AudioContext = MockAudioContext as unknown as typeof AudioContext;
  });

  afterEach(() => {
    globalThis.Audio = originalAudio;
    globalThis.AudioContext = originalAudioContext;
    vi.restoreAllMocks();
  });

  it('routes legacy interaction helper through the controller', () => {
    const spy = vi.spyOn(soundController, 'playInteraction');

    playInteractionSound('tap');

    expect(spy).toHaveBeenCalledWith('tap');
    expect(createOscillator).toHaveBeenCalledTimes(1);
  });

  it('does not play tones when app sounds are disabled', () => {
    useNotificationStore.setState({
      settings: { ...defaultSettings, soundEnabled: false },
    });

    playInteractionSound('success');
    playTickSound();

    expect(createOscillator).not.toHaveBeenCalled();
  });

  it('plays pomodoro cue media with configured volume', () => {
    playPomodoroCue('complete');

    expect(audioPlay).toHaveBeenCalledTimes(1);
  });

  it('does not create pomodoro media when app sounds are disabled', () => {
    useNotificationStore.setState({
      settings: { ...defaultSettings, soundEnabled: false },
    });

    playPomodoroCue('start');

    expect(audioPlay).not.toHaveBeenCalled();
  });
});

describe('ambientPlayer', () => {
  const originalAudio = globalThis.Audio;

  afterEach(() => {
    globalThis.Audio = originalAudio;
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('treats stale same-sound resume requests as harmless after a newer resume wins', async () => {
    vi.resetModules();

    const playResolvers: Array<() => void> = [];
    const pauseSpy = vi.fn();

    class MockAudio {
      src: string;
      loop = false;
      volume = 1;
      preload = '';
      currentTime = 0;

      constructor(src: string) {
        this.src = src;
      }

      play = vi.fn(() => new Promise<void>((resolve) => {
        playResolvers.push(resolve);
      }));
      pause = pauseSpy;
    }

    globalThis.Audio = MockAudio as unknown as typeof Audio;

    const { ambientPlayer } = await import('../lib/sounds');

    const initial = ambientPlayer.play('rain', 0.3);
    expect(playResolvers).toHaveLength(1);
    playResolvers[0]();
    await expect(initial).resolves.toBe(true);
    expect(ambientPlayer.getIsPlaying()).toBe(true);

    ambientPlayer.pause();
    expect(ambientPlayer.getCurrentSound()).toBe('rain');
    expect(ambientPlayer.getIsPlaying()).toBe(false);

    const first = ambientPlayer.play('rain', 0.3);
    const second = ambientPlayer.play('rain', 0.3);

    expect(playResolvers).toHaveLength(3);

    playResolvers[2]();
    await expect(second).resolves.toBe(true);
    expect(ambientPlayer.getIsPlaying()).toBe(true);
    expect(ambientPlayer.getCurrentSound()).toBe('rain');

    playResolvers[1]();
    await expect(first).resolves.toBe(true);

    expect(ambientPlayer.getIsPlaying()).toBe(true);
    expect(ambientPlayer.getCurrentSound()).toBe('rain');
  });

  it('preloads the preferred ambient sound before the rest of the queue', async () => {
    vi.resetModules();

    const loaded: string[] = [];
    class MockAudio {
      src: string;
      loop = false;
      volume = 1;
      preload = '';
      currentTime = 0;
      private listeners = new Map<string, Array<() => void>>();

      constructor(src: string) {
        this.src = src;
      }

      addEventListener(type: string, listener: () => void) {
        this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
      }
      removeEventListener(type: string, listener: () => void) {
        this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item !== listener));
      }
      load = vi.fn(() => {
        loaded.push(this.src);
        this.listeners.get('loadeddata')?.forEach((listener) => listener());
      });
      play = vi.fn().mockResolvedValue(undefined);
      pause = vi.fn();
    }

    globalThis.Audio = MockAudio as unknown as typeof Audio;

    const { ambientPlayer } = await import('../lib/sounds');
    ambientPlayer.preloadAll('wind');
    await flushMicrotasks();

    expect(loaded[0]).toBe('/sounds/wind.ogg');
    expect(loaded).toContain('/sounds/rain.ogg');
  });

  it('does not create duplicate preload requests for the same sound', async () => {
    vi.resetModules();

    const created: string[] = [];
    class MockAudio {
      src: string;
      loop = false;
      volume = 1;
      preload = '';
      currentTime = 0;
      private listeners = new Map<string, Array<() => void>>();

      constructor(src: string) {
        this.src = src;
        created.push(src);
      }

      addEventListener(type: string, listener: () => void) {
        this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
      }
      removeEventListener(type: string, listener: () => void) {
        this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item !== listener));
      }
      load = vi.fn();
      play = vi.fn().mockResolvedValue(undefined);
      pause = vi.fn();
    }

    globalThis.Audio = MockAudio as unknown as typeof Audio;

    const { ambientPlayer } = await import('../lib/sounds');
    ambientPlayer.preload('rain');
    ambientPlayer.preload('rain');

    expect(created.filter((src) => src === '/sounds/rain.ogg')).toHaveLength(1);
  });

  it('reuses preloaded ambient audio when playback starts', async () => {
    vi.resetModules();

    const instances: MockAudio[] = [];
    class MockAudio {
      src: string;
      loop = false;
      volume = 1;
      preload = '';
      currentTime = 0;
      private listeners = new Map<string, Array<() => void>>();

      constructor(src: string) {
        this.src = src;
        instances.push(this);
      }

      addEventListener(type: string, listener: () => void) {
        this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
      }
      removeEventListener(type: string, listener: () => void) {
        this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item !== listener));
      }
      load = vi.fn(() => {
        this.listeners.get('loadeddata')?.forEach((listener) => listener());
      });
      play = vi.fn().mockResolvedValue(undefined);
      pause = vi.fn();
    }

    globalThis.Audio = MockAudio as unknown as typeof Audio;

    const { ambientPlayer } = await import('../lib/sounds');
    ambientPlayer.preload('rain');
    await flushMicrotasks();

    await expect(ambientPlayer.play('rain', 0.3)).resolves.toBe(true);

    expect(instances).toHaveLength(1);
    expect(instances[0].play).toHaveBeenCalledTimes(1);
    expect(ambientPlayer.getCurrentSound()).toBe('rain');
  });

  it('retries normal playback when ambient preload failed', async () => {
    vi.resetModules();

    let failLoad = true;
    const instances: MockAudio[] = [];
    class MockAudio {
      src: string;
      loop = false;
      volume = 1;
      preload = '';
      currentTime = 0;
      private listeners = new Map<string, Array<() => void>>();

      constructor(src: string) {
        this.src = src;
        instances.push(this);
      }

      addEventListener(type: string, listener: () => void) {
        this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
      }
      removeEventListener(type: string, listener: () => void) {
        this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item !== listener));
      }
      load = vi.fn(() => {
        const event = failLoad ? 'error' : 'loadeddata';
        this.listeners.get(event)?.forEach((listener) => listener());
      });
      play = vi.fn().mockResolvedValue(undefined);
      pause = vi.fn();
    }

    globalThis.Audio = MockAudio as unknown as typeof Audio;

    const { ambientPlayer } = await import('../lib/sounds');
    ambientPlayer.preload('forest');
    await flushMicrotasks();

    failLoad = false;
    await expect(ambientPlayer.play('forest', 0.2)).resolves.toBe(true);

    expect(instances).toHaveLength(2);
    expect(instances[1].play).toHaveBeenCalledTimes(1);
    expect(ambientPlayer.getCurrentSound()).toBe('forest');
  });
});
