import { useMdNotesStore, useNotesStore, useScheduleStore, useUIStore, useVideoStore } from '../stores';
import { useCalendarStore } from '../stores/calendarStore';
import { useInterviewContextStore } from '../stores/interviewContextStore';
import type { VideoItem } from './videoApi';

const MAX_CONTEXT_CHARS = 9000;
const MAX_TRANSCRIPT_CHARS = 6000;
const MAX_NOTE_CHARS = 5000;
const MAX_MD_NOTE_CHARS = 60000;

const INTERVIEW_TAB_LABELS: Record<string, string> = {
  all: '题库',
  project: '项目题库',
  mock: '模拟面试',
  books: '原书',
  knowledge: '知识库',
};

const INTERVIEW_TYPE_LABELS: Record<string, string> = {
  concept: '概念题',
  code: '代码题',
  handwrite: '手写题',
  debug: '改错题',
  scenario: '场景题',
  compare: '对比题',
  troubleshoot: '排障题',
  system: '系统设计题',
  project: '项目深挖题',
  behavioral: '行为面试题',
};

export interface AssistantPageNote {
  title: string;
  markdown: string;
  surface: 'sticky' | 'md';
}

export interface AssistantPageContext {
  kind: 'video' | 'notes' | 'interview' | 'schedule' | 'none';
  label: string;
  promptContext: string;
  /** 当前笔记的完整正文，供聊天工具保存；不在提示词里展开。 */
  notePayload?: AssistantPageNote;
  /** AI 保存笔记后应该写回哪个页面：便签墙 / Markdown 笔记。 */
  noteTarget?: 'sticky' | 'md';
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
      `当前页面：便签`,
      `当前便签标题：${activeNote.title}`,
      activeNote.tag ? `标签：${activeNote.tag}` : '',
      `更新时间：${new Date(activeNote.updatedAt).toLocaleString('zh-CN')}`,
      `\n[便签正文]\n${truncateText(activeNote.content, MAX_NOTE_CHARS) || '空便签'}`,
    ].filter(Boolean).join('\n');
    return {
      kind: 'notes',
      label: `已探测当前便签：${activeNote.title}`,
      promptContext: truncateText(body, MAX_CONTEXT_CHARS),
      noteTarget: 'sticky',
      // 便签页也要把完整正文交给保存工具；否则模型只看到 9000 字提示词，
      // 保存时正文会缺失或截断。
      notePayload: {
        title: activeNote.title.slice(0, 240),
        markdown: activeNote.content.slice(0, MAX_MD_NOTE_CHARS),
        surface: 'sticky',
      },
    };
  }

  const recentNotes = [...notesState.notes]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5);
  if (recentNotes.length === 0) {
    return {
      kind: 'notes',
      label: '便签页暂无便签',
      promptContext: '当前页面：便签\n暂无便签内容。',
      noteTarget: 'sticky',
      // 没有打开的便签时也要把页面归属带给保存工具，否则会按默认落进笔记页。
      notePayload: { title: '', markdown: '', surface: 'sticky' },
    };
  }

  const body = [
    '当前页面：便签',
    '[最近更新的便签摘要]',
    ...recentNotes.map((note, index) => {
      const content = truncateText(note.content, 700) || '空便签';
      return `${index + 1}. ${note.title}${note.tag ? ` #${note.tag}` : ''}\n${content}`;
    }),
  ].join('\n\n');

  return {
    kind: 'notes',
    label: `已探测便签页：${recentNotes.length} 条最近便签`,
    promptContext: truncateText(body, MAX_CONTEXT_CHARS),
    noteTarget: 'sticky',
  };
}

function buildMdNotesContext(): AssistantPageContext {
  const state = useMdNotesStore.getState();
  const active = state.notes.find(
    (note) => note.id === state.activeNoteId && !note.trashedAt
  );
  if (!active) {
    return {
      kind: 'notes',
      label: '笔记页：当前没有打开的笔记',
      promptContext: '当前页面：笔记\n当前没有打开的笔记。',
      noteTarget: 'md',
      notePayload: { title: '', markdown: '', surface: 'md' },
    };
  }

  const body = [
    '当前页面：笔记',
    `当前笔记标题：${active.title}`,
    active.tags.length ? `标签：${active.tags.join(', ')}` : '',
    '保存这篇笔记时，完整正文会随请求一并交给聊天工具；这里只展示开头。',
    `\n[笔记正文开头]\n${truncateText(active.markdown, MAX_NOTE_CHARS) || '空笔记'}`,
  ].filter(Boolean).join('\n');

  return {
    kind: 'notes',
    label: `已探测当前笔记：${active.title}`,
    promptContext: truncateText(body, MAX_CONTEXT_CHARS),
    notePayload: {
      title: active.title.slice(0, 240),
      markdown: active.markdown.slice(0, MAX_MD_NOTE_CHARS),
      surface: 'md',
    },
    noteTarget: 'md',
  };
}

function buildInterviewContext(): AssistantPageContext {
  const { tab, activeQuestion } = useInterviewContextStore.getState();
  const tabLabel = INTERVIEW_TAB_LABELS[tab] || tab;

  if (!activeQuestion) {
    return {
      kind: 'interview',
      label: `已探测面试题库页：${tabLabel}`,
      promptContext: [
        '当前页面：面试题库',
        `当前标签：${tabLabel}`,
        '当前没有打开具体题目。',
        '可用能力：检索整套题库、检索面试知识库、按用户要求推荐站内视频。',
        '用户如果问「这题」，先请他在题库里点开一道题，或让他在问题里带题号/标题。',
      ].join('\n'),
    };
  }

  const typeLabel = INTERVIEW_TYPE_LABELS[activeQuestion.type] || activeQuestion.type;
  const body = [
    '当前页面：面试题库',
    `当前标签：${tabLabel}`,
    `当前题目：${activeQuestion.id} · ${activeQuestion.title}`,
    `题型：${typeLabel}｜难度：${activeQuestion.difficulty}`,
    `分组：${activeQuestion.groupLabel}${activeQuestion.resumeGroupLabel ? `｜简历组：${activeQuestion.resumeGroupLabel}` : ''}`,
    activeQuestion.chapter ? `章节：${activeQuestion.chapter}` : '',
    activeQuestion.bookId && activeQuestion.bookPage
      ? `原书定位：书${activeQuestion.bookId} p.${activeQuestion.bookPage}`
      : '',
    `\n[题干]\n${truncateText(activeQuestion.question, 1200)}`,
    activeQuestion.rubric.length
      ? `\n[评分点]\n${activeQuestion.rubric.map((item) => `- ${item}`).join('\n')}`
      : '',
    activeQuestion.followUps.length
      ? `\n[常见追问]\n${activeQuestion.followUps.map((item) => `- ${item}`).join('\n')}`
      : '',
    `\n[参考答案开头]\n${truncateText(activeQuestion.answer, 1800)}`,
    activeQuestion.tags.length ? `\n标签：${activeQuestion.tags.join(' / ')}` : '',
    '\n当前标签对应功能：',
    tab === 'mock'
      ? '- 模拟面试：按评分点给分、指出缺口、模拟面试官追问。'
      : tab === 'knowledge'
        ? '- 知识库：优先检索专题文章，再回到题目。'
        : tab === 'books'
          ? '- 原书：按书页和章节定位，不虚构原文。'
          : '- 题库/项目题：讲题、追问、找同类题、按评分点检查答案。',
    '- 用户明确要视频/课程时：检索站内视频，给《标题》和时间点；没有就如实说。',
  ].filter(Boolean).join('\n');

  return {
    kind: 'interview',
    label: `已探测当前题目：${activeQuestion.id} · ${activeQuestion.title}`,
    promptContext: truncateText(body, MAX_CONTEXT_CHARS),
  };
}

function buildScheduleContext(view: 'todo' | 'calendar' | 'calendar2'): AssistantPageContext {
  const label = view === 'todo' ? '待办事项' : view === 'calendar' ? '日历看板' : '周历';
  const selectedDate = useCalendarStore.getState().selectedDate;
  const items = Object.values(useScheduleStore.getState().items);
  const pendingTodos = items.filter((item) => item.type === 'todo' && !item.deletedAt && item.status !== 'completed');
  const events = items.filter((item) => item.type === 'event' && !item.deletedAt);
  const lines = [
    `当前页面：${label}`,
    selectedDate ? `当前选中日期：${selectedDate}` : '',
    `当前未完成待办：${pendingTodos.length} 条`,
    `当前日程：${events.length} 条`,
  ].filter(Boolean);
  return {
    kind: 'schedule',
    label: `已探测${label}页面`,
    promptContext: truncateText(lines.join('\n'), MAX_CONTEXT_CHARS),
  };
}

export function getAssistantPageContext(): AssistantPageContext {
  const activeView = useUIStore.getState().activeView;
  if (activeView === 'video') return buildVideoContext(useVideoStore.getState().currentVideo);
  if (activeView === 'mdnotes') return buildMdNotesContext();
  if (activeView === 'notes') return buildNotesContext();
  if (activeView === 'interview') return buildInterviewContext();
  if (activeView === 'todo' || activeView === 'calendar' || activeView === 'calendar2') {
    return buildScheduleContext(activeView);
  }
  return { kind: 'none', label: '当前页面无专属上下文', promptContext: '' };
}

