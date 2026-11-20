import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, ApiError } from '../lib/videoApi';
import { syncServerNoteIntoLocal, syncAllServerNotesIntoLocal, removeServerNoteFromLocal } from '../lib/serverNotesSync';
import { useNotesStore } from '../stores/notesStore';
import { useMdNotesStore } from '../stores/mdNotesStore';
import { useUIStore } from '../stores/uiStore';
import { getAssistantPageContext } from '../lib/assistantPageContext';

vi.mock('../lib/videoApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/videoApi')>();
  return { ...actual, apiFetch: vi.fn() };
});

const dto = {
  id: 7,
  title: 'AI 会议纪要',
  content: '# 结论\n\n明天先跑通链路。',
  source: 'assistant',
  surface: 'md' as const,
  created_at: '2026-11-20T10:00:00',
  updated_at: '2026-11-20T10:00:00',
};

beforeEach(() => {
  vi.clearAllMocks();
  useNotesStore.setState({ notes: [], trash: {} });
  useMdNotesStore.setState({ notes: [], folders: [], activeNoteId: null });
});

describe('server note backfill', () => {
  it('adds an AI sticky note to the sticky wall with a stable id', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ ...dto, surface: 'sticky' });

    expect(await syncServerNoteIntoLocal(7, 'sticky')).toBe(true);
    const notes = useNotesStore.getState().notes;
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe('srv-7');
    expect(notes[0].title).toBe('AI 会议纪要');
    expect(notes[0].tag).toBe('AI');
  });

  it('routes a Markdown note to the note page even when the sticky page asked first', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(dto);

    expect(await syncServerNoteIntoLocal(7, 'sticky')).toBe(true);
    expect(useNotesStore.getState().notes).toHaveLength(0);
    expect(useMdNotesStore.getState().notes.map((note) => note.id)).toEqual(['srv-7']);
  });

  it('does not duplicate a current sticky that was just archived', () => {
    useNotesStore.setState({
      notes: [{
        id: 'local-1', title: 'AI 会议纪要', content: dto.content, color: 'sticky-yellow',
        pinned: false, tag: '', createdAt: dto.created_at, updatedAt: dto.created_at,
      }],
      trash: {},
    });

    expect(useNotesStore.getState().importServerNote(dto)).toBe('local-1');
    expect(useNotesStore.getState().notes).toHaveLength(1);
  });

  it('does not duplicate a current Markdown note that was just archived', () => {
    useMdNotesStore.setState({
      notes: [{
        id: 'local-md', title: 'AI 会议纪要', markdown: dto.content, folderId: null,
        tags: [], starred: false, font: 'sans', fontSize: 15,
        createdAt: dto.created_at, updatedAt: dto.updated_at,
      }],
      folders: [],
      activeNoteId: 'local-md',
    });

    expect(useMdNotesStore.getState().importServerNote(dto)).toBe('local-md');
    expect(useMdNotesStore.getState().notes).toHaveLength(1);
  });

  it('does not resurrect a server sticky that is sitting in the trash', () => {
    useNotesStore.setState({
      notes: [],
      trash: {
        'srv-7': {
          note: {
            id: 'srv-7', title: 'AI 会议纪要', content: dto.content, color: 'sticky-yellow',
            pinned: false, tag: 'AI', createdAt: dto.created_at, updatedAt: dto.created_at,
          },
          deletedAt: dto.updated_at,
        },
      },
    });

    expect(useNotesStore.getState().importServerNote(dto)).toBe('srv-7');
    expect(useNotesStore.getState().notes).toHaveLength(0);
  });

  it('removes an imported note on undo', () => {
    useNotesStore.getState().importServerNote(dto);
    useMdNotesStore.getState().importServerNote(dto);

    removeServerNoteFromLocal(7);
    expect(useNotesStore.getState().notes).toHaveLength(0);
    expect(useMdNotesStore.getState().notes).toHaveLength(0);
  });

  it('imports all private server notes on manual refresh', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce([
      { ...dto, id: 9, title: '第二篇', content: '第二篇正文' },
      { ...dto, id: 10, title: '第三篇', content: '第三篇正文' },
    ]);

    expect(await syncAllServerNotesIntoLocal('md')).toBe(2);
    expect(useMdNotesStore.getState().notes.map((note) => note.id).sort()).toEqual(['srv-10', 'srv-9']);
    expect(vi.mocked(apiFetch).mock.calls[0][0]).toContain('surface=md');
  });

  it('keeps sticky and Markdown lists separate', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url) => {
      if (String(url).includes('surface=sticky')) {
        return [{ ...dto, id: 21, title: '便签一', content: '短句', surface: 'sticky' }];
      }
      return [{ ...dto, id: 22, title: '长笔记', content: '# 正文' }];
    });

    expect(await syncAllServerNotesIntoLocal('sticky')).toBe(1);
    expect(await syncAllServerNotesIntoLocal('md')).toBe(1);
    expect(useNotesStore.getState().notes.map((note) => note.id)).toEqual(['srv-21']);
    expect(useMdNotesStore.getState().notes.map((note) => note.id)).toEqual(['srv-22']);
  });

  it('drops local server copies only after the server confirms 404', async () => {
    useMdNotesStore.getState().importServerNote({ ...dto, id: 11, title: '服务端已删', content: '已删正文' });
    expect(useMdNotesStore.getState().activeNoteId).toBe('srv-11');

    vi.mocked(apiFetch)
      .mockResolvedValueOnce([{ ...dto, id: 9, title: '仍在', content: '仍在正文' }])
      .mockRejectedValueOnce(new ApiError('Note not found', { status: 404 }));

    expect(await syncAllServerNotesIntoLocal('md')).toBe(1);
    expect(useMdNotesStore.getState().notes.map((note) => note.id)).toEqual(['srv-9']);
    expect(useMdNotesStore.getState().activeNoteId).toBe('srv-9');
  });

  it('keeps a local server copy when the list omits it but the note still exists', async () => {
    useMdNotesStore.getState().importServerNote({ ...dto, id: 11, title: '旧笔记', content: '旧正文' });
    vi.mocked(apiFetch)
      .mockResolvedValueOnce([{ ...dto, id: 9, title: '新笔记', content: '新正文' }])
      .mockResolvedValueOnce({ ...dto, id: 11, title: '旧笔记', content: '旧正文' });

    await syncAllServerNotesIntoLocal('md');
    expect(useMdNotesStore.getState().notes.map((note) => note.id).sort()).toEqual(['srv-11', 'srv-9']);
  });
});

describe('assistant page context note target', () => {
  it('passes the active sticky body and target to the chat request', () => {
    useNotesStore.setState({
      notes: [{
        id: 'sticky-1', title: '便签标题', content: '便签正文', color: 'sticky-yellow',
        pinned: false, tag: '', createdAt: dto.created_at, updatedAt: dto.updated_at,
      }],
      trash: {},
    });
    useUIStore.setState({ activeView: 'notes', activeNoteId: 'sticky-1' });

    const ctx = getAssistantPageContext();
    expect(ctx.noteTarget).toBe('sticky');
    expect(ctx.notePayload?.title).toBe('便签标题');
    expect(ctx.notePayload?.markdown).toBe('便签正文');
    expect(ctx.notePayload?.surface).toBe('sticky');
  });

  it('keeps sticky surface even when the wall has no active note', () => {
    useNotesStore.setState({ notes: [], trash: {} });
    useUIStore.setState({ activeView: 'notes', activeNoteId: null });

    const ctx = getAssistantPageContext();
    expect(ctx.noteTarget).toBe('sticky');
    expect(ctx.notePayload?.surface).toBe('sticky');
  });

  it('passes the active Markdown body and target to the chat request', () => {
    useMdNotesStore.setState({
      notes: [{
        id: 'md-1', title: '笔记标题', markdown: '# 笔记正文', folderId: null,
        tags: [], starred: false, font: 'sans', fontSize: 15,
        createdAt: dto.created_at, updatedAt: dto.updated_at,
      }],
      folders: [],
      activeNoteId: 'md-1',
    });
    useUIStore.setState({ activeView: 'mdnotes', activeNoteId: null });

    const ctx = getAssistantPageContext();
    expect(ctx.noteTarget).toBe('md');
    expect(ctx.notePayload?.markdown).toBe('# 笔记正文');
    expect(ctx.notePayload?.surface).toBe('md');
  });
});
