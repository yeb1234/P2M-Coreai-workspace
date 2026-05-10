import { describe, it, expect, beforeEach } from 'vitest';
import { extractNoteHashtags, getNoteTags, useNotesStore } from '../stores/notesStore';

describe('notesStore', () => {
  beforeEach(() => {
    useNotesStore.setState({ notes: [], trash: {} });
  });

  it('adds a note', () => {
    const id = useNotesStore.getState().addNote({ title: 'Test Note', content: 'Hello' });
    const note = useNotesStore.getState().notes.find((n) => n.id === id);
    expect(note).toBeDefined();
    expect(note!.title).toBe('Test Note');
    expect(note!.content).toBe('Hello');
  });

  it('updates a note', () => {
    const id = useNotesStore.getState().addNote({ title: 'Original' });
    useNotesStore.getState().updateNote(id, { title: 'Updated' });
    expect(useNotesStore.getState().notes[0].title).toBe('Updated');
  });

  it('deletes a note', () => {
    const id = useNotesStore.getState().addNote({ title: 'To delete' });
    expect(useNotesStore.getState().notes.length).toBe(1);
    useNotesStore.getState().deleteNote(id);
    expect(useNotesStore.getState().notes.length).toBe(0);
    expect(useNotesStore.getState().trash[id]).toBeDefined();
  });

  it('restores a note from trash', () => {
    const id = useNotesStore.getState().addNote({ title: 'Recover me' });
    useNotesStore.getState().deleteNote(id);
    useNotesStore.getState().restoreNote(id);
    expect(useNotesStore.getState().notes[0].id).toBe(id);
    expect(useNotesStore.getState().trash[id]).toBeUndefined();
  });

  it('toggles pin', () => {
    const id = useNotesStore.getState().addNote({ title: 'Pin me' });
    expect(useNotesStore.getState().notes[0].pinned).toBe(false);
    useNotesStore.getState().togglePin(id);
    expect(useNotesStore.getState().notes[0].pinned).toBe(true);
    useNotesStore.getState().togglePin(id);
    expect(useNotesStore.getState().notes[0].pinned).toBe(false);
  });

  it('sets default color to sticky-yellow', () => {
    useNotesStore.getState().addNote({ title: 'Default color' });
    expect(useNotesStore.getState().notes[0].color).toBe('sticky-yellow');
  });

  it('renames and removes tags', () => {
    const id = useNotesStore.getState().addNote({ title: 'Tagged', tag: '旧标签' });
    useNotesStore.getState().renameTag('旧标签', '新标签');
    expect(useNotesStore.getState().notes.find((n) => n.id === id)?.tag).toBe('新标签');
    useNotesStore.getState().deleteTag('新标签');
    expect(useNotesStore.getState().notes.find((n) => n.id === id)?.tag).toBe('');
  });

  it('creates or updates today AI note', () => {
    const first = useNotesStore.getState().upsertTodayAiNote();
    const second = useNotesStore.getState().upsertTodayAiNote();
    expect(second).toBe(first);
    expect(useNotesStore.getState().notes).toHaveLength(1);
    expect(useNotesStore.getState().notes[0].pinned).toBe(true);
    expect(useNotesStore.getState().notes[0].tag).toBe('AI日报');
  });

  it('extracts hashtags from title and content', () => {
    expect(extractNoteHashtags('学习 #Git 和 #架构，不匹配邮箱 a#b')).toEqual(['Git', '架构']);
  });

  it('combines manual tag and hashtags', () => {
    const id = useNotesStore.getState().addNote({
      title: '项目 #Git',
      content: '整理 #架构 #Git',
      tag: '#手动',
    });
    const note = useNotesStore.getState().notes.find((n) => n.id === id)!;
    expect(getNoteTags(note)).toEqual(['手动', 'Git', '架构']);
  });
});
