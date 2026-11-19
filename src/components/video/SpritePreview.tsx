import { getFixedSpriteFrameStyle, useSpriteMeta } from './useSpriteMeta';

const PREVIEW_WIDTH = 180;

export function SpritePreview({ videoId, time }: { videoId: number; time: number }) {
  const { status, meta } = useSpriteMeta(videoId);

  if (status === 'loading') {
    return (
      <div className="grid h-[102px] w-[180px] place-items-center rounded-lg border border-white/20 bg-black/80 text-xs text-white/70 shadow-2xl">
        生成预览中...
      </div>
    );
  }

  if (status === 'error' || !meta) {
    return (
      <div className="grid h-[102px] w-[180px] place-items-center rounded-lg border border-white/20 bg-black/80 px-2 text-center text-xs text-white/60 shadow-2xl">
        暂无雪碧图
      </div>
    );
  }

  const frameIdx = Math.max(0, Math.min(meta.total_frames - 1, Math.floor(time / meta.frame_interval)));

  return (
    <div className="bg-black rounded-lg overflow-hidden shadow-2xl border border-white/20">
      <div
        aria-label="视频预览画面"
        role="img"
        style={getFixedSpriteFrameStyle(videoId, meta, frameIdx, PREVIEW_WIDTH)}
      />
    </div>
  );
}
