import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ActiveView = 'dashboard' | 'todo' | 'calendar' | 'notes' | 'pomodoro' | 'video' | 'stats' | 'reader' | 'snippets' | 'habits' | 'flashcards' | 'bookmarks' | 'health' | 'compare' | 'shop' | 'esports' | 'tokens' | 'leetcode' | 'interview' | 'codenav' | 'aiagent' | 'openclaw' | 'hermes' | 'settings';

const DEFAULT_NAV_ORDER: ActiveView[] = [
  'dashboard', 'todo', 'calendar', 'notes', 'pomodoro',
  'video', 'stats', 'reader', 'snippets', 'habits',
  'flashcards', 'bookmarks', 'health', 'compare', 'shop', 'esports', 'tokens',
  'leetcode', 'interview', 'codenav', 'aiagent', 'openclaw', 'hermes',
];

interface ModalState {
  type: string;
  data?: unknown;
}

interface UIState {
  activeView: ActiveView;
  sidebarOpen: boolean;
  modalState: ModalState | null;
  navOrder: ActiveView[];
  setActiveView: (view: ActiveView) => void;
  toggleSidebar: () => void;
  openModal: (type: string, data?: unknown) => void;
  closeModal: () => void;
  reorderNav: (fromId: ActiveView, toId: ActiveView) => void;
  resetNavOrder: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      activeView: 'dashboard',
      sidebarOpen: true,
      modalState: null,
      navOrder: DEFAULT_NAV_ORDER,
      setActiveView: (view) => set({ activeView: view }),
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      openModal: (type, data) => set({ modalState: { type, data } }),
      closeModal: () => set({ modalState: null }),
      reorderNav: (fromId, toId) => {
        set((state) => {
          const order = [...state.navOrder];
          const fromIdx = order.indexOf(fromId);
          const toIdx = order.indexOf(toId);
          if (fromIdx === -1 || toIdx === -1) return state;
          order.splice(fromIdx, 1);
          order.splice(toIdx, 0, fromId);
          return { navOrder: order };
        });
      },
      resetNavOrder: () => set({ navOrder: DEFAULT_NAV_ORDER }),
    }),
    {
      name: 'p2m-ui-storage',
      partialize: (state) => ({
        activeView: state.activeView,
        sidebarOpen: state.sidebarOpen,
        navOrder: state.navOrder,
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<UIState>;
        const savedOrder = (saved.navOrder || []) as ActiveView[];
        // Merge: keep user's order, filter out removed items, append new items
        const validSet = new Set(DEFAULT_NAV_ORDER);
        const merged = savedOrder.filter((id) => validSet.has(id));
        for (const id of DEFAULT_NAV_ORDER) {
          if (!merged.includes(id)) {
            merged.push(id);
          }
        }
        return {
          ...current,
          ...saved,
          navOrder: merged,
        };
      },
    }
  )
);
