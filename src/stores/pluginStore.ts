import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { idbStorage } from '../lib/idbStorage';
import type { PluginSize } from '../types/plugin';

interface PluginLayoutItem {
  id: string;
  enabled: boolean;
  position: number;
  size: PluginSize;
}

interface PluginState {
  layout: PluginLayoutItem[];
  setPluginPosition: (id: string, position: number) => void;
  setPluginSize: (id: string, size: PluginSize) => void;
  setAllPluginSize: (size: PluginSize) => void;
  togglePlugin: (id: string) => void;
  getPluginLayout: (id: string) => PluginLayoutItem | undefined;
  swapPlugins: (idA: string, idB: string) => void;
}

const DEFAULT_LAYOUT: PluginLayoutItem[] = [
  { id: 'todo', enabled: true, position: 0, size: 'small' },
  { id: 'calendar', enabled: true, position: 1, size: 'small' },
  { id: 'pomodoro', enabled: true, position: 2, size: 'small' },
  { id: 'quick-stats', enabled: true, position: 3, size: 'small' },
  { id: 'recent-notes', enabled: true, position: 4, size: 'small' },
];

/** Auto-upgrade: all large → full. Auto-downgrade: any non-full when some are full → all large. */
function normalizeSizes(layout: PluginLayoutItem[]): PluginLayoutItem[] {
  const enabled = layout.filter((item) => item.enabled);
  if (enabled.length === 0) return layout;

  const allFull = enabled.every((item) => item.size === 'full');
  const someFull = enabled.some((item) => item.size === 'full');
  const allLarge = enabled.every((item) => item.size === 'large');

  if (allLarge) return layout.map((item) => ({ ...item, size: 'full' as const }));
  if (someFull && !allFull) return layout.map((item) => ({ ...item, size: item.size === 'full' ? 'large' : item.size }));
  return layout;
}

// Migrate old sizes: 'medium' -> 'small', 'full' -> 'large'
function migrateLayout(layout: PluginLayoutItem[]): PluginLayoutItem[] {
  return layout.map((item) => {
    const s = item.size as string;
    const validSize: PluginSize = s === 'large' ? 'large' : s === 'full' ? 'full' : 'small';
    return { ...item, size: validSize };
  });
}

export const usePluginStore = create<PluginState>()(
  persist(
    (set, get) => ({
      layout: DEFAULT_LAYOUT,

      setPluginPosition: (id, position) => {
        set((state) => ({
          layout: state.layout.map((item) =>
            item.id === id ? { ...item, position } : item
          ),
        }));
      },

      setPluginSize: (id, size) => {
        set((state) => ({
          layout: normalizeSizes(
            state.layout.map((item) => (item.id === id ? { ...item, size } : item))
          ),
        }));
      },

      setAllPluginSize: (size) => {
        set((state) => ({
          layout: normalizeSizes(
            state.layout.map((item) => ({ ...item, size }))
          ),
        }));
      },

      togglePlugin: (id) => {
        set((state) => ({
          layout: state.layout.map((item) =>
            item.id === id ? { ...item, enabled: !item.enabled } : item
          ),
        }));
      },

      getPluginLayout: (id) => {
        return get().layout.find((item) => item.id === id);
      },

      swapPlugins: (idA, idB) => {
        set((state) => {
          const a = state.layout.find((item) => item.id === idA);
          const b = state.layout.find((item) => item.id === idB);
          if (!a || !b) return state;
          return {
            layout: state.layout.map((item) => {
              if (item.id === idA) return { ...item, position: b.position };
              if (item.id === idB) return { ...item, position: a.position };
              return item;
            }),
          };
        });
      },
    }),
    {
      name: 'p2m-plugin-storage',
      storage: createJSONStorage(() => idbStorage),
      version: 3,
      migrate: (persistedState: unknown, version: number) => {
        const state = persistedState as { layout?: PluginLayoutItem[] };
        if (version < 2 && state.layout) {
          state.layout = migrateLayout(state.layout);
        }
        if (version < 3 && state.layout) {
          const existingIds = new Set(state.layout.map((i) => i.id));
          const defaults = DEFAULT_LAYOUT.filter((d) => !existingIds.has(d.id));
          state.layout = [...state.layout, ...defaults];
        }
        return persistedState as PluginState;
      },
    }
  )
);
