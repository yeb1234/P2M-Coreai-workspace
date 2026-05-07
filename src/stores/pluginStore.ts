import { create } from 'zustand';
import { persist } from 'zustand/middleware';
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
  togglePlugin: (id: string) => void;
  getPluginLayout: (id: string) => PluginLayoutItem | undefined;
  swapPlugins: (idA: string, idB: string) => void;
}

const DEFAULT_LAYOUT: PluginLayoutItem[] = [
  { id: 'todo', enabled: true, position: 0, size: 'small' },
  { id: 'calendar', enabled: true, position: 1, size: 'small' },
  { id: 'pomodoro', enabled: true, position: 2, size: 'small' },
];

// Migrate old sizes: 'medium' -> 'small', 'full' -> 'large'
function migrateLayout(layout: PluginLayoutItem[]): PluginLayoutItem[] {
  return layout.map((item) => {
    const s = item.size as string;
    const validSize: PluginSize = s === 'large' || s === 'full' ? 'large' : 'small';
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
          layout: state.layout.map((item) =>
            item.id === id ? { ...item, size } : item
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
      version: 2,
      migrate: (persistedState: unknown, version: number) => {
        if (version < 2) {
          const state = persistedState as { layout?: PluginLayoutItem[] };
          if (state.layout) {
            state.layout = migrateLayout(state.layout);
          }
        }
        return persistedState as PluginState;
      },
    }
  )
);
