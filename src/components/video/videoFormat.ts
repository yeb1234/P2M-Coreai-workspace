export function formatVideoDuration(sec: number | null | undefined): string {
  if (!sec) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function getWatchProgressPercent(progress: number | null | undefined, duration: number | null | undefined): number | null {
  if (progress == null || !duration || duration <= 0) return null;
  return Math.max(0, Math.min(100, (progress / duration) * 100));
}

export function formatWatchProgress(progress: number | null | undefined, duration: number | null | undefined): string {
  return `${formatVideoDuration(progress)} / ${formatVideoDuration(duration)}`;
}
