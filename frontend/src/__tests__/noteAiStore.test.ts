import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNoteAiStore } from '../stores/noteAiStore';
import { runNoteAi } from '../lib/noteAiApi';
import type { NoteAiResponse } from '../lib/noteAiApi';

vi.mock('../lib/noteAiApi', () => ({
  runNoteAi: vi.fn(),
}));

const mockedRunNoteAi = vi.mocked(runNoteAi);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('noteAiStore', () => {
  beforeEach(() => {
    useNoteAiStore.setState({ sessions: {} });
    mockedRunNoteAi.mockReset();
  });

  it('关闭面板后请求继续跑，结果仍按原笔记保存，重新打开能恢复', async () => {
    const pending = deferred<NoteAiResponse>();
    mockedRunNoteAi.mockReturnValueOnce(pending.promise);

    const run = useNoteAiStore.getState().runSession('note-a', 'polish', {
      title: 'A',
      markdown: 'original',
    });

    expect(useNoteAiStore.getState().sessions['note-a']).toMatchObject({
      open: true,
      view: 'polish',
      loading: 'polish',
    });

    useNoteAiStore.getState().closeSession('note-a');
    expect(useNoteAiStore.getState().sessions['note-a']?.open).toBe(false);
    expect(useNoteAiStore.getState().sessions['note-a']?.loading).toBe('polish');

    pending.resolve({ action: 'polish', result: { markdown: 'polished' } });
    await run;

    expect(useNoteAiStore.getState().sessions['note-a']).toMatchObject({
      open: false,
      loading: null,
      polished: 'polished',
    });

    useNoteAiStore.getState().openSession('note-a');
    expect(useNoteAiStore.getState().sessions['note-a']).toMatchObject({
      open: true,
      view: 'polish',
      polished: 'polished',
    });
  });

  it('不同笔记各自保存结果，慢请求不会写到后切换的笔记', async () => {
    const first = deferred<NoteAiResponse>();
    const second = deferred<NoteAiResponse>();
    mockedRunNoteAi
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const runFirst = useNoteAiStore.getState().runSession('note-1', 'summary', {
      title: '一',
      markdown: 'first note',
    });
    useNoteAiStore.getState().openSession('note-2');
    const runSecond = useNoteAiStore.getState().runSession('note-2', 'summary', {
      title: '二',
      markdown: 'second note',
    });

    first.resolve({ action: 'summary', result: { summary: '第一条摘要' } });
    await runFirst;

    expect(useNoteAiStore.getState().sessions['note-1']?.summary).toBe('第一条摘要');
    expect(useNoteAiStore.getState().sessions['note-2']?.summary).toBe('');
    expect(useNoteAiStore.getState().sessions['note-2']?.loading).toBe('summary');

    second.resolve({ action: 'summary', result: { summary: '第二条摘要' } });
    await runSecond;
    expect(useNoteAiStore.getState().sessions['note-2']?.summary).toBe('第二条摘要');
  });

  it('失败后保留错误并按笔记恢复', async () => {
    mockedRunNoteAi.mockRejectedValueOnce(new Error('模型超时'));

    await useNoteAiStore.getState().runSession('note-error', 'summary', {
      title: '错误',
      markdown: 'body',
    });

    expect(useNoteAiStore.getState().sessions['note-error']).toMatchObject({
      loading: null,
      error: '模型超时',
      open: true,
      view: 'summary',
    });
  });
});
