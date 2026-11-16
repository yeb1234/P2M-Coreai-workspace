/**
 * 跨页面跳转到视频的指定时间点。
 *
 * 为什么用 localStorage + CustomEvent 而不是路由参数：
 * 视频页是 keep-alive 的（切走不卸载），路由变化不会重新挂载。
 * 写入「待跳转」标记 + 发事件，让已经在内存里的播放器自己响应，
 * 比强制重挂载快得多，也不会丢播放状态。
 *
 * 之前这段逻辑只写在 AIChatPanel 里（聊天引用卡片用），
 * 视频库的片段搜索也要用 —— 提到这里共用，避免两份实现漂移。
 */

export const PENDING_RECOMMENDED_VIDEO_KEY = 'p2m_pending_recommended_video_id';
export const PENDING_SEEK_KEY = 'p2m_pending_seek_sec';

export function openVideoAt(videoId: number, startSec?: number): void {
  try {
    localStorage.setItem(PENDING_RECOMMENDED_VIDEO_KEY, String(videoId));
    if (typeof startSec === 'number' && startSec > 0) {
      localStorage.setItem(PENDING_SEEK_KEY, String(startSec));
    }
  } catch {
    // 隐私模式下 localStorage 可能抛，跳转本身不该因此失败
  }
  window.location.hash = '/video';
  window.dispatchEvent(new CustomEvent('p2m:play-video', { detail: { videoId, startSec } }));
}
