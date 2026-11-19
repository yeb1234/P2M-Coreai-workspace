import { useEffect } from 'react';
import { useVideoStore } from '../../stores/videoStore';
import { userScopedStorage } from '../../lib/userScopedStorage';

const PENDING_RECOMMENDED_VIDEO_KEY = 'p2m_pending_recommended_video_id';
const PENDING_SEEK_KEY = 'p2m_pending_seek_sec';

export function useVideoSelection() {
  const currentVideo = useVideoStore((s) => s.currentVideo);
  const restoreCurrentVideo = useVideoStore((s) => s.restoreCurrentVideo);
  const loadCurrentVideo = useVideoStore((s) => s.loadCurrentVideo);

  useEffect(() => {
    restoreCurrentVideo();
  }, [restoreCurrentVideo]);

  useEffect(() => {
    const savedId = Number(userScopedStorage.getItem(PENDING_RECOMMENDED_VIDEO_KEY));
    if (!savedId) return;
    userScopedStorage.removeItem(PENDING_RECOMMENDED_VIDEO_KEY);
    void loadCurrentVideo(savedId);
  }, [loadCurrentVideo]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.videoId) {
        userScopedStorage.removeItem(PENDING_RECOMMENDED_VIDEO_KEY);
        // 聊天引用里带时间点时，让播放器加载后直接跳到该位置
        if (typeof detail.startSec === 'number' && detail.startSec > 0) {
          userScopedStorage.setItem(PENDING_SEEK_KEY, String(detail.startSec));
        }
        void loadCurrentVideo(detail.videoId);
      }
    };
    window.addEventListener('p2m:play-video', handler);
    return () => window.removeEventListener('p2m:play-video', handler);
  }, [loadCurrentVideo]);

  return { currentVideo };
}
