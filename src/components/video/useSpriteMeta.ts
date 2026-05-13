import { useEffect, useState, type CSSProperties } from 'react';
import { getSpriteUrl, type SpriteMeta } from '../../lib/videoApi';

export type SpriteMetaState =
  | { status: 'idle'; meta: null }
  | { status: 'loading'; meta: null }
  | { status: 'ready'; meta: SpriteMeta }
  | { status: 'error'; meta: null };

export function useSpriteMeta(videoId: number | null, enabled = true) {
  const [state, setState] = useState<SpriteMetaState>({ status: 'idle', meta: null });

  useEffect(() => {
    if (!videoId || !enabled) {
      const id = setTimeout(() => setState({ status: 'idle', meta: null }), 0);
      return () => clearTimeout(id);
    }

    let cancelled = false;
    const loadingId = setTimeout(() => setState({ status: 'loading', meta: null }), 0);

    fetch(getSpriteUrl(videoId))
      .then((response) => {
        if (!response.ok) throw new Error(`Sprite request failed: ${response.status}`);
        const raw = response.headers.get('X-Sprite-Meta');
        if (!raw) throw new Error('Sprite metadata header missing');
        const meta = JSON.parse(raw) as SpriteMeta;
        if (!meta.frame_width || !meta.frame_height || !meta.cols || !meta.rows || !meta.total_frames) {
          throw new Error('Invalid sprite metadata');
        }
        if (!cancelled) setState({ status: 'ready', meta });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', meta: null });
      });

    return () => {
      cancelled = true;
      clearTimeout(loadingId);
    };
  }, [enabled, videoId]);

  return videoId && enabled ? state : ({ status: 'idle', meta: null } satisfies SpriteMetaState);
}

export function getFixedSpriteFrameStyle(videoId: number, meta: SpriteMeta, frameIdx: number, frameWidth: number): CSSProperties {
  const safeFrameIdx = Math.max(0, Math.min(meta.total_frames - 1, frameIdx));
  const col = safeFrameIdx % meta.cols;
  const row = Math.floor(safeFrameIdx / meta.cols);
  const scale = frameWidth / meta.frame_width;
  const frameHeight = Math.round(meta.frame_height * scale);
  const sheetWidth = Math.round(meta.cols * meta.frame_width * scale);
  const sheetHeight = Math.round(meta.rows * meta.frame_height * scale);

  return {
    width: frameWidth,
    height: frameHeight,
    backgroundImage: `url(${getSpriteUrl(videoId)})`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: `${sheetWidth}px ${sheetHeight}px`,
    backgroundPosition: `-${col * frameWidth}px -${row * frameHeight}px`,
  };
}

export function getResponsiveSpriteFrameStyle(videoId: number, meta: SpriteMeta, frameIdx: number): CSSProperties {
  const safeFrameIdx = Math.max(0, Math.min(meta.total_frames - 1, frameIdx));
  const col = safeFrameIdx % meta.cols;
  const row = Math.floor(safeFrameIdx / meta.cols);
  const x = meta.cols <= 1 ? 0 : (col / (meta.cols - 1)) * 100;
  const y = meta.rows <= 1 ? 0 : (row / (meta.rows - 1)) * 100;

  return {
    backgroundImage: `url(${getSpriteUrl(videoId)})`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: `${meta.cols * 100}% ${meta.rows * 100}%`,
    backgroundPosition: `${x}% ${y}%`,
  };
}
