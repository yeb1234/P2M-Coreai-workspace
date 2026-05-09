import React from 'react';
import {
  LayoutDashboard, ListTodo, Calendar, StickyNote, Timer, PlayCircle, BarChart3,
  BookOpen, Code2, Target, Layers, Bookmark, Heart, GitCompare, ShoppingCart,
  Trophy, Coins, MessageSquare, Compass, Bot, Package, Workflow, Settings,
} from 'lucide-react';
import type { ActiveView } from '../stores/uiStore';
import { DashboardPage } from '../components/dashboard/DashboardPage';
import { TodoPage } from '../components/todo/TodoPage';
import { CalendarPage } from '../components/calendar/CalendarPage';
import { PomodoroPage } from '../components/pomodoro/PomodoroPage';
import { VideoPage } from '../components/video/VideoPage';
import { NotesPage } from '../components/notes/NotesPage';
import { StatsPage } from '../components/stats/StatsPage';
import { ReaderPage } from '../components/reader/ReaderPage';
import { SnippetsPage } from '../components/snippets/SnippetsPage';
import { HabitsPage } from '../components/habits/HabitsPage';
import { FlashcardsPage } from '../components/flashcards/FlashcardsPage';
import { BookmarksPage } from '../components/bookmarks/BookmarksPage';
import { HealthPage } from '../components/health/HealthPage';
import { ComparePage } from '../components/compare/ComparePage';
import { ShopPage } from '../components/shop/ShopPage';
import { EsportsPage } from '../components/esports/EsportsPage';
import { TokensPage } from '../components/tokens/TokensPage';
import { LeetcodePage } from '../components/leetcode/LeetcodePage';
import { InterviewPage } from '../components/interview/InterviewPage';
import { CodeNavPage } from '../components/codenav/CodeNavPage';
import { AIAgentPage } from '../components/aiagent/AIAgentPage';
import { OpenClawPage } from '../components/openclaw/OpenClawPage';
import { HermesPage } from '../components/hermes/HermesPage';
import { SettingsPage } from '../components/settings/SettingsPage';

export interface PageEntry {
  id: ActiveView;
  path: string;
  component: React.ComponentType;
  label: string;
  icon: React.ReactNode;
  color: string;
  dev?: boolean;
}

export const PAGES: PageEntry[] = [
  { id: 'dashboard', path: '', component: DashboardPage, label: '工作台', icon: <LayoutDashboard size={20} />, color: 'text-[#c87d2f]' },
  { id: 'todo', path: 'todo', component: TodoPage, label: '待办事项', icon: <ListTodo size={20} />, color: 'text-[#2563eb]' },
  { id: 'calendar', path: 'calendar', component: CalendarPage, label: '日历', icon: <Calendar size={20} />, color: 'text-[#7c3aed]' },
  { id: 'notes', path: 'notes', component: NotesPage, label: '笔记', icon: <StickyNote size={20} />, color: 'text-[#f59e0b]' },
  { id: 'pomodoro', path: 'pomodoro', component: PomodoroPage, label: '番茄钟', icon: <Timer size={20} />, color: 'text-[#16a34a]' },
  { id: 'video', path: 'video', component: VideoPage, label: '视频站', icon: <PlayCircle size={20} />, color: 'text-[#ec4899]' },
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
  { id: 'aiagent', path: 'aiagent', component: AIAgentPage, label: 'AI 助手', icon: <Bot size={20} />, color: 'text-[#8b5cf6]', dev: true },
  { id: 'openclaw', path: 'openclaw', component: OpenClawPage, label: 'OpenClaw', icon: <Package size={20} />, color: 'text-[#dc3545]', dev: true },
  { id: 'hermes', path: 'hermes', component: HermesPage, label: 'Hermes', icon: <Workflow size={20} />, color: 'text-[#c87d2f]', dev: true },
  { id: 'settings', path: 'settings', component: SettingsPage, label: '设置', icon: <Settings size={20} />, color: 'text-[#6b7280]' },
];

export const VIEW_PATH: Record<ActiveView, string> = Object.fromEntries(
  PAGES.map((p) => [p.id, p.path])
) as Record<ActiveView, string>;

export const PATH_VIEW: Record<string, ActiveView> = Object.fromEntries(
  PAGES.map((p) => [p.path, p.id])
) as Record<string, ActiveView>;

export const PAGE_MAP: Record<ActiveView, PageEntry> = Object.fromEntries(
  PAGES.map((p) => [p.id, p])
) as Record<ActiveView, PageEntry>;
