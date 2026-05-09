import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { idbStorage } from '../lib/idbStorage';
import { type ThemeVars, THEME_PRESETS, applyTheme } from '../lib/themes';
import { VIEW_PATH } from '../config/pageRegistry';

export type ActiveView = 'dashboard' | 'todo' | 'calendar' | 'notes' | 'pomodoro' | 'video' | 'stats' | 'reader' | 'snippets' | 'habits' | 'flashcards' | 'bookmarks' | 'health' | 'compare' | 'shop' | 'esports' | 'tokens' | 'leetcode' | 'interview' | 'codenav' | 'aiagent' | 'openclaw' | 'hermes' | 'settings';

export type FontSize = 'sm' | 'md' | 'lg';
export type ThemeId = string;

const DEFAULT_NAV_ORDER: ActiveView[] = [
  'dashboard', 'todo', 'calendar', 'notes', 'pomodoro',
  'health', 'video', 'compare', 'shop', 'esports',
  'stats', 'reader', 'snippets', 'habits',
  'flashcards', 'bookmarks', 'tokens',
  'leetcode', 'interview', 'codenav', 'aiagent', 'openclaw', 'hermes',
];

const clampSidebarWidth = (width: number | undefined) => Math.max(160, Math.min(320, Math.round(width || 208)));

interface ModalState {
  type: string;
  data?: unknown;
}

interface UIState {
  activeView: ActiveView;
  sidebarOpen: boolean;
  sidebarWidth: number;
  modalState: ModalState | null;
  navOrder: ActiveView[];
  hiddenNavItems: ActiveView[];
  displayName: string;
  fontSize: FontSize;
  compactMode: boolean;
  themeId: ThemeId;
  customTheme: ThemeVars | null;
  videoRightPanelWidth: number;
  videoRightPanelCollapsed: boolean;
  setActiveView: (view: ActiveView) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  openModal: (type: string, data?: unknown) => void;
  closeModal: () => void;
  reorderNav: (fromId: ActiveView, toId: ActiveView) => void;
  resetNavOrder: () => void;
  hideNav: (id: ActiveView) => void;
  showNav: (id: ActiveView) => void;
  showAllNav: () => void;
  setDisplayName: (name: string) => void;
  setFontSize: (size: FontSize) => void;
  setCompactMode: (v: boolean) => void;
  setTheme: (id: ThemeId) => void;
  setCustomTheme: (vars: ThemeVars | null) => void;
  setVideoRightPanelWidth: (width: number) => void;
  toggleVideoRightPanel: () => void;
  setVideoRightPanelCollapsed: (collapsed: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      activeView: 'dashboard',
      sidebarOpen: true,
      sidebarWidth: 208,
      modalState: null,
      navOrder: DEFAULT_NAV_ORDER,
      hiddenNavItems: [],
      displayName: '',
      fontSize: 'md',
      compactMode: false,
      themeId: 'warm-wood',
      customTheme: null,
      videoRightPanelWidth: 340,
      videoRightPanelCollapsed: false,
      setActiveView: (view) => {
        set({ activeView: view });
        const path = VIEW_PATH[view];
        if (path !== undefined) {
          window.location.hash = `/${path}`;
        }
      },
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarWidth: (width) => set({ sidebarWidth: clampSidebarWidth(width) }),
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
      resetNavOrder: () => set({ navOrder: DEFAULT_NAV_ORDER, hiddenNavItems: [] }),
      hideNav: (id) => set((state) => {
        if (state.activeView === id) {
          window.location.hash = '/';
          return {
            hiddenNavItems: [...state.hiddenNavItems, id],
            activeView: 'dashboard' as ActiveView,
          };
        }
        return {
          hiddenNavItems: [...state.hiddenNavItems, id],
        };
      }),
      showNav: (id) => set((state) => ({
        hiddenNavItems: state.hiddenNavItems.filter((i) => i !== id),
      })),
      showAllNav: () => set({ hiddenNavItems: [] }),
      setDisplayName: (name) => set({ displayName: name }),
      setFontSize: (size) => set({ fontSize: size }),
      setCompactMode: (v) => set({ compactMode: v }),
      setVideoRightPanelWidth: (width) => set({
        videoRightPanelWidth: Math.max(260, Math.min(520, Math.round(width))),
      }),
      toggleVideoRightPanel: () => set((state) => ({ videoRightPanelCollapsed: !state.videoRightPanelCollapsed })),
      setVideoRightPanelCollapsed: (collapsed) => set({ videoRightPanelCollapsed: collapsed }),
      setTheme: (id) => {
        set({ themeId: id });
        if (id === 'custom') return;
        const preset = THEME_PRESETS.find((t) => t.id === id);
        if (preset) applyTheme(preset.id, preset.vars);
      },
      setCustomTheme: (vars) => {
        set({ customTheme: vars, themeId: 'custom' });
        if (vars) applyTheme('custom', vars);
      },
    }),
    {
      name: 'p2m-ui-storage',
      storage: createJSONStorage(() => idbStorage),
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
        sidebarWidth: state.sidebarWidth,
        navOrder: state.navOrder,
        hiddenNavItems: state.hiddenNavItems,
        displayName: state.displayName,
        fontSize: state.fontSize,
        compactMode: state.compactMode,
        themeId: state.themeId,
        customTheme: state.customTheme,
        videoRightPanelWidth: state.videoRightPanelWidth,
        videoRightPanelCollapsed: state.videoRightPanelCollapsed,
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<UIState>;
        const savedOrder = (saved.navOrder || []) as ActiveView[];
        const savedHidden = (saved.hiddenNavItems || []) as ActiveView[];
        const validSet = new Set(DEFAULT_NAV_ORDER);
        const merged = savedOrder.filter((id) => validSet.has(id));
        for (const id of DEFAULT_NAV_ORDER) {
          if (!merged.includes(id)) {
            merged.push(id);
          }
        }
        const validHidden = savedHidden.filter((id) => validSet.has(id));
        return {
          ...current,
          ...saved,
          sidebarWidth: clampSidebarWidth(saved.sidebarWidth),
          navOrder: merged,
          hiddenNavItems: validHidden,
        };
      },
    }
  )
);
