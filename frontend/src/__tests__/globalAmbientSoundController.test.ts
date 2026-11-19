import React from 'react';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlobalAmbientSoundController } from '../components/pomodoro/GlobalAmbientSoundController';
import { ambientPlayer } from '../lib/sounds';
import { usePomodoroStore } from '../stores/pomodoroStore';
import { DEFAULT_CONFIG } from '../types';

describe('GlobalAmbientSoundController', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not preload ambient sounds while disabled', () => {
    const preloadAll = vi.spyOn(ambientPlayer, 'preloadAll').mockImplementation(() => undefined);
    usePomodoroStore.setState({
      config: { ...DEFAULT_CONFIG, ambientSound: 'rain' },
      timer: {
        status: 'idle',
        phase: 'work',
        timeRemaining: DEFAULT_CONFIG.workDuration * 60,
        sessionsCompleted: 0,
        currentSessionId: null,
        linkedTodoId: null,
      },
    });

    render(React.createElement(GlobalAmbientSoundController, { enabled: false }));

    expect(preloadAll).not.toHaveBeenCalled();
  });

  it('preloads the configured ambient sound when enabled', () => {
    const preloadAll = vi.spyOn(ambientPlayer, 'preloadAll').mockImplementation(() => undefined);
    usePomodoroStore.setState({
      config: { ...DEFAULT_CONFIG, ambientSound: 'wind' },
      timer: {
        status: 'idle',
        phase: 'work',
        timeRemaining: DEFAULT_CONFIG.workDuration * 60,
        sessionsCompleted: 0,
        currentSessionId: null,
        linkedTodoId: null,
      },
    });

    render(React.createElement(GlobalAmbientSoundController, { enabled: true }));

    expect(preloadAll).toHaveBeenCalledWith('wind');
  });
});
