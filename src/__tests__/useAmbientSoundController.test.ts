import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAmbientControllerForTests, useAmbientSoundController } from '../hooks/useAmbientSoundController';

describe('useAmbientSoundController', () => {
  const originalAudio = globalThis.Audio;
  let playSpy: ReturnType<typeof vi.fn>;
  let pauseSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetAmbientControllerForTests();
    playSpy = vi.fn().mockResolvedValue(undefined);
    pauseSpy = vi.fn();

    class MockAudio {
      src: string;
      loop = false;
      volume = 1;
      preload = '';
      currentTime = 0;

      constructor(src: string) {
        this.src = src;
      }

      play = playSpy;
      pause = pauseSpy;
    }

    globalThis.Audio = MockAudio as unknown as typeof Audio;
  });

  afterEach(() => {
    resetAmbientControllerForTests();
    globalThis.Audio = originalAudio;
    vi.restoreAllMocks();
  });

  it('keeps manual ambient audio playing across controller unmounts', async () => {
    const first = renderHook(() => useAmbientSoundController({
      mode: 'manual',
      timerStatus: 'idle',
      timerPhase: 'work',
    }));

    await act(async () => {
      await first.result.current.toggle('cafe');
    });

    expect(first.result.current.sound).toBe('cafe');
    expect(playSpy).toHaveBeenCalledTimes(1);

    first.unmount();

    expect(pauseSpy).not.toHaveBeenCalled();

    const second = renderHook(() => useAmbientSoundController({
      mode: 'manual',
      timerStatus: 'idle',
      timerPhase: 'work',
    }));

    expect(second.result.current.sound).toBe('cafe');
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it('does not resume manual ambient audio after the user turns it off', async () => {
    const first = renderHook(() => useAmbientSoundController({
      mode: 'manual',
      timerStatus: 'idle',
      timerPhase: 'work',
    }));

    await act(async () => {
      await first.result.current.toggle('rain');
    });

    await act(async () => {
      await first.result.current.toggle('rain');
    });

    expect(first.result.current.sound).toBe('none');

    first.unmount();

    const second = renderHook(() => useAmbientSoundController({
      mode: 'manual',
      timerStatus: 'idle',
      timerPhase: 'work',
    }));

    expect(second.result.current.sound).toBe('none');
    expect(playSpy).toHaveBeenCalledTimes(1);
  });
});
