import React from 'react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { useUIStore } from '../../stores';
import { pluginRegistry } from '../../plugins';
import { DashboardPage } from '../dashboard/DashboardPage';
import { VideoPage } from '../video/VideoPage';
import { NotesPage } from '../notes/NotesPage';
import { StatsPage } from '../stats/StatsPage';
import { ReaderPage } from '../reader/ReaderPage';
import { SnippetsPage } from '../snippets/SnippetsPage';
import { HabitsPage } from '../habits/HabitsPage';
import { FlashcardsPage } from '../flashcards/FlashcardsPage';
import { BookmarksPage } from '../bookmarks/BookmarksPage';
import { HealthPage } from '../health/HealthPage';
import { ComparePage } from '../compare/ComparePage';
import { ShopPage } from '../shop/ShopPage';
import { EsportsPage } from '../esports/EsportsPage';
import { TokensPage } from '../tokens/TokensPage';
import { LeetcodePage } from '../leetcode/LeetcodePage';
import { InterviewPage } from '../interview/InterviewPage';
import { CodeNavPage } from '../codenav/CodeNavPage';
import { AIAgentPage } from '../aiagent/AIAgentPage';
import { OpenClawPage } from '../openclaw/OpenClawPage';
import { HermesPage } from '../hermes/HermesPage';
import { SettingsPage } from '../settings/SettingsPage';

const VIEW_MAP: Record<string, React.FC> = {
  dashboard: DashboardPage,
  video: VideoPage,
  notes: NotesPage,
  stats: StatsPage,
  reader: ReaderPage,
  snippets: SnippetsPage,
  habits: HabitsPage,
  flashcards: FlashcardsPage,
  bookmarks: BookmarksPage,
  health: HealthPage,
  compare: ComparePage,
  shop: ShopPage,
  esports: EsportsPage,
  tokens: TokensPage,
  leetcode: LeetcodePage,
  interview: InterviewPage,
  codenav: CodeNavPage,
  aiagent: AIAgentPage,
  openclaw: OpenClawPage,
  hermes: HermesPage,
  settings: SettingsPage,
};

export const AppLayout: React.FC = () => {
  const { activeView } = useUIStore();

  const renderView = () => {
    const Component = VIEW_MAP[activeView];
    if (Component) return <Component />;
    const plugin = pluginRegistry.getPlugin(activeView);
    if (plugin) {
      const Panel = plugin.panel.component;
      return <Panel />;
    }
    return <DashboardPage />;
  };

  return (
    <div className="flex flex-col h-screen">
      {/* Wood outer frame */}
      <div className="flex-1 m-3 md:m-5 wood-texture rounded-xl p-3 md:p-4 overflow-hidden flex flex-col">
        {/* Paper inner surface */}
        <div className="flex-1 paper-surface flex flex-col overflow-hidden">
          <Header />
          <div className="flex flex-1 overflow-hidden">
            <Sidebar />
            <main className="flex-1 overflow-y-auto p-4 md:p-6">
              {renderView()}
            </main>
          </div>
        </div>
      </div>
    </div>
  );
};
