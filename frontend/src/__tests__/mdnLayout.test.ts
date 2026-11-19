import { describe, expect, it } from 'vitest';
import {
  MDN_LIBRARY_DEFAULT_WIDTH,
  MDN_LIBRARY_MAX_WIDTH,
  MDN_LIBRARY_MIN_WIDTH,
  MDN_SPLIT_DEFAULT_RATIO,
  MDN_SPLIT_MAX_RATIO,
  MDN_SPLIT_MIN_RATIO,
  clampMdnLibraryWidth,
  clampMdnSplitRatio,
} from '../components/mdnotes/mdnLayout';

describe('markdown notes layout', () => {
  it('clamps the library width to the draggable range', () => {
    expect(clampMdnLibraryWidth(120)).toBe(MDN_LIBRARY_MIN_WIDTH);
    expect(clampMdnLibraryWidth(999)).toBe(MDN_LIBRARY_MAX_WIDTH);
    expect(clampMdnLibraryWidth(MDN_LIBRARY_DEFAULT_WIDTH)).toBe(MDN_LIBRARY_DEFAULT_WIDTH);
  });

  it('keeps both editor and preview usable in split mode', () => {
    expect(clampMdnSplitRatio(5)).toBe(MDN_SPLIT_MIN_RATIO);
    expect(clampMdnSplitRatio(99)).toBe(MDN_SPLIT_MAX_RATIO);
    expect(clampMdnSplitRatio(MDN_SPLIT_DEFAULT_RATIO)).toBe(MDN_SPLIT_DEFAULT_RATIO);
  });
});
