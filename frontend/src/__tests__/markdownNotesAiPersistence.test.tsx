import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MarkdownNotesPage } from '../components/mdnotes/MarkdownNotesPage';
import { useMdNotesStore } from '../stores/mdNotesStore';
import { useNoteAiStore } from '../stores/noteAiStore';
import { runNoteAi } from '../lib/noteAiApi';
import type { NoteAiResponse } from '../lib/noteAiApi';
import type { MdNote } from '../stores/mdNotesStore';

vi.mock('../hooks/useServerNotesAutoSync', () => ({
  useServerNotesAutoSync: vi.fn(),
}));

vi.mock('../lib/noteAiApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/noteAiApi')>();
  return {
    ...actual,
    runNoteAi: vi.fn(),
  };
});

const mockedRunNoteAi = vi.mocked(runNoteAi);

const NOTE: MdNote = {
  id: 'note-ai-persist',
  title: 'AI 状态持久化',
  markdown: '# 正文\n\n这是一段用于测试的笔记内容。',
  folderId: null,
  tags: [],
  starred: false,
  font: 'sans',
  fontSize: 15,
  createdAt: '2026-11-20T09:00:00.000Z',
  updatedAt: '2026-11-20T09:00:00.000Z',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const OTHER_NOTE: MdNote = {
  ...NOTE,
  id: 'note-ai-other',
  title: '另一篇笔记',
  markdown: '# 另一篇\n\n不该看到上一篇的 AI 结果。',
};

describe('MarkdownNotesPage AI 状态恢复', () => {
  beforeEach(() => {
    useMdNotesStore.setState({ notes: [NOTE, OTHER_NOTE], activeNoteId: NOTE.id, folders: [] });
    useNoteAiStore.setState({ sessions: {} });
    mockedRunNoteAi.mockReset();
  });

  it('页面卸载再回来时，润色请求和结果仍然保留在对应笔记', async () => {
    const pending = deferred<NoteAiResponse>();
    mockedRunNoteAi.mockReturnValueOnce(pending.promise);

    const first = render(<MarkdownNotesPage />);
    fireEvent.click(screen.getByTitle('打开笔记 AI 助手'));
    fireEvent.click(screen.getByRole('button', { name: '润色' }));

    expect(screen.getByText('正在重写正文…')).toBeTruthy();
    expect(useNoteAiStore.getState().sessions[NOTE.id]?.loading).toBe('polish');

    first.unmount();
    render(<MarkdownNotesPage />);

    expect(screen.getByText('正在重写正文…')).toBeTruthy();
    expect(useNoteAiStore.getState().sessions[NOTE.id]?.open).toBe(true);

    pending.resolve({ action: 'polish', result: { markdown: '润色后的正文' } });

    await waitFor(() => {
      expect(screen.getByText('润色预览')).toBeTruthy();
    });
    expect(screen.getByText('润色后的正文')).toBeTruthy();
    expect(useNoteAiStore.getState().sessions[NOTE.id]?.loading).toBeNull();
  });

  it('切到另一篇笔记再切回来，上一篇的 AI 面板和润色结果仍在', async () => {
    mockedRunNoteAi.mockResolvedValueOnce({ action: 'polish', result: { markdown: '润色后的正文' } });

    render(<MarkdownNotesPage />);
    fireEvent.click(screen.getByTitle('打开笔记 AI 助手'));
    fireEvent.click(screen.getByRole('button', { name: '润色' }));

    await waitFor(() => {
      expect(screen.getByText('润色预览')).toBeTruthy();
    });

    act(() => {
      useMdNotesStore.getState().setActiveNote(OTHER_NOTE.id);
    });

    await waitFor(() => {
      expect(screen.queryByText('润色预览')).toBeNull();
    });

    act(() => {
      useMdNotesStore.getState().setActiveNote(NOTE.id);
    });

    await waitFor(() => {
      expect(screen.getByText('润色预览')).toBeTruthy();
    });
    expect(useNoteAiStore.getState().sessions[NOTE.id]?.open).toBe(true);
  });
});
