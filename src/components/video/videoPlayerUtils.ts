export const PLAYER_SPEED_MIN = 0.5;
export const PLAYER_SPEED_MAX = 2;
export const PLAYER_SPEED_STEP = 0.1;

export function clampPlaybackRate(value: number): number {
  const next = Math.max(PLAYER_SPEED_MIN, Math.min(PLAYER_SPEED_MAX, value));
  return Math.round(next * 10) / 10;
}

export function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
