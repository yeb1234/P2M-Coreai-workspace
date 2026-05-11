import { useEffect } from 'react';
import { useVideoStore } from '../../stores/videoStore';

const PENDING_RECOMMENDED_VIDEO_KEY = 'p2m_pending_recommended_video_id';

export function useVideoSelection() {
  const currentVideo = useVideoStore((s) => s.currentVideo);
  const restoreCurrentVideo = useVideoStore((s) => s.restoreCurrentVideo);
  const loadCurrentVideo = useVideoStore((s) => s.loadCurrentVideo);

  useEffect(() => {
    restoreCurrentVideo();
  }, [restoreCurrentVideo]);

  useEffect(() => {
    const savedId = Number(localStorage.getItem(PENDING_RECOMMENDED_VIDEO_KEY));
    if (!savedId) return;
    localStorage.removeItem(PENDING_RECOMMENDED_VIDEO_KEY);
    void loadCurrentVideo(savedId);
  }, [loadCurrentVideo]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.videoId) {
        localStorage.removeItem(PENDING_RECOMMENDED_VIDEO_KEY);
        void loadCurrentVideo(detail.videoId);
      }
    };
    window.addEventListener('p2m:play-video', handler);
    return () => window.removeEventListener('p2m:play-video', handler);
  }, [loadCurrentVideo]);

  return { currentVideo };
}
