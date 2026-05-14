import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUIStore } from '../stores/uiStore';
import { clearIDBKvData } from '../lib/idbStorage';

vi.mock('../lib/authApi', () => ({
  hasAuthToken: vi.fn(() => false),
  getUserData: vi.fn(async () => null),
  setUserData: vi.fn(async () => undefined),
}));

import type { ActiveView } from '../stores/uiStore';

const DEFAULT_ORDER: ActiveView[] = [
  'dashboard', 'todo', 'calendar', 'calendar2', 'notes', 'pomodoro', 'timecenter',
  'health', 'video', 'transcriber', 'compare', 'shop', 'esports',
  'stats', 'reader', 'snippets', 'habits',
  'flashcards', 'bookmarks', 'tokens',
  'leetcode', 'interview', 'codenav', 'aiagent', 'openclaw', 'hermes',
];

beforeEach(async () => {
  await clearIDBKvData();
  useUIStore.setState({
    navOrder: [...DEFAULT_ORDER],
    hiddenNavItems: [],
    sidebarOpen: true,
    sidebarWidth: 184,
    displayName: '',
    fontSize: 'md',
    compactMode: false,
    themeId: 'warm-wood',
    customTheme: null,
    noteEnterBehavior: 'enter_save',
    videoRightPanelWidth: 340,
    videoRightPanelCollapsed: false,
  });
  await new Promise((r) => setTimeout(r, 50));
  await useUIStore.persist.rehydrate();
});

describe('uiStore sidebar persistence', () => {
  it('preserves navOrder after reordering', async () => {
    const state = useUIStore.getState();
    state.reorderNav('todo', 'dashboard');

    await new Promise((r) => setTimeout(r, 50));
    await useUIStore.persist.rehydrate();

    const newState = useUIStore.getState();
    expect(newState.navOrder[0]).toBe('todo');
    expect(newState.navOrder[1]).toBe('dashboard');
  });

  it('preserves hiddenNavItems after hiding', async () => {
    const state = useUIStore.getState();
    state.hideNav('video');

    await new Promise((r) => setTimeout(r, 50));
    await useUIStore.persist.rehydrate();

    const newState = useUIStore.getState();
    expect(newState.hiddenNavItems).toContain('video');
    expect(newState.navOrder).toContain('video');
  });

  it('preserves both order and hidden state together', async () => {
    const state = useUIStore.getState();
    state.reorderNav('todo', 'dashboard');
    state.hideNav('video');

    await new Promise((r) => setTimeout(r, 50));
    await useUIStore.persist.rehydrate();

    const newState = useUIStore.getState();
    expect(newState.navOrder[0]).toBe('todo');
    expect(newState.navOrder[1]).toBe('dashboard');
    expect(newState.hiddenNavItems).toContain('video');
    expect(newState.navOrder).toContain('video');
  });
});
