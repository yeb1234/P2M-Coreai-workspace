export const MDN_LIBRARY_MIN_WIDTH = 210;
export const MDN_LIBRARY_MAX_WIDTH = 440;
export const MDN_LIBRARY_DEFAULT_WIDTH = 236;
export const MDN_SPLIT_MIN_RATIO = 30;
export const MDN_SPLIT_MAX_RATIO = 72;
export const MDN_SPLIT_DEFAULT_RATIO = 50;

export function clampMdnLibraryWidth(width: number): number {
  return Math.max(MDN_LIBRARY_MIN_WIDTH, Math.min(MDN_LIBRARY_MAX_WIDTH, Math.round(width)));
}

export function clampMdnSplitRatio(ratio: number): number {
  return Math.max(MDN_SPLIT_MIN_RATIO, Math.min(MDN_SPLIT_MAX_RATIO, Math.round(ratio)));
}

export function readMdnNumber(key: string, fallback: number, clamp: (value: number) => number): number {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? clamp(value) : fallback;
  } catch {
    return fallback;
  }
}

export function persistMdnNumber(key: string, value: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // localStorage may be unavailable in private mode; layout still works.
  }
}
