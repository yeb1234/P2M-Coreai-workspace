import { Play } from 'lucide-react';

interface MediaErrorOverlayProps {
  message: string;
}

export function MediaErrorOverlay({ message }: MediaErrorOverlayProps) {
  if (!message) return null;
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/75 px-6 text-center">
      <div className="max-w-md rounded-xl border border-white/15 bg-black/50 p-4 text-sm leading-6 text-white shadow-xl">
        <p className="font-medium">{message}</p>
        <p className="mt-1 text-xs text-white/60">如果只在个别视频出现，多半是编码、文件路径或浏览器解码兼容问题。字幕已改为不再阻塞视频加载。</p>
      </div>
    </div>
  );
}

interface SubtitleOverlayProps {
  visible: boolean;
  text: string;
  opacity: number;
  size: number;
}

export function SubtitleOverlay({ visible, text, opacity, size }: SubtitleOverlayProps) {
  if (!visible || !text) return null;
  return (
    <div className="absolute inset-x-4 bottom-16 z-10 pointer-events-none flex justify-center" style={{ opacity }}>
      <div
        className="max-w-[86%] rounded-md bg-black/65 px-3 py-1.5 text-center text-white leading-snug shadow-lg"
        style={{ fontSize: `${Math.max(12, Math.round(18 * size / 100))}px` }}
      >
        {text}
      </div>
    </div>
  );
}

export function PausedOverlay({ isPlaying }: { isPlaying: boolean }) {
  if (isPlaying) return null;
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
      <div className="w-16 h-16 bg-black/40 backdrop-blur-sm rounded-full flex items-center justify-center">
        <Play size={28} className="text-white ml-1" />
      </div>
    </div>
  );
}
