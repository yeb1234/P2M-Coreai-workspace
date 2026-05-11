import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playInteractionSound, playPomodoroCue, playTickSound, soundController } from '../lib/sounds';
import { useNotificationStore } from '../stores/notificationStore';

const defaultSettings = {
  enablePomodoroNotif: true,
  enableTodoNotif: true,
  enableSystemNotif: true,
  soundEnabled: true,
};

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
