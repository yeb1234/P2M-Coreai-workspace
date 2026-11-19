import { useEffect, useRef, useState } from 'react';
import { API_BASE } from '../../lib/apiBase';
import { userScopedSessionStorage } from '../../lib/userScopedStorage';

/**
 * 播放行为埋点。
 *
 * 设计原则：对播放器零侵入 —— 自己挂原生事件，不修改 useVideoElementEvents。
 * 任何一次上报失败都必须静默，埋点不能影响播不播得动。
 *
 * delta_sec 的算法：心跳时取 currentTime 的增量，只在 (0, 30] 秒区间内计入。
 * 超出区间说明发生了拖动（seek），这一跳不算真实观看 —— 否则拖进度条就能
 * 把「学习时长」刷上天。
 */

const HEARTBEAT_MS = 15000;
const MAX_DELTA = 30;
const SESSION_KEY = 'p2m_watch_session';

type EventType = 'play' | 'pause' | 'seek' | 'rate' | 'heartbeat' | 'ended' | 'close';

interface PendingEvent {
  video_id: number;
  event_type: EventType;
  position_sec: number;
  duration_sec: number | null;
  playback_rate: number;
  delta_sec: number;
  session_id: string;
}

function newSessionId(): string {
  const id = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
  try {
    userScopedSessionStorage.setItem(SESSION_KEY, id);
  } catch {
    /* 隐私模式下 sessionStorage 可能不可用，退化为内存态 */
  }
  return id;
}

function currentSessionId(): string {
  try {
    return userScopedSessionStorage.getItem(SESSION_KEY) || newSessionId();
  } catch {
    return newSessionId();
  }
}

function postEvents(events: PendingEvent[], useBeacon: boolean): void {
  if (!events.length) return;
  const url = `${API_BASE}/api/watch-events`;
  const body = JSON.stringify({ events });

  // 页面卸载时普通 fetch 会被取消，必须用 sendBeacon
  if (useBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
    try {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon(url, blob)) return;
    } catch {
      /* 落到 fetch 兜底 */
    }
  }

  void fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {
    // 埋点失败不重试、不提示：不能因为统计问题影响播放体验
  });
}

/**
 * 用 state 跟踪真实的 video 元素。
 *
 * 不能直接依赖 videoRef.current：ref 不是响应式的，切换视频时 effect 可能
 * 在元素挂载前就执行，监听会挂到 null 上，而且之后不会重跑。
 */
function useVideoElement(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  videoId: number | null | undefined
): HTMLVideoElement | null {
  const [element, setElement] = useState<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!videoId) {
      setElement(null);
      return;
    }
    let cancelled = false;
    let raf = 0;
    let attempts = 0;

    const poll = () => {
      if (cancelled) return;
      const node = videoRef.current;
      if (node) {
        setElement(node);
        return;
      }
      // 元素还没挂上，最多等约 30 帧（0.5 秒）
      if (attempts++ < 30) raf = requestAnimationFrame(poll);
    };

    poll();
    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
    };
  }, [videoRef, videoId]);

  return element;
}

export function useWatchTelemetry(
  videoId: number | null | undefined,
  videoRef: React.RefObject<HTMLVideoElement | null>
): void {
  const pendingRef = useRef<PendingEvent[]>([]);
  const sessionRef = useRef<string>('');
  const lastPositionRef = useRef<number>(0);
  const lastRateRef = useRef<number>(1);
  const video = useVideoElement(videoRef, videoId);

  useEffect(() => {
    if (!videoId || !video) return;

    sessionRef.current = currentSessionId();
    lastPositionRef.current = video.currentTime || 0;
    lastRateRef.current = video.playbackRate || 1;

    const base = () => ({
      video_id: videoId,
      position_sec: Number.isFinite(video.currentTime) ? video.currentTime : 0,
      duration_sec: Number.isFinite(video.duration) ? video.duration : null,
      playback_rate: video.playbackRate || 1,
      session_id: sessionRef.current,
    });

    const flush = (useBeacon: boolean) => {
      if (!pendingRef.current.length) return;
      const batch = pendingRef.current;
      pendingRef.current = [];
      postEvents(batch, useBeacon);
    };

    const push = (event_type: EventType, delta_sec = 0) => {
      pendingRef.current.push({ ...base(), event_type, delta_sec });
      // 暂停状态下长时间不产生心跳，攒太多就提前发
      if (pendingRef.current.length >= 20) flush(false);
    };

    /** 计算上次心跳以来的真实播放增量 */
    const consumeDelta = (): number => {
      const now = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      const delta = now - lastPositionRef.current;
      lastPositionRef.current = now;
      if (delta <= 0 || delta > MAX_DELTA) return 0; // 后退或大幅跳转都不算观看
      return Number(delta.toFixed(2));
    };

    const handlePlay = () => {
      lastPositionRef.current = video.currentTime || 0;
      push('play');
    };
    const handlePause = () => {
      push('pause', consumeDelta());
      flush(false);
    };
    const handleSeeked = () => {
      // 拖动后重置基准，避免把跳过的部分算成观看时长
      lastPositionRef.current = video.currentTime || 0;
      push('seek');
    };
    const handleEnded = () => {
      push('ended', consumeDelta());
      flush(false);
    };
    const handleRate = () => {
      const rate = video.playbackRate || 1;
      if (Math.abs(rate - lastRateRef.current) < 0.01) return;
      lastRateRef.current = rate;
      push('rate');
    };

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('ratechange', handleRate);

    const timer = window.setInterval(() => {
      if (video.paused || video.ended) return;
      const delta = consumeDelta();
      if (delta > 0) push('heartbeat', delta);
      flush(false);
    }, HEARTBEAT_MS);

    const handleHide = () => {
      if (document.visibilityState === 'hidden') flush(true);
    };
    const handleUnload = () => flush(true);

    document.addEventListener('visibilitychange', handleHide);
    window.addEventListener('pagehide', handleUnload);

    return () => {
      window.clearInterval(timer);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('ratechange', handleRate);
      document.removeEventListener('visibilitychange', handleHide);
      window.removeEventListener('pagehide', handleUnload);
      // 切视频时把剩余事件发出去
      flush(true);
    };
  }, [videoId, video]);
}
