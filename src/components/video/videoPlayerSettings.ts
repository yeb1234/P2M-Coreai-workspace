import { clampPlaybackRate } from './videoPlayerUtils';

const PLAYER_SETTINGS_KEY = 'p2m-video-player-settings';

export interface PlayerSettings {
  showSubtitles: boolean;
  subtitleOpacity: number;
  subtitleSize: number;
  autoPlay: boolean;
  playbackRate: number;
  volume: number;
  muted: boolean;
}

const DEFAULT_PLAYER_SETTINGS: PlayerSettings = {
  showSubtitles: false,
  subtitleOpacity: 1,
  subtitleSize: 100,
  autoPlay: true,
  playbackRate: 1,
  volume: 1,
  muted: false,
};

export function loadPlayerSettings(): PlayerSettings {
  try {
    const raw = localStorage.getItem(PLAYER_SETTINGS_KEY);
    if (!raw) return DEFAULT_PLAYER_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<PlayerSettings>;
    return {
      showSubtitles: typeof parsed.showSubtitles === 'boolean' ? parsed.showSubtitles : DEFAULT_PLAYER_SETTINGS.showSubtitles,
      subtitleOpacity: typeof parsed.subtitleOpacity === 'number' ? Math.max(0, Math.min(1, parsed.subtitleOpacity)) : DEFAULT_PLAYER_SETTINGS.subtitleOpacity,
      subtitleSize: typeof parsed.subtitleSize === 'number' ? Math.max(50, Math.min(200, parsed.subtitleSize)) : DEFAULT_PLAYER_SETTINGS.subtitleSize,
      autoPlay: typeof parsed.autoPlay === 'boolean' ? parsed.autoPlay : DEFAULT_PLAYER_SETTINGS.autoPlay,
      playbackRate: typeof parsed.playbackRate === 'number' ? clampPlaybackRate(parsed.playbackRate) : DEFAULT_PLAYER_SETTINGS.playbackRate,
      volume: typeof parsed.volume === 'number' ? Math.max(0, Math.min(1, parsed.volume)) : DEFAULT_PLAYER_SETTINGS.volume,
      muted: typeof parsed.muted === 'boolean' ? parsed.muted : DEFAULT_PLAYER_SETTINGS.muted,
    };
  } catch {
    return DEFAULT_PLAYER_SETTINGS;
  }
}

export function savePlayerSettings(settings: PlayerSettings) {
  localStorage.setItem(PLAYER_SETTINGS_KEY, JSON.stringify(settings));
}
