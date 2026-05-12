import { useEffect, useState } from 'react';
import { useUIStore, useTodoStore, useCalendarStore, usePomodoroStore, usePluginStore, useNotesStore, useNotificationStore, useTimeCenterStore, useTranscriptionStore } from '../stores';

const ALL_STORES = [
  useUIStore,
  useTodoStore,
  useCalendarStore,
  usePomodoroStore,
  usePluginStore,
  useNotesStore,
  useNotificationStore,
  useTimeCenterStore,
  useTranscriptionStore,
];

export function useRehydrateStores(currentUser: string | null) {
  const [ready, setReady] = useState(() => !currentUser);

  useEffect(() => {
    if (!currentUser) {
      setReady(true);
      return;
    }

    let cancelled = false;
    setReady(false);

    // Force all stores to rehydrate with the user-prefixed keys
    void Promise.allSettled(
      ALL_STORES.map((store) => Promise.resolve(store.persist.rehydrate())),
    ).then(() => {
      if (!cancelled) setReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  return ready;
}
