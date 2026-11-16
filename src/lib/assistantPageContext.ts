import { useNotesStore, useUIStore, useVideoStore } from '../stores';
import type { VideoItem } from './videoApi';

const MAX_CONTEXT_CHARS = 9000;
const MAX_TRANSCRIPT_CHARS = 6000;
const MAX_NOTE_CHARS = 5000;

export interface AssistantPageContext {
  kind: 'video' | 'notes' | 'none';
  label: string;
  promptContext: string;
}

function truncateText(value: string | null | undefined, max: number): string {
  const text = (value || '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n...[已截断 ${text.length - max} 字]`;
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function buildTranscript(video: VideoItem): string {
  const segments = video.transcript_segments || [];
  if (segments.length > 0) {
    return truncateText(
      segments
        .map((segment) => `[${formatTime(segment.start)}-${formatTime(segment.end)}] ${segment.text}`)
        .join('\n'),
      MAX_TRANSCRIPT_CHARS
    );
  }
  return truncateText(video.transcription, MAX_TRANSCRIPT_CHARS);
}

function buildVideoContext(video: VideoItem | null): AssistantPageContext {
  if (!video) {
    return { kind: 'none', label: '未探测到当前视频', promptContext: '' };
  }

  const summary = truncateText(video.summary, 2200);
  const transcript = buildTranscript(video);
  const parts = [
    `当前页面：视频`,
    `标题：${video.title}`,
    video.category_path ? `文件夹：${video.category_path}` : '',
    video.duration ? `时长：${formatTime(video.duration)}` : '',
    summary ? `\n[AI 总结]\n${summary}` : '',
    transcript ? `\n[字幕/转写]\n${transcript}` : '',
  ].filter(Boolean);

  return {
    kind: 'video',
    label: summary || transcript ? `已探测当前视频：${video.title}` : `当前视频暂无总结/字幕：${video.title}`,
    promptContext: truncateText(parts.join('\n'), MAX_CONTEXT_CHARS),
  };
}

function buildNotesContext(): AssistantPageContext {
  const notesState = useNotesStore.getState();
  const activeId = useUIStore.getState().activeNoteId;
  const activeNote = activeId ? notesState.notes.find((note) => note.id === activeId) : null;

  if (activeNote) {
    const body = [
      `当前页面：笔记`,
      `当前笔记标题：${activeNote.title}`,
      activeNote.tag ? `标签：${activeNote.tag}` : '',
      `更新时间：${new Date(activeNote.updatedAt).toLocaleString('zh-CN')}`,
      `\n[笔记正文]\n${truncateText(activeNote.content, MAX_NOTE_CHARS) || '空笔记'}`,
    ].filter(Boolean).join('\n');
    return {
      kind: 'notes',
      label: `已探测当前笔记：${activeNote.title}`,
      promptContext: truncateText(body, MAX_CONTEXT_CHARS),
    };
  }

  const recentNotes = [...notesState.notes]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5);
  if (recentNotes.length === 0) {
    return { kind: 'notes', label: '笔记页暂无笔记', promptContext: '当前页面：笔记\n暂无笔记内容。' };
  }

  const body = [
    '当前页面：笔记',
    '[最近更新的笔记摘要]',
    ...recentNotes.map((note, index) => {
      const content = truncateText(note.content, 700) || '空笔记';
      return `${index + 1}. ${note.title}${note.tag ? ` #${note.tag}` : ''}\n${content}`;
    }),
  ].join('\n\n');

  return {
    kind: 'notes',
    label: `已探测笔记页：${recentNotes.length} 条最近笔记`,
    promptContext: truncateText(body, MAX_CONTEXT_CHARS),
  };
}

export function getAssistantPageContext(): AssistantPageContext {
  const activeView = useUIStore.getState().activeView;
  if (activeView === 'video') return buildVideoContext(useVideoStore.getState().currentVideo);
  if (activeView === 'notes') return buildNotesContext();
  return { kind: 'none', label: '当前页面无专属上下文', promptContext: '' };
}

