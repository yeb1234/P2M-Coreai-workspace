import { describe, expect, it } from 'vitest';
import {
  createAmbientVolumeDefaults,
  getAmbientFocusPlan,
  getAmbientTogglePlan,
  isAmbientFocusActive,
} from '../lib/ambientSoundRules';

describe('ambient sound rules', () => {
  it('detects active focus only during running work sessions', () => {
    expect(isAmbientFocusActive('focus', 'running', 'work')).toBe(true);
    expect(isAmbientFocusActive('focus', 'running', 'short_break')).toBe(false);
    expect(isAmbientFocusActive('focus', 'paused', 'work')).toBe(false);
    expect(isAmbientFocusActive('manual', 'running', 'work')).toBe(false);
  });

  it('toggles off the selected sound in either mode', () => {
    expect(getAmbientTogglePlan({
      mode: 'manual',
      currentSound: 'cafe',
      clickedSound: 'cafe',
      isFocusActive: false,
    })).toEqual({ nextSound: 'none', playback: 'stop' });

    expect(getAmbientTogglePlan({
      mode: 'focus',
      currentSound: 'rain',
      clickedSound: 'rain',
      isFocusActive: true,
    })).toEqual({ nextSound: 'none', playback: 'stop' });
  });

  it('plays immediately in manual mode', () => {
    expect(getAmbientTogglePlan({
      mode: 'manual',
      currentSound: 'none',
      clickedSound: 'fireplace',
      isFocusActive: false,
    })).toEqual({ nextSound: 'fireplace', playback: 'play' });
  });

  it('defers selection in focus mode until a work session is running', () => {
    expect(getAmbientTogglePlan({
      mode: 'focus',
      currentSound: 'none',
      clickedSound: 'forest',
      isFocusActive: false,
    })).toEqual({ nextSound: 'forest', playback: 'defer' });
  });

  it('switches immediately in focus mode when work is already running', () => {
    expect(getAmbientTogglePlan({
      mode: 'focus',
      currentSound: 'rain',
      clickedSound: 'ocean',
      isFocusActive: true,
    })).toEqual({ nextSound: 'ocean', playback: 'play' });
  });

  it('stops focus audio outside active focus time', () => {
    expect(getAmbientFocusPlan({
      mode: 'focus',
      selectedSound: 'rain',
      isFocusActive: false,
    })).toBe('stop');
  });

  it('plays selected focus audio when focus starts', () => {
    expect(getAmbientFocusPlan({
      mode: 'focus',
      selectedSound: 'rain',
      isFocusActive: true,
    })).toBe('play');
  });

  it('uses per-sound default volume percentages from sound configs', () => {
    const defaults = createAmbientVolumeDefaults();

    expect(defaults.cafe).toBe(10);
    expect(defaults.fireplace).toBe(50);
    expect(defaults.rain).toBe(30);
  });
});
