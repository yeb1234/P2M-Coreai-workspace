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
      // 临时诊断：看 rehydrate 后 store 里到底有没有数据
      const dbg = (window as unknown as Record<string, unknown>).__p2mDebug as Record<string, unknown> | undefined;
      if (dbg) {
        dbg.todoCount = Object.keys((useTodoStore.getState() as { todos: Record<string, unknown> }).todos || {}).length;
        dbg.todoTitles = Object.values((useTodoStore.getState() as { todos: Record<string, { title: string }> }).todos || {}).map((t) => t.title);
        dbg.storeNames = ALL_STORES.map((s) => (s as unknown as { persist?: { getOptions?: () => { name?: string } } }).persist?.getOptions?.().name);
      }
      if (!cancelled) setReady(true);
    });

    return () => {
      cancelled = true;
      clearTimeout(loadingId);
    };
  }, [currentUser]);

  return ready;
}
