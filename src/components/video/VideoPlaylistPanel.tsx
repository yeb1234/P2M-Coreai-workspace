import { CheckCircle2, List, Loader2, PlayCircle, RotateCcw, Sparkles } from 'lucide-react';
import { getThumbnailUrl, type PlaylistItem, type VideoItem } from '../../lib/videoApi';

interface VideoPlaylistPanelProps {
  currentVideo: VideoItem;
  playlist: PlaylistItem[];
  width: number;
  isPlaying: boolean;
  isProcessing: boolean;
  jobStatus: string | null;
  autoPlay: boolean;
  onResizeStart: (clientX: number) => void;
  onTriggerAi: () => void;
  onToggleAutoPlay: () => void;
  onSelectItem: (item: PlaylistItem) => void;
}

export function VideoPlaylistPanel({
  currentVideo,
  playlist,
  width,
  isPlaying,
  isProcessing,
  jobStatus,
  autoPlay,
  onResizeStart,
  onTriggerAi,
  onToggleAutoPlay,
  onSelectItem,
}: VideoPlaylistPanelProps) {
  return (
    <div className="relative space-y-3 lg:shrink-0" style={{ width: `${width}px` }}>
      <div
        className="group hidden lg:flex absolute -left-4 top-0 bottom-0 w-4 cursor-col-resize items-center justify-center"
        onMouseDown={(e) => {
          e.preventDefault();
          onResizeStart(e.clientX);
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
        }}
        title="拖动调整文件夹视频宽度"
      >
        <div className="h-full w-px bg-[#e5e2dd] group-hover:bg-[#c87d2f]" />
        <div className="absolute h-12 w-1 rounded-full bg-[#d1cdc6] opacity-70 group-hover:bg-[#c87d2f] group-hover:opacity-100" />
      </div>

      <div className="theme-surface rounded-xl border p-3">
        <div className="flex items-center gap-2">
          <p className="shrink-0 text-sm font-semibold text-[#1a1a1a]">学习操作</p>
          {jobStatus === 'completed' && (
            <span className="shrink-0 flex items-center gap-1 text-[10px] text-[#16a34a]">
              <CheckCircle2 size={12} />
              AI 已完成
            </span>
          )}
          <div className="ml-auto flex min-w-0 items-center gap-2">
            {!isProcessing ? (
              <button
                onClick={onTriggerAi}
                className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[#c87d2f] px-3 py-2 text-xs font-medium text-white hover:bg-[#b06d20]"
              >
                {jobStatus === 'completed' ? <RotateCcw size={13} /> : <Sparkles size={13} />}
                {jobStatus === 'completed' ? '重新生成' : '生成字幕与总结'}
              </button>
            ) : (
              <div className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[#fef7ed] px-3 py-2 text-xs font-medium text-[#c87d2f]">
                <Loader2 size={13} className="animate-spin" />
                处理中
              </div>
            )}
            <button
              onClick={onToggleAutoPlay}
              className={`flex shrink-0 items-center justify-center rounded-lg px-3 py-2 text-xs font-medium transition-colors ${autoPlay ? 'bg-[#16a34a] text-white' : 'bg-[#f3f2ef] text-[#6b7280] hover:bg-[#e5e2dd]'}`}
              title="播放结束后自动播放下一个视频"
            >
              自动连播{autoPlay ? '开' : '关'}
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <List size={14} className="text-[#6b7280]" />
        <span className="text-xs font-medium text-[#1a1a1a]">文件夹视频</span>
        <span className="text-[10px] text-[#9ca3af]">{playlist.length}个</span>
      </div>

      <div className="h-[60vh] overflow-y-auto space-y-1 pr-1">
        {playlist.map((item) => (
          <div
            key={item.id}
            onClick={() => onSelectItem(item)}
            className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${
              item.id === currentVideo.id ? 'bg-[#fef7ed] border border-[#fde68a]' : 'hover:bg-[#f3f2ef]'
            }`}
          >
            <div className="w-20 h-12 bg-[#e5e2dd] rounded overflow-hidden shrink-0 relative">
              {item.thumbnail ? (
                <img src={getThumbnailUrl(item.id)} alt="" className="w-full h-full object-cover" loading="lazy" />
              ) : (
                <PlayCircle size={16} className="absolute inset-0 m-auto text-[#b8b4ac]" />
              )}
              {item.id === currentVideo.id && isPlaying && (
                <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                  <div className="flex gap-0.5">
                    <div className="w-0.5 h-3 bg-white rounded animate-pulse" />
                    <div className="w-0.5 h-4 bg-white rounded animate-pulse" style={{ animationDelay: '0.15s' }} />
                    <div className="w-0.5 h-2 bg-white rounded animate-pulse" style={{ animationDelay: '0.3s' }} />
                  </div>
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className={`text-xs truncate ${item.id === currentVideo.id ? 'text-[#c87d2f] font-medium' : 'text-[#1a1a1a]'}`}>
                {item.title}
              </p>
              {item.completed && <span className="text-[9px] text-[#16a34a]">已看完</span>}
              {item.watch_progress != null && !item.completed && (
                <div className="mt-1 h-0.5 bg-[#e5e2dd] rounded-full overflow-hidden">
                  <div className="h-full bg-[#c87d2f] rounded-full" style={{ width: `${Math.min(100, (item.watch_progress / (item.watch_progress + 60)) * 100)}%` }} />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
