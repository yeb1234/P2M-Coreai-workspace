import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useServerNotesAutoSync } from '../hooks/useServerNotesAutoSync';
import { syncAllServerNotesIntoLocal } from '../lib/serverNotesSync';
import { useMdNotesStore } from '../stores/mdNotesStore';
import type { MdNote } from '../stores/mdNotesStore';

vi.mock('../lib/serverNotesSync', () => ({
  syncAllServerNotesIntoLocal: vi.fn(),
}));

const localNote: MdNote = {
  id: 'local-1',
  title: '正在编辑的笔记',
  markdown: '# 本地正文',
  folderId: null,
  tags: [],
  starred: false,
  font: 'sans',
  fontSize: 15,
  createdAt: '2026-11-20T10:00:00',
  updatedAt: '2026-11-20T10:00:00',
};

beforeEach(() => {
  vi.clearAllMocks();
  useMdNotesStore.setState({ notes: [], folders: [], activeNoteId: null });
});

describe('useServerNotesAutoSync', () => {
  it('打开笔记页时自动从服务端同步，不依赖手动按钮', async () => {
    const sync = vi.mocked(syncAllServerNotesIntoLocal).mockResolvedValue(1);

    renderHook(() => useServerNotesAutoSync('md'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith('md');
  });

  it('后台同步不会把用户正在看的笔记切走', async () => {
    useMdNotesStore.setState({ notes: [localNote], activeNoteId: localNote.id });
    vi.mocked(syncAllServerNotesIntoLocal).mockImplementation(async () => {
      useMdNotesStore.setState((state) => ({
        notes: [
          ...state.notes,
          {
            ...localNote,
            id: 'srv-9',
            title: '服务端新笔记',
          },
        ],
        activeNoteId: 'srv-9',
      }));
      return 1;
    });

    renderHook(() => useServerNotesAutoSync('md'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(useMdNotesStore.getState().notes.map((note) => note.id)).toContain('srv-9');
    expect(useMdNotesStore.getState().activeNoteId).toBe(localNote.id);
  });

  it('刚同步过时，窗口 focus 不重复打服务端', async () => {
    const sync = vi.mocked(syncAllServerNotesIntoLocal).mockResolvedValue(0);

    renderHook(() => useServerNotesAutoSync('md'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(sync).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(sync).toHaveBeenCalledTimes(1);
  });
});
