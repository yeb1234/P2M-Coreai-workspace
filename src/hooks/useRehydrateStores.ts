import { useEffect } from 'react';
import { useUIStore, useTodoStore, useCalendarStore, usePomodoroStore, usePluginStore, useNotesStore, useNotificationStore } from '../stores';

const ALL_STORES = [
  useUIStore,
  useTodoStore,
  useCalendarStore,
  usePomodoroStore,
  usePluginStore,
  useNotesStore,
  useNotificationStore,
];

export function useRehydrateStores(currentUser: string | null) {
  useEffect(() => {
    if (!currentUser) return;
    // Force all stores to rehydrate with the user-prefixed keys
    ALL_STORES.forEach((store) => {
      store.persist.rehydrate();
    });
  }, [currentUser]);
}
