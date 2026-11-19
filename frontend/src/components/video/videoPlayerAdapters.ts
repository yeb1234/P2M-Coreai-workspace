import type { PlaylistItem, TranscriptSegment, VideoItem } from '../../lib/videoApi';

export function playlistItemToVideoItem(item: PlaylistItem): VideoItem {
  return {
    ...item,
    filename: item.title,
    filepath: '',
    file_size: 0,
    duration: null,
    tags: null,
    category_id: null,
    transcription: null,
    transcript_segments: [],
    summary: null,
    markdown_path: null,
    subtitle_path: null,
    ai_status: 'idle',
    ai_stage: null,
    ai_error: null,
    active_job_id: null,
    created_at: '',
    updated_at: '',
  };
}

export function normalizeSegment(segment: TranscriptSegment): TranscriptSegment | null {
  const rawStart = Number(segment.start);
  const rawEnd = Number(segment.end);
  const text = String(segment.text || '').trim();
  if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || !text) return null;
  const start = rawStart > 1000 ? rawStart / 1000 : rawStart;
  const end = rawEnd > 1000 ? rawEnd / 1000 : rawEnd;
  if (end <= start) return null;
  return { start, end, text };
}
