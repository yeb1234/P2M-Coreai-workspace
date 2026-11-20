import React, { useMemo, useState } from 'react';
import { Bot, ChevronRight, Search, Sparkles, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PAGES, VIEW_PATH, preloadPage } from '../../config/pageRegistry';
import { useAIStore, useUIStore } from '../../stores';
import type { ActiveView } from '../../stores/uiStore';

interface NavGroup {
  title: string;
  description: string;
  ids: string[];
}

const GROUPS: NavGroup[] = [
  // 排序规则：已完成并验收的项目入口往前面放；便签与笔记相邻。
  {
    title: '常用',
    description: '每天都会开的几个页面',
    ids: ['dashboard', 'todo', 'calendar', 'notes', 'mdnotes', 'pomodoro', 'video', 'aiagent', 'settings'],
  },
  {
    title: '日常',
    description: '周历、时间与习惯',
    ids: ['calendar2', 'timecenter', 'habits', 'journey'],
  },
  {
    title: '学习',
    description: '课程、字幕和刷题',
    ids: ['bookmarks', 'learning', 'flashcards', 'leetcode', 'interview', 'reader', 'snippets'],
  },
  {
    title: '工具',
    description: '数据、内容和外链',
    ids: ['health', 'compare', 'shop', 'esports', 'stats', 'tokens', 'codenav', 'openclaw', 'hermes'],
  },
];

interface MobileNavSheetProps {
  open: boolean;
  onClose: () => void;
}

export const MobileNavSheet: React.FC<MobileNavSheetProps> = ({ open, onClose }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const setChatOpen = useAIStore((s) => s.setChatOpen);
  const fontSize = useUIStore((s) => s.fontSize);
  const compactMode = useUIStore((s) => s.compactMode);
  const [query, setQuery] = useState('');

  const currentPath = location.pathname === '/' ? '' : location.pathname.replace(/^\//, '');
  const closeSheet = () => {
    setQuery('');
    onClose();
  };
  const totalPages = PAGES.length;

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return PAGES.filter((page) =>
      page.label.toLowerCase().includes(needle) ||
      page.id.toLowerCase().includes(needle)
    );
  }, [query]);

  const groups = useMemo(
    () => GROUPS.map((group) => ({
      ...group,
      pages: group.ids
        .map((id) => PAGES.find((page) => page.id === id))
        .filter((page): page is NonNullable<typeof page> => Boolean(page)),
    })),
    []
  );

  if (!open) return null;

  const go = (id: string) => {
    const path = VIEW_PATH[id as ActiveView];
    if (path === undefined) return;
    preloadPage(id as ActiveView);
    navigate(path === '' ? '/' : `/${path}`);
    closeSheet();
  };

  const openAI = () => {
    closeSheet();
    setChatOpen(true);
  };

  const renderTile = (page: (typeof PAGES)[number]) => {
    const active = page.path === currentPath;
    return (
      <button
        key={page.id}
        type="button"
        onClick={() => go(page.id)}
        className={`mobile-page-tile ${active ? 'is-active' : ''}`}
        aria-current={active ? 'page' : undefined}
      >
        <span className="mobile-page-tile-icon">{page.icon}</span>
        <span className="min-w-0 flex-1 truncate text-left">{page.label}</span>
        {page.dev && <span className="mobile-page-dev-dot" aria-label="开发中" />}
        <ChevronRight size={13} className="mobile-page-tile-arrow" />
      </button>
    );
  };

  return (
    <div className="mobile-nav-layer" onClick={closeSheet}>
      <section
        className="mobile-nav-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="全部功能"
        onClick={(event) => event.stopPropagation()}
        data-font-size={fontSize}
        data-compact={compactMode ? 'true' : 'false'}
      >
        <header className="mobile-nav-header">
          <div className="mobile-nav-brand">
            <span className="mobile-nav-logo" aria-hidden="true">灵</span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--text-primary)]">全部功能</p>
              <p className="truncate text-xs text-[var(--text-muted)]">
                {totalPages} 个页面 · 工作台之外的入口都在这里
              </p>
            </div>
          </div>
          <button type="button" onClick={closeSheet} className="mobile-nav-close" aria-label="关闭全部功能">
            <X size={18} />
          </button>
        </header>

        <div className="mobile-nav-search">
          <Search size={16} className="text-[var(--text-muted)]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索页面，例如 周历、字幕、Token"
            aria-label="搜索页面"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} className="mobile-nav-search-clear" aria-label="清空搜索">
              <X size={14} />
            </button>
          )}
        </div>

        <div className="mobile-nav-body">
          <button type="button" className="mobile-nav-ai" onClick={openAI}>
            <span className="mobile-nav-ai-icon"><Sparkles size={20} /></span>
            <span className="min-w-0 flex-1 text-left">
              <span className="block text-sm font-semibold text-[var(--text-primary)]">灵境小助手</span>
              <span className="mt-0.5 block truncate text-xs text-[var(--text-muted)]">
                当前页面上下文 + 视频库检索，直接问就行
              </span>
            </span>
            <Bot size={18} className="text-[var(--accent)]" />
          </button>

          {results.length > 0 ? (
            <section className="mobile-nav-group">
              <div className="mobile-nav-group-head">
                <p className="mobile-nav-group-title">搜索结果</p>
                <span className="mobile-nav-group-count">{results.length}</span>
              </div>
              <div className="mobile-nav-grid">{results.map(renderTile)}</div>
            </section>
          ) : query ? (
            <div className="mobile-nav-empty">
              <p>没有匹配「{query}」的页面</p>
              <button type="button" onClick={() => setQuery('')}>清空搜索</button>
            </div>
          ) : (
            groups.map((group) => (
              <section key={group.title} className="mobile-nav-group">
                <div className="mobile-nav-group-head">
                  <div className="min-w-0">
                    <p className="mobile-nav-group-title">{group.title}</p>
                    <p className="mobile-nav-group-desc">{group.description}</p>
                  </div>
                  <span className="mobile-nav-group-count">{group.pages.length}</span>
                </div>
                <div className="mobile-nav-grid">{group.pages.map(renderTile)}</div>
              </section>
            ))
          )}
        </div>

        <div className="mobile-nav-footer">
          <div className="mobile-nav-tip">
            <span className="mobile-nav-tip-dot" />
            长页面可直接下拉，底部导航始终可回到工作台
          </div>
        </div>
      </section>
    </div>
  );
};
