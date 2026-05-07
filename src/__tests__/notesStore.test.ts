import { describe, it, expect, beforeEach } from 'vitest';
import { useNotesStore } from '../stores/notesStore';

describe('notesStore', () => {
  beforeEach(() => {
    useNotesStore.setState({ notes: [] });
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
});
