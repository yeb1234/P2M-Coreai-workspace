import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAmbientControllerForTests, useAmbientSoundController } from '../hooks/useAmbientSoundController';

describe('useAmbientSoundController', () => {
  const originalAudio = globalThis.Audio;
  let playSpy: ReturnType<typeof vi.fn>;
  let pauseSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
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
    localStorage.clear();
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

  it('restores manual ambient audio after refresh when it was playing before reload', async () => {
    localStorage.setItem('p2m-ambient-playback-state-v1', JSON.stringify({
      sound: 'rain',
      isPlaying: true,
    }));

    const hook = renderHook(() => useAmbientSoundController({
      mode: 'manual',
      timerStatus: 'idle',
      timerPhase: 'work',
      selectedSound: 'rain',
    }));

    expect(hook.result.current.sound).toBe('rain');
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it('does not restore manual ambient audio after refresh when the selected sound was not playing', async () => {
    localStorage.setItem('p2m-ambient-playback-state-v1', JSON.stringify({
      sound: 'rain',
      isPlaying: false,
    }));

    const hook = renderHook(() => useAmbientSoundController({
      mode: 'manual',
      timerStatus: 'idle',
      timerPhase: 'work',
      selectedSound: 'rain',
    }));

    expect(hook.result.current.sound).toBe('rain');
    expect(playSpy).not.toHaveBeenCalled();
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

  it('stops playback for timer reset and clears the selected ambient sound', async () => {
    const onSelectedSoundChange = vi.fn();
    const hook = renderHook(() => useAmbientSoundController({
      mode: 'manual',
      timerStatus: 'running',
      timerPhase: 'work',
      onSelectedSoundChange,
    }));

    await act(async () => {
      await hook.result.current.toggle('cafe');
    });

    expect(hook.result.current.sound).toBe('cafe');

    act(() => {
      hook.result.current.stopForTimerReset();
    });

    expect(pauseSpy).toHaveBeenCalledTimes(1);
    expect(hook.result.current.sound).toBe('none');
    expect(onSelectedSoundChange).toHaveBeenLastCalledWith('none');
  });

  it('pauses ambient audio during breaks and resumes the same sound on the next focus round', async () => {
    type Props = {
      status: 'running' | 'paused' | 'idle';
      phase: 'work' | 'short_break' | 'long_break';
    };
    const hook = renderHook(
      ({ status, phase }: Props) => useAmbientSoundController({
        mode: 'focus',
        timerStatus: status,
        timerPhase: phase,
      }),
      { initialProps: { status: 'running', phase: 'work' } },
    );

    await act(async () => {
      await hook.result.current.toggle('rain');
    });

    expect(hook.result.current.sound).toBe('rain');
    expect(playSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      hook.rerender({ status: 'running', phase: 'short_break' });
    });

    expect(pauseSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      hook.rerender({ status: 'running', phase: 'work' });
    });

    expect(playSpy).toHaveBeenCalledTimes(2);
    expect(hook.result.current.sound).toBe('rain');
  });

  it('starts focus audio from a persisted selected sound when a work round begins', async () => {
    type Props = {
      status: 'running' | 'paused' | 'idle';
      phase: 'work' | 'short_break' | 'long_break';
      selectedSound: 'none' | 'rain';
    };
    const hook = renderHook(
      ({ status, phase, selectedSound }: Props) => useAmbientSoundController({
        mode: 'focus',
        timerStatus: status,
        timerPhase: phase,
        selectedSound,
      }),
      { initialProps: { status: 'running', phase: 'short_break', selectedSound: 'rain' } },
    );

    expect(hook.result.current.sound).toBe('rain');
    expect(playSpy).not.toHaveBeenCalled();

    await act(async () => {
      hook.rerender({ status: 'running', phase: 'work', selectedSound: 'rain' });
    });

    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(hook.result.current.sound).toBe('rain');
  });

  it('starts persisted manual audio immediately and does not restart it when work begins', async () => {
    localStorage.setItem('p2m-ambient-playback-state-v1', JSON.stringify({
      sound: 'rain',
      isPlaying: true,
    }));
    type Props = {
      status: 'running' | 'paused' | 'idle';
      phase: 'work' | 'short_break' | 'long_break';
      selectedSound: 'none' | 'rain';
    };
    const hook = renderHook(
      ({ status, phase, selectedSound }: Props) => useAmbientSoundController({
        mode: 'manual',
        timerStatus: status,
        timerPhase: phase,
        selectedSound,
      }),
      { initialProps: { status: 'idle', phase: 'work', selectedSound: 'rain' } },
    );

    expect(hook.result.current.sound).toBe('rain');
    expect(playSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      hook.rerender({ status: 'running', phase: 'work', selectedSound: 'rain' });
    });

    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(hook.result.current.sound).toBe('rain');
  });

  it('keeps persisted manual audio playing during breaks', async () => {
    localStorage.setItem('p2m-ambient-playback-state-v1', JSON.stringify({
      sound: 'rain',
      isPlaying: true,
    }));
    type Props = {
      status: 'running' | 'paused' | 'idle';
      phase: 'work' | 'short_break' | 'long_break';
      selectedSound: 'none' | 'rain';
    };
    const hook = renderHook(
      ({ status, phase, selectedSound }: Props) => useAmbientSoundController({
        mode: 'manual',
        timerStatus: status,
        timerPhase: phase,
        selectedSound,
      }),
      { initialProps: { status: 'running', phase: 'work', selectedSound: 'rain' } },
    );

    expect(hook.result.current.sound).toBe('rain');
    expect(playSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      hook.rerender({ status: 'running', phase: 'short_break', selectedSound: 'rain' });
    });

    expect(pauseSpy).not.toHaveBeenCalled();
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(hook.result.current.sound).toBe('rain');
  });

  it('does not start audio when the saved ambient button state is off', async () => {
    renderHook(() => useAmbientSoundController({
      mode: 'manual',
      timerStatus: 'running',
      timerPhase: 'work',
      selectedSound: 'none',
    }));

    expect(playSpy).not.toHaveBeenCalled();
    expect(pauseSpy).not.toHaveBeenCalled();
  });

  it('plays manual selection immediately outside focus time', async () => {
    type Props = {
      status: 'running' | 'paused' | 'idle';
      phase: 'work' | 'short_break' | 'long_break';
      selectedSound: 'none' | 'forest';
    };
    const onSelectedSoundChange = vi.fn();
    const hook = renderHook(
      ({ status, phase, selectedSound }: Props) => useAmbientSoundController({
        mode: 'manual',
        timerStatus: status,
        timerPhase: phase,
        selectedSound,
        onSelectedSoundChange,
      }),
      { initialProps: { status: 'idle', phase: 'work', selectedSound: 'none' } },
    );

    await act(async () => {
      await hook.result.current.toggle('forest');
    });

    expect(hook.result.current.sound).toBe('forest');
    expect(onSelectedSoundChange).toHaveBeenCalledWith('forest');
    expect(playSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      hook.rerender({ status: 'running', phase: 'work', selectedSound: 'forest' });
    });

    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it('saves focus-mode selection outside focus time and waits until focus starts to play', async () => {
    type Props = {
      status: 'running' | 'paused' | 'idle';
      phase: 'work' | 'short_break' | 'long_break';
      selectedSound: 'none' | 'forest';
    };
    const onSelectedSoundChange = vi.fn();
    const hook = renderHook(
      ({ status, phase, selectedSound }: Props) => useAmbientSoundController({
        mode: 'focus',
        timerStatus: status,
        timerPhase: phase,
        selectedSound,
        onSelectedSoundChange,
      }),
      { initialProps: { status: 'idle', phase: 'work', selectedSound: 'none' } },
    );

    await act(async () => {
      await hook.result.current.toggle('forest');
    });

    expect(hook.result.current.sound).toBe('forest');
    expect(onSelectedSoundChange).toHaveBeenCalledWith('forest');
    expect(playSpy).not.toHaveBeenCalled();

    await act(async () => {
      hook.rerender({ status: 'running', phase: 'work', selectedSound: 'forest' });
    });

    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it('does not stop ambient audio while controller is disabled during hydration', async () => {
    renderHook(() => useAmbientSoundController({
      mode: 'focus',
      timerStatus: 'idle',
      timerPhase: 'work',
      enabled: false,
      selectedSound: 'none',
    }));

    expect(pauseSpy).not.toHaveBeenCalled();
    expect(playSpy).not.toHaveBeenCalled();
  });

  it('persists ambient sound selection through the change callback', async () => {
    const onSelectedSoundChange = vi.fn();
    const hook = renderHook(() => useAmbientSoundController({
      mode: 'focus',
      timerStatus: 'running',
      timerPhase: 'work',
      selectedSound: 'none',
      onSelectedSoundChange,
    }));

    await act(async () => {
      await hook.result.current.toggle('cafe');
    });

    expect(onSelectedSoundChange).toHaveBeenCalledWith('cafe');
  });

  it('uses database-backed playback state to restore manual ambient audio after refresh', async () => {
    renderHook(() => useAmbientSoundController({
      mode: 'manual',
      timerStatus: 'idle',
      timerPhase: 'work',
      selectedSound: 'rain',
      ambientWasPlaying: true,
    }));

    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it('does not let local browser state override database-backed playback state', async () => {
    localStorage.setItem('p2m-ambient-playback-state-v1', JSON.stringify({
      sound: 'rain',
      isPlaying: true,
    }));

    renderHook(() => useAmbientSoundController({
      mode: 'manual',
      timerStatus: 'idle',
      timerPhase: 'work',
      selectedSound: 'rain',
      ambientWasPlaying: false,
    }));

    expect(playSpy).not.toHaveBeenCalled();
  });

  it('saves volume changes through the database callback', async () => {
    const onVolumeChange = vi.fn();
    const hook = renderHook(({ volumeBySound }: { volumeBySound: { cafe: number } }) => useAmbientSoundController({
      mode: 'manual',
      timerStatus: 'idle',
      timerPhase: 'work',
      selectedSound: 'cafe',
      volumeBySound,
      onVolumeChange,
    }), { initialProps: { volumeBySound: { cafe: 30 } } });

    act(() => {
      hook.result.current.updateVolume(42);
    });

    expect(onVolumeChange).toHaveBeenCalledWith('cafe', 42);

    hook.rerender({ volumeBySound: { cafe: 42 } });

    expect(hook.result.current.volume).toBe(42);
  });

  it('turns the ambient button off when browser playback is rejected', async () => {
    playSpy.mockRejectedValueOnce(new Error('blocked'));
    const onSelectedSoundChange = vi.fn();
    const onPlaybackStateChange = vi.fn();
    const hook = renderHook(() => useAmbientSoundController({
      mode: 'manual',
      timerStatus: 'idle',
      timerPhase: 'work',
      selectedSound: 'none',
      onSelectedSoundChange,
      onPlaybackStateChange,
    }));

    await act(async () => {
      await hook.result.current.toggle('rain');
    });

    expect(hook.result.current.sound).toBe('none');
    expect(onSelectedSoundChange).toHaveBeenLastCalledWith('none');
    expect(onPlaybackStateChange).toHaveBeenLastCalledWith('none', false);
  });
});
