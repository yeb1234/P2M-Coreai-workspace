import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { idbStorage } from '../lib/idbStorage';
import { IS_DESKTOP_CLIENT } from '../lib/clientContext';
import { type ThemeVars, type ThemeScheduleRule, THEME_PRESETS, applyTheme, DEFAULT_THEME_SCHEDULE_RULES } from '../lib/themes';
import { VIEW_PATH } from '../config/pageRegistry';
import { isPageEnabled } from '../config/appProfile';

export type ActiveView = 'dashboard' | 'todo' | 'calendar' | 'calendar2' | 'notes' | 'mdnotes' | 'pomodoro' | 'timecenter' | 'learning' | 'journey' | 'video' | 'videopreview' | 'media' | 'transcribe' | 'stats' | 'reader' | 'snippets' | 'habits' | 'flashcards' | 'bookmarks' | 'health' | 'compare' | 'shop' | 'esports' | 'tokens' | 'leetcode' | 'interview' | 'codenav' | 'aiagent' | 'openclaw' | 'hermes' | 'settings';

export type FontSize = 'sm' | 'md' | 'lg';
export type ThemeId = string;
export type NoteEnterBehavior = 'enter_save' | 'enter_newline';
export type NavPlacement = 'left' | 'top';

const DEFAULT_NAV_ORDER_ALL: ActiveView[] = [
  'dashboard', 'todo', 'calendar', 'calendar2', 'notes', 'mdnotes', 'pomodoro', 'timecenter',
  'health', 'bookmarks', 'learning', 'journey', 'video', 'videopreview', 'media', 'transcribe',
  'compare', 'shop', 'esports',
  'stats', 'reader', 'snippets', 'habits',
  'flashcards', 'tokens',
  'leetcode', 'interview', 'codenav', 'aiagent', 'openclaw', 'hermes',
];

export const DEFAULT_NAV_ORDER: ActiveView[] = DEFAULT_NAV_ORDER_ALL.filter(isPageEnabled);

const clampSidebarWidth = (width: number | undefined) => Math.max(148, Math.min(240, Math.round(width || 184)));

interface ModalState {
  type: string;
  data?: unknown;
}

interface UIState {
  activeView: ActiveView;
  sidebarOpen: boolean;
  sidebarWidth: number;
  navPlacement: NavPlacement;
  modalState: ModalState | null;
  navOrder: ActiveView[];
  hiddenNavItems: ActiveView[];
  displayName: string;
  fontSize: FontSize;
  compactMode: boolean;
  themeId: ThemeId;
  customTheme: ThemeVars | null;
  noteEnterBehavior: NoteEnterBehavior;
  previousViewBeforeSettings: ActiveView | null;
  videoRightPanelWidth: number;
  videoRightPanelCollapsed: boolean;
  activeNoteId: string | null;
  themeScheduleEnabled: boolean;
  themeScheduleRules: ThemeScheduleRule[];
  setActiveView: (view: ActiveView) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setNavPlacement: (placement: NavPlacement) => void;
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
  setNoteEnterBehavior: (behavior: NoteEnterBehavior) => void;
  toggleSettingsView: () => void;
  setVideoRightPanelWidth: (width: number) => void;
  toggleVideoRightPanel: () => void;
  setVideoRightPanelCollapsed: (collapsed: boolean) => void;
  setActiveNoteId: (id: string | null) => void;
  setThemeScheduleEnabled: (enabled: boolean) => void;
  setThemeScheduleRules: (rules: ThemeScheduleRule[]) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      activeView: 'dashboard',
      sidebarOpen: true,
      sidebarWidth: 184,
      // 桌面壳原本就是顶部横排；网页端保持左侧分组侧栏。
      navPlacement: IS_DESKTOP_CLIENT ? 'top' : 'left',
      modalState: null,
      navOrder: DEFAULT_NAV_ORDER,
      hiddenNavItems: [],
      displayName: '',
      fontSize: 'md',
      compactMode: false,
      themeId: 'warm-wood',
      customTheme: null,
      noteEnterBehavior: 'enter_save',
      previousViewBeforeSettings: null,
      videoRightPanelWidth: 340,
      videoRightPanelCollapsed: false,
      activeNoteId: null,
      themeScheduleEnabled: false,
      themeScheduleRules: DEFAULT_THEME_SCHEDULE_RULES,
      setActiveView: (view) => {
        set((state) => ({
          activeView: view,
          previousViewBeforeSettings: view === 'settings' && state.activeView !== 'settings'
            ? state.activeView
            : state.previousViewBeforeSettings,
        }));
        const path = VIEW_PATH[view];
        if (path !== undefined) {
          window.location.hash = `/${path}`;
        }
      },
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      setSidebarWidth: (width) => set({ sidebarWidth: clampSidebarWidth(width) }),
      setNavPlacement: (navPlacement) => set({ navPlacement }),
      openModal: (type, data) => set({ modalState: { type, data } }),
      closeModal: () => set({ modalState: null }),
      reorderNav: (fromId, toId) => {
        set((state) => {
          const order = [...state.navOrder];
          const fromIdx = order.indexOf(fromId);
          const toIdx = order.indexOf(toId);
          if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) {
            return { navOrder: order };
          }
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
      setActiveNoteId: (activeNoteId) => set({ activeNoteId }),
      setThemeScheduleEnabled: (themeScheduleEnabled) => set({ themeScheduleEnabled }),
      setThemeScheduleRules: (themeScheduleRules) => set({ themeScheduleRules }),
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
      setNoteEnterBehavior: (noteEnterBehavior) => set({ noteEnterBehavior }),
      toggleSettingsView: () => {
        const state = useUIStore.getState();
        const target = state.activeView === 'settings'
          ? state.previousViewBeforeSettings ?? 'dashboard'
          : 'settings';
        set({
          activeView: target,
          previousViewBeforeSettings: target === 'settings' ? state.activeView : null,
        });
        const path = VIEW_PATH[target];
        if (path !== undefined) {
          window.location.hash = `/${path}`;
        }
      },
    }),
    {
      name: 'p2m-ui-storage',
      storage: createJSONStorage(() => idbStorage),
      // navOrder 是持久化的，新版本加的页面不会自动出现在老用户侧边栏里。
      // 之前试过在 Sidebar 组件里 import PAGES 补齐，触发了 pageRegistry ↔ Sidebar
      // 的循环依赖（TDZ: Cannot access 'h' before initialization），已回退。
      // 正确的位置是这里：在状态恢复时做一次迁移，把新页面按默认顺序插入，
      // 而不是追加到末尾。
      version: 3,
      migrate: (persisted: unknown, version: number) => {
        const state = (persisted ?? {}) as Record<string, unknown>;
        if (version < 3 && Array.isArray(state.navOrder)) {
          const stored = state.navOrder as ActiveView[];
          const storedSet = new Set(stored);
          const merged: ActiveView[] = [];
          DEFAULT_NAV_ORDER.forEach((id, idx) => {
            if (storedSet.has(id)) {
              merged.push(id);
              return;
            }
            // 新页面：插到默认顺序里「它前面最近的一个已存在项」之后
            let insertAt = merged.length;
            for (let j = idx - 1; j >= 0; j -= 1) {
              const pos = merged.indexOf(DEFAULT_NAV_ORDER[j]);
              if (pos >= 0) {
                insertAt = pos + 1;
                break;
              }
            }
            merged.splice(insertAt, 0, id);
          });
          // 用户自己调整过、但默认顺序里没有的项，保持原样追加
          stored.forEach((id) => {
            if (!merged.includes(id)) merged.push(id);
          });
          state.navOrder = merged;
        }
        return state as never;
      },
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
        sidebarWidth: state.sidebarWidth,
        navPlacement: state.navPlacement,
        navOrder: state.navOrder,
        hiddenNavItems: state.hiddenNavItems,
        displayName: state.displayName,
        fontSize: state.fontSize,
        compactMode: state.compactMode,
        themeId: state.themeId,
        customTheme: state.customTheme,
        noteEnterBehavior: state.noteEnterBehavior,
        videoRightPanelWidth: state.videoRightPanelWidth,
        videoRightPanelCollapsed: state.videoRightPanelCollapsed,
        themeScheduleEnabled: state.themeScheduleEnabled,
        themeScheduleRules: state.themeScheduleRules,
      }),
      merge: (persisted, current) => {
        if (!persisted || typeof persisted !== 'object') return current;
        const storageValue = persisted as Record<string, unknown>;
        const saved =
          storageValue.state !== undefined && storageValue.state !== null
            ? (storageValue.state as Partial<UIState>)
            : (persisted as Partial<UIState>);
        if (!saved || typeof saved !== 'object') return current;
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
        const safeActiveView = saved.activeView && isPageEnabled(saved.activeView)
          ? saved.activeView
          : current.activeView;
        const safePreviousView = saved.previousViewBeforeSettings && isPageEnabled(saved.previousViewBeforeSettings)
          ? saved.previousViewBeforeSettings
          : current.previousViewBeforeSettings;
        if (import.meta.env?.DEV) {
          console.log('[uiStore merge] persisted:', persisted, 'savedOrder:', savedOrder, 'savedHidden:', savedHidden, 'merged:', merged, 'validHidden:', validHidden);
        }
        return {
          ...current,
          ...saved,
          themeScheduleEnabled: saved.themeScheduleEnabled ?? current.themeScheduleEnabled,
          themeScheduleRules: saved.themeScheduleRules ?? current.themeScheduleRules,
          sidebarWidth: clampSidebarWidth(saved.sidebarWidth),
          navPlacement: saved.navPlacement === 'top' || saved.navPlacement === 'left'
            ? saved.navPlacement
            : current.navPlacement,
          navOrder: merged,
          hiddenNavItems: validHidden,
          activeView: safeActiveView,
          previousViewBeforeSettings: safePreviousView,
        };
      },
    }
  )
);
