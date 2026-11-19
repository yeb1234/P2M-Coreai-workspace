import { useEffect, useMemo, useState } from 'react';
import { getAssistantPageContext } from '../lib/assistantPageContext';
import { useInterviewContextStore, useNotesStore, useUIStore, useVideoStore } from '../stores';

export function useAssistantPageContext(active: boolean) {
  const activeView = useUIStore((state) => state.activeView);
  const activeNoteId = useUIStore((state) => state.activeNoteId);
  const currentVideo = useVideoStore((state) => state.currentVideo);
  const notes = useNotesStore((state) => state.notes);
  const interviewTab = useInterviewContextStore((state) => state.tab);
  const activeInterviewQuestion = useInterviewContextStore((state) => state.activeQuestion);
  const [pageContext, setPageContext] = useState(() => getAssistantPageContext());

  const notesFingerprint = useMemo(() => {
    if (activeView !== 'notes') return '';
    return notes.map((note) => `${note.id}:${note.updatedAt}`).join('|');
  }, [activeView, notes]);

  useEffect(() => {
    if (!active) return;
    const id = setTimeout(() => setPageContext(getAssistantPageContext()), 0);
    return () => clearTimeout(id);
  }, [
    active,
    activeView,
    activeNoteId,
    currentVideo?.id,
    currentVideo?.summary,
    currentVideo?.transcription,
    currentVideo?.transcript_segments,
    notesFingerprint,
    interviewTab,
    activeInterviewQuestion?.id,
    activeInterviewQuestion?.title,
  ]);

  return [pageContext, setPageContext] as const;
}
