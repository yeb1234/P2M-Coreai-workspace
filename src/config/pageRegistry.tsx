import React from 'react';
import {
  LayoutDashboard, ListTodo, Calendar, StickyNote, Timer, PlayCircle, BarChart3,
  BookOpen, Code2, Target, Layers, Bookmark, Heart, GitCompare, ShoppingCart,
  Trophy, Coins, MessageSquare, Compass, Bot, Package, Workflow, Settings,
  AlarmClock, Captions,
} from 'lucide-react';
import type { ActiveView } from '../stores/uiStore';

function lazyPage<T extends React.ComponentType>(loader: () => Promise<Record<string, T>>, exportName: string): React.LazyExoticComponent<T> {
  return React.lazy(async () => {
    const module = await loader();
    return { default: module[exportName] };
  });
}

const DashboardPage = lazyPage(() => import('../components/dashboard/DashboardPage'), 'DashboardPage');
const TodoPage = lazyPage(() => import('../components/todo/TodoPage'), 'TodoPage');
const CalendarPage = lazyPage(() => import('../components/calendar/CalendarPage'), 'CalendarPage');
const Calendar2Page = lazyPage(() => import('../components/calendar2/Calendar2Page'), 'Calendar2Page');
const NotesPage = lazyPage(() => import('../components/notes/NotesPage'), 'NotesPage');
const PomodoroPage = lazyPage(() => import('../components/pomodoro/PomodoroPage'), 'PomodoroPage');
const TimeCenterPage = lazyPage(() => import('../components/timecenter/TimeCenterPage2'), 'TimeCenterPage2');
const VideoPage = lazyPage(() => import('../components/video/VideoPage'), 'VideoPage');
const TranscriberPage = lazyPage(() => import('../components/transcriber/TranscriberPage'), 'TranscriberPage');
const HealthPage = lazyPage(() => import('../components/health/HealthPage'), 'HealthPage');
const ComparePage = lazyPage(() => import('../components/compare/ComparePage'), 'ComparePage');
const ShopPage = lazyPage(() => import('../components/shop/ShopPage'), 'ShopPage');
const EsportsPage = lazyPage(() => import('../components/esports/EsportsPage'), 'EsportsPage');
const StatsPage = lazyPage(() => import('../components/stats/StatsPage'), 'StatsPage');
const ReaderPage = lazyPage(() => import('../components/reader/ReaderPage'), 'ReaderPage');
const SnippetsPage = lazyPage(() => import('../components/snippets/SnippetsPage'), 'SnippetsPage');
const HabitsPage = lazyPage(() => import('../components/habits/HabitsPage'), 'HabitsPage');
const FlashcardsPage = lazyPage(() => import('../components/flashcards/FlashcardsPage'), 'FlashcardsPage');
const BookmarksPage = lazyPage(() => import('../components/bookmarks/BookmarksPage'), 'BookmarksPage');
const TokensPage = lazyPage(() => import('../components/tokens/TokensPage'), 'TokensPage');
const LeetcodePage = lazyPage(() => import('../components/leetcode/LeetcodePage'), 'LeetcodePage');
const InterviewPage = lazyPage(() => import('../components/interview/InterviewPage'), 'InterviewPage');
const CodeNavPage = lazyPage(() => import('../components/codenav/CodeNavPage'), 'CodeNavPage');
const AIAgentPage = lazyPage(() => import('../components/aiagent/AIAgentPage'), 'AIAgentPage');
const OpenClawPage = lazyPage(() => import('../components/openclaw/OpenClawPage'), 'OpenClawPage');
const HermesPage = lazyPage(() => import('../components/hermes/HermesPage'), 'HermesPage');
const SettingsPage = lazyPage(() => import('../components/settings/SettingsPage'), 'SettingsPage');

export interface PageEntry {
  id: ActiveView;
  path: string;
  component: React.ComponentType | React.LazyExoticComponent<React.ComponentType>;
  preload?: () => Promise<unknown>;
  label: string;
  icon: React.ReactNode;
  color: string;
  dev?: boolean;
}

const PAGE_LOADERS: Record<ActiveView, () => Promise<unknown>> = {
  dashboard: () => import('../components/dashboard/DashboardPage'),
  todo: () => import('../components/todo/TodoPage'),
  calendar: () => import('../components/calendar/CalendarPage'),
  calendar2: () => import('../components/calendar2/Calendar2Page'),
  notes: () => import('../components/notes/NotesPage'),
  pomodoro: () => import('../components/pomodoro/PomodoroPage'),
  timecenter: () => import('../components/timecenter/TimeCenterPage2'),
  video: () => import('../components/video/VideoPage'),
  transcriber: () => import('../components/transcriber/TranscriberPage'),
  health: () => import('../components/health/HealthPage'),
  compare: () => import('../components/compare/ComparePage'),
  shop: () => import('../components/shop/ShopPage'),
  esports: () => import('../components/esports/EsportsPage'),
  stats: () => import('../components/stats/StatsPage'),
  reader: () => import('../components/reader/ReaderPage'),
  snippets: () => import('../components/snippets/SnippetsPage'),
  habits: () => import('../components/habits/HabitsPage'),
  flashcards: () => import('../components/flashcards/FlashcardsPage'),
  bookmarks: () => import('../components/bookmarks/BookmarksPage'),
  tokens: () => import('../components/tokens/TokensPage'),
  leetcode: () => import('../components/leetcode/LeetcodePage'),
  interview: () => import('../components/interview/InterviewPage'),
  codenav: () => import('../components/codenav/CodeNavPage'),
  aiagent: () => import('../components/aiagent/AIAgentPage'),
  openclaw: () => import('../components/openclaw/OpenClawPage'),
  hermes: () => import('../components/hermes/HermesPage'),
  settings: () => import('../components/settings/SettingsPage'),
};

const preloadedPages = new Set<ActiveView>();

export function preloadPage(id: ActiveView): void {
  if (preloadedPages.has(id)) return;
  preloadedPages.add(id);
  void PAGE_LOADERS[id]?.();
}

export const PAGES: PageEntry[] = [
  { id: 'dashboard', path: '', component: DashboardPage, label: '工作台', icon: <LayoutDashboard size={20} />, color: 'text-[#c87d2f]' },
  { id: 'todo', path: 'todo', component: TodoPage, label: '待办事项', icon: <ListTodo size={20} />, color: 'text-[#2563eb]' },
  // calendar = 日历看板（月视图，传统日历格子）
  { id: 'calendar', path: 'calendar', component: CalendarPage, label: '日历看板', icon: <Calendar size={20} />, color: 'text-[#7c3aed]' },
  // calendar2 = 周历（周视图，拖动安排待办和事件）
  { id: 'calendar2', path: 'calendar2', component: Calendar2Page, label: '周历', icon: <Calendar size={20} />, color: 'text-[#2563eb]' },
  { id: 'notes', path: 'notes', component: NotesPage, label: '笔记', icon: <StickyNote size={20} />, color: 'text-[#f59e0b]' },
  { id: 'pomodoro', path: 'pomodoro', component: PomodoroPage, label: '番茄钟', icon: <Timer size={20} />, color: 'text-[var(--accent)]' },
  { id: 'timecenter', path: 'timecenter', component: TimeCenterPage, label: '时间中心', icon: <AlarmClock size={20} />, color: 'text-[var(--accent)]' },
  { id: 'video', path: 'video', component: VideoPage, label: 'IT视频站', icon: <PlayCircle size={20} />, color: 'text-[#ec4899]' },
  { id: 'transcriber', path: 'transcriber', component: TranscriberPage, label: '字幕转录王', icon: <Captions size={20} />, color: 'text-[#06b6d4]' },
  { id: 'health', path: 'health', component: HealthPage, label: '健康助手', icon: <Heart size={20} />, color: 'text-[#ec4899]', dev: true },
  { id: 'compare', path: 'compare', component: ComparePage, label: '产品对比', icon: <GitCompare size={20} />, color: 'text-[#06b6d4]', dev: true },
  { id: 'shop', path: 'shop', component: ShopPage, label: '电商中心', icon: <ShoppingCart size={20} />, color: 'text-[#f59e0b]', dev: true },
  { id: 'esports', path: 'esports', component: EsportsPage, label: '赛事数据', icon: <Trophy size={20} />, color: 'text-[#f59e0b]', dev: true },
  { id: 'stats', path: 'stats', component: StatsPage, label: '数据中心', icon: <BarChart3 size={20} />, color: 'text-[#06b6d4]', dev: true },
  { id: 'reader', path: 'reader', component: ReaderPage, label: '阅读器', icon: <BookOpen size={20} />, color: 'text-[#2563eb]', dev: true },
  { id: 'snippets', path: 'snippets', component: SnippetsPage, label: '代码片段', icon: <Code2 size={20} />, color: 'text-[#8b5cf6]', dev: true },
  { id: 'habits', path: 'habits', component: HabitsPage, label: '习惯追踪', icon: <Target size={20} />, color: 'text-[#16a34a]', dev: true },
  { id: 'flashcards', path: 'flashcards', component: FlashcardsPage, label: '闪卡记忆', icon: <Layers size={20} />, color: 'text-[#f59e0b]', dev: true },
  { id: 'bookmarks', path: 'bookmarks', component: BookmarksPage, label: '书签收藏', icon: <Bookmark size={20} />, color: 'text-[#06b6d4]', dev: true },
  { id: 'tokens', path: 'tokens', component: TokensPage, label: 'Token 用量', icon: <Coins size={20} />, color: 'text-[#c87d2f]', dev: true },
  { id: 'leetcode', path: 'leetcode', component: LeetcodePage, label: 'LeetCode', icon: <Code2 size={20} />, color: 'text-[#f59e0b]', dev: true },
  { id: 'interview', path: 'interview', component: InterviewPage, label: '面试题库', icon: <MessageSquare size={20} />, color: 'text-[#ec4899]', dev: true },
  { id: 'codenav', path: 'codenav', component: CodeNavPage, label: '编程导航', icon: <Compass size={20} />, color: 'text-[#2563eb]', dev: true },
  { id: 'aiagent', path: 'aiagent', component: AIAgentPage, label: '灵境小助手', icon: <Bot size={20} />, color: 'text-[#8b5cf6]', dev: true },
  { id: 'openclaw', path: 'openclaw', component: OpenClawPage, label: 'OpenClaw', icon: <Package size={20} />, color: 'text-[#dc3545]', dev: true },
  { id: 'hermes', path: 'hermes', component: HermesPage, label: 'Hermes', icon: <Workflow size={20} />, color: 'text-[#c87d2f]', dev: true },
  { id: 'settings', path: 'settings', component: SettingsPage, label: '设置', icon: <Settings size={20} />, color: 'text-[#6b7280]' },
];

PAGES.forEach((page) => {
  page.preload = () => PAGE_LOADERS[page.id]?.();
});

export const VIEW_PATH: Record<ActiveView, string> = Object.fromEntries(
  PAGES.map((p) => [p.id, p.path])
) as Record<ActiveView, string>;

export const PATH_VIEW: Record<string, ActiveView> = Object.fromEntries(
  PAGES.map((p) => [p.path, p.id])
) as Record<string, ActiveView>;

export const PAGE_MAP: Record<ActiveView, PageEntry> = Object.fromEntries(
  PAGES.map((p) => [p.id, p])
) as Record<ActiveView, PageEntry>;
