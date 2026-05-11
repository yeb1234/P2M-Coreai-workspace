import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { TranscriptSegment } from '../../lib/videoApi';

interface UseVideoSubtitlesInput {
  videoRef: RefObject<HTMLVideoElement | null>;
  subtitleUrl: string | null;
  normalizedSegments: TranscriptSegment[];
  showSubtitles: boolean;
  setShowSubtitles: Dispatch<SetStateAction<boolean>>;
  subtitleOpacity: number;
  subtitleSize: number;
}

function hideTextTracks(video: HTMLVideoElement | null) {
  if (!video) return;
  for (let i = 0; i < video.textTracks.length; i++) {
    video.textTracks[i].mode = 'hidden';
  }
}

export function useVideoSubtitles({
  videoRef,
  subtitleUrl,
  normalizedSegments,
  showSubtitles,
  setShowSubtitles,
  subtitleOpacity,
  subtitleSize,
}: UseVideoSubtitlesInput) {
  const [activeSegIdx, setActiveSegIdx] = useState(-1);
  const subtitleListRef = useRef<HTMLDivElement>(null);
  const activeSubtitleText = activeSegIdx >= 0 ? normalizedSegments[activeSegIdx]?.text || '' : '';

  const resetActiveSubtitle = useCallback(() => {
    setActiveSegIdx(-1);
  }, []);

  const toggleSubtitles = useCallback(() => {
    setShowSubtitles((nextShowSubtitles) => !nextShowSubtitles);
    hideTextTracks(videoRef.current);
  }, [setShowSubtitles, videoRef]);

  const updateActiveSubtitle = useCallback((currentTime: number) => {
    const idx = normalizedSegments.findIndex((segment) => currentTime >= segment.start && currentTime < segment.end);
    setActiveSegIdx((prevIdx) => {
      if (idx === prevIdx) return prevIdx;
      if (idx >= 0 && subtitleListRef.current) {
        const el = subtitleListRef.current.querySelector(`[data-seg="${idx}"]`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return idx;
    });
  }, [normalizedSegments]);

  useEffect(() => {
    if (!subtitleUrl) return;
    hideTextTracks(videoRef.current);
  }, [showSubtitles, subtitleUrl, videoRef]);

  useEffect(() => {
    let el = document.getElementById('subtitle-cue-style') as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = 'subtitle-cue-style';
      document.head.appendChild(el);
    }
    el.textContent = `video::cue { opacity: ${subtitleOpacity}; font-size: ${subtitleSize}%; }`;
  }, [subtitleOpacity, subtitleSize]);

  return {
    activeSegIdx,
    activeSubtitleText,
    resetActiveSubtitle,
    subtitleListRef,
    toggleSubtitles,
    updateActiveSubtitle,
    hideCurrentTextTracks: () => hideTextTracks(videoRef.current),
  };
}
