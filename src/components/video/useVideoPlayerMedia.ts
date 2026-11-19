import { useMemo } from 'react';
import { getVideoStreamUrl, getSubtitleFileUrl, type TranscriptSegment } from '../../lib/videoApi';
import { normalizeSegment } from './videoPlayerAdapters';

export interface VideoPlayerMediaInput {
  currentVideo: {
    id: number;
    subtitle_url: string | null;
    subtitle_path: string | null;
    transcript_segments?: TranscriptSegment[] | null;
    summary: string | null;
    transcription: string | null;
  } | null;
  currentSegments: TranscriptSegment[];
}

export function useVideoPlayerMedia({ currentVideo, currentSegments }: VideoPlayerMediaInput) {
  const videoUrl = useMemo(
    () => (currentVideo ? getVideoStreamUrl(currentVideo.id) : ''),
    [currentVideo?.id]
  );
  const subtitleUrl = useMemo(
    () => (currentVideo && (currentVideo.subtitle_url || currentVideo.subtitle_path)
      ? getSubtitleFileUrl(currentVideo.id)
      : null),
    [currentVideo?.id, currentVideo?.subtitle_url, currentVideo?.subtitle_path]
  );
  const normalizedSegments = useMemo(
    () => currentSegments.map(normalizeSegment).filter((segment): segment is TranscriptSegment => !!segment),
    [currentSegments]
  );
  const hasEmbeddedSubtitle = normalizedSegments.length > 0;
  const hasSubtitle = !!subtitleUrl || hasEmbeddedSubtitle;
  const videoKey = useMemo(
    () => `${currentVideo?.id ?? 'none'}`,
    [currentVideo?.id]
  );
  const currentVideoId = currentVideo?.id ?? null;
  const hasVideoDetails = !!(
    currentVideo?.transcript_segments?.length ||
    currentVideo?.summary ||
    currentVideo?.transcription
  );

  return {
    videoUrl,
    subtitleUrl,
    normalizedSegments,
    hasEmbeddedSubtitle,
    hasSubtitle,
    videoKey,
    currentVideoId,
    hasVideoDetails,
  };
}
