import { useEffect, useState } from 'react';
import { getSpriteUrl, type SpriteMeta } from '../../lib/videoApi';

function useSpriteMeta(videoId: number | null) {
  const [meta, setMeta] = useState<SpriteMeta | null>(null);
  useEffect(() => {
    if (!videoId) return;
    let cancelled = false;
    fetch(getSpriteUrl(videoId))
      .then((r) => {
        const raw = r.headers.get('X-Sprite-Meta');
        if (raw && !cancelled) setMeta(JSON.parse(raw));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [videoId]);
  return videoId ? meta : null;
}

export function SpritePreview({ videoId, time }: { videoId: number; time: number }) {
  const meta = useSpriteMeta(videoId);
  if (!meta) return null;

  const frameIdx = Math.floor(time / meta.frame_interval);
  const col = frameIdx % meta.cols;
  const row = Math.floor(frameIdx / meta.cols);
  const scale = 3;

  return (
    <div className="bg-black rounded-lg overflow-hidden shadow-2xl border border-white/20">
      <img
        src={getSpriteUrl(videoId)}
        alt=""
        style={{
          width: meta.frame_width * scale,
          height: meta.frame_height * scale,
          objectFit: 'none',
          objectPosition: `-${col * meta.frame_width * scale}px -${row * meta.frame_height * scale}px`,
        }}
        draggable={false}
      />
    </div>
  );
}
