import { useEffect, useState } from 'react';
import { useUIStore, useTodoStore, usePomodoroStore, usePluginStore, useNotesStore, useNotificationStore, useTimeCenterStore, useTranscriptionStore } from '../stores';

const ALL_STORES = [
  useUIStore,
  useTodoStore,
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
      const id = setTimeout(() => setReady(true), 0);
      return () => clearTimeout(id);
    }

    let cancelled = false;
    const loadingId = setTimeout(() => setReady(false), 0);

    // Force all stores to rehydrate with the user-prefixed keys
    void Promise.allSettled(
      ALL_STORES.map((store) => Promise.resolve(store.persist.rehydrate())),
    ).then(() => {
      if (!cancelled) setReady(true);
    });

    return () => {
      cancelled = true;
      clearTimeout(loadingId);
    };
  }, [currentUser]);

  return ready;
}
