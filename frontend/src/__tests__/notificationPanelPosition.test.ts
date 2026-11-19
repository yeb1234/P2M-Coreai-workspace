import { describe, expect, it } from 'vitest';
import { clampPanelPosition, getPanelOpenPosition } from '../components/layout/notificationPanelPosition';

describe('notification panel positioning', () => {
  it('opens near the main content right edge', () => {
    expect(getPanelOpenPosition({ right: 1200 }, 1440)).toEqual({ x: 800, y: 64 });
  });

  it('keeps a minimum left margin when the content area is narrow', () => {
    expect(getPanelOpenPosition({ right: 320 }, 390)).toEqual({ x: 16, y: 64 });
  });

  it('falls back to viewport width when there is no main rect', () => {
    expect(getPanelOpenPosition(undefined, 1440)).toEqual({ x: 980, y: 64 });
  });

  it('clamps dragged position inside the viewport', () => {
    expect(clampPanelPosition({ x: -20, y: -10 }, 1440, 900)).toEqual({ x: 0, y: 0 });
    expect(clampPanelPosition({ x: 2000, y: 1200 }, 1440, 900)).toEqual({ x: 1056, y: 800 });
  });
});
