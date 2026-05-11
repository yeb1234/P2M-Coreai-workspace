export const NOTIFICATION_PANEL_WIDTH = 384;
const PANEL_TOP_OFFSET = 64;
const PANEL_EDGE_GAP = 16;

export interface PanelPoint {
  x: number;
  y: number;
}

export function getPanelOpenPosition(mainRect: Pick<DOMRect, 'right'> | undefined, viewportWidth: number): PanelPoint {
  const rightEdge = mainRect ? mainRect.right : viewportWidth - 60;
  return {
    x: Math.max(PANEL_EDGE_GAP, rightEdge - 400),
    y: PANEL_TOP_OFFSET,
  };
}

export function clampPanelPosition(point: PanelPoint, viewportWidth: number, viewportHeight: number): PanelPoint {
  return {
    x: Math.max(0, Math.min(point.x, viewportWidth - NOTIFICATION_PANEL_WIDTH)),
    y: Math.max(0, Math.min(point.y, viewportHeight - 100)),
  };
}
