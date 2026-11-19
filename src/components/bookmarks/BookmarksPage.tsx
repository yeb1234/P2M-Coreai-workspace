import React, { useMemo, useState } from 'react';
import { Bookmark, ExternalLink, Plus, Search, Sparkles, Trash2, X } from 'lucide-react';
import { PageTitle } from '../shared';
import {
  BOOKMARK_CATEGORIES,
  BOOKMARK_FILTERS,
  CURATED_BOOKMARKS,
  type BookmarkCategory,
  type BookmarkFilter,
  type BookmarkItem,
} from '../../data/bookmarks';
import { userScopedStorage } from '../../lib/userScopedStorage';

const STORAGE_KEY = 'p2m-custom-bookmarks-v1';

function loadCustomBookmarks(): BookmarkItem[] {
  try {
    const raw = userScopedStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is BookmarkItem =>
        Boolean(item) &&
        typeof item.id === 'string' &&
        typeof item.title === 'string' &&
        typeof item.url === 'string' &&
        typeof item.category === 'string'
    );
  } catch {
    return [];
  }
}

function saveCustomBookmarks(items: BookmarkItem[]): boolean {
  try {
    userScopedStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    return true;
  } catch {
    return false;
  }
}

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(candidate);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('只支持 http / https 链接');
  }
  return parsed.toString();
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function matchesFilter(bookmark: BookmarkItem, filter: BookmarkFilter): boolean {
  if (filter === '全部') return true;
  if (filter === '必看') return Boolean(bookmark.mustRead);
  if (filter === '中文') return bookmark.language === 'zh';
  return bookmark.category === filter;
}

export const BookmarksPage: React.FC = () => {
  const [customBookmarks, setCustomBookmarks] = useState<BookmarkItem[]>(loadCustomBookmarks);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<BookmarkFilter>('全部');
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({
    title: '',
    url: '',
    description: '',
    category: '后端底座' as BookmarkCategory,
  });

  const allBookmarks = useMemo(
    () => [...CURATED_BOOKMARKS, ...customBookmarks],
    [customBookmarks]
  );

  const counts = useMemo(() => {
    const base: Record<string, number> = {
      全部: allBookmarks.length,
      必看: allBookmarks.filter((item) => item.mustRead).length,
      中文: allBookmarks.filter((item) => item.language === 'zh').length,
    };
    BOOKMARK_CATEGORIES.forEach((category) => {
      base[category] = allBookmarks.filter((item) => item.category === category).length;
    });
    return base;
  }, [allBookmarks]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const list = allBookmarks.filter((bookmark) => {
      if (!matchesFilter(bookmark, filter)) return false;
      if (!keyword) return true;
      return [
        bookmark.title,
        bookmark.description,
        bookmark.why,
        bookmark.category,
        bookmark.tags.join(' '),
        hostOf(bookmark.url),
      ]
        .join(' ')
        .toLowerCase()
        .includes(keyword);
    });

    return [...list].sort((a, b) => {
      if (Boolean(a.custom) !== Boolean(b.custom)) return a.custom ? 1 : -1;
      if (Boolean(a.mustRead) !== Boolean(b.mustRead)) return a.mustRead ? -1 : 1;
      return 0;
    });
  }, [allBookmarks, filter, query]);

  const resetForm = () => {
    setForm({ title: '', url: '', description: '', category: '后端底座' });
    setFormError('');
  };

  const handleAdd = (event: React.FormEvent) => {
    event.preventDefault();
    setNotice('');
    const title = form.title.trim();
    if (!title) {
      setFormError('给书签起个名字。');
      return;
    }

    let url: string;
    try {
      url = normalizeUrl(form.url);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '链接格式不对。');
      return;
    }

    const duplicated = allBookmarks.some(
      (bookmark) => bookmark.url.replace(/\/$/, '').toLowerCase() === url.replace(/\/$/, '').toLowerCase()
    );
    if (duplicated) {
      setFormError('这个链接已经在书签里了。');
      return;
    }

    const next: BookmarkItem = {
      id: `custom-${Date.now()}`,
      title,
      url,
      category: form.category,
      description: form.description.trim() || '自己添加的常用入口。',
      why: '自己添加的书签，放在这里方便随时打开。',
      tags: ['自定义', form.category],
      icon: '🔖',
      custom: true,
    };
    const nextList = [...customBookmarks, next];
    setCustomBookmarks(nextList);
    const persisted = saveCustomBookmarks(nextList);
    setNotice(persisted ? '已保存到本地书签。' : '已添加，但浏览器本地存储不可用，刷新后会丢失。');
    resetForm();
    setAdding(false);
  };

  const removeCustom = (bookmark: BookmarkItem) => {
    if (!bookmark.custom) return;
    if (!window.confirm(`从本地书签里删除「${bookmark.title}」？`)) return;
    const next = customBookmarks.filter((item) => item.id !== bookmark.id);
    setCustomBookmarks(next);
    saveCustomBookmarks(next);
    setNotice('已删除本地书签。');
  };

  return (
    <div className="w-full pt-2 space-y-5">
      <PageTitle
        title="书签收藏"
        subtitle="AI Agent 开发真正用得上的官方文档、工程模板与评估入口"
        icon={<Bookmark size={22} />}
        action={
          <button
            onClick={() => {
              setAdding((value) => !value);
              setFormError('');
              setNotice('');
            }}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-[#06b6d4] rounded-lg hover:bg-[#0891b2] transition-colors"
          >
            {adding ? <X size={16} /> : <Plus size={16} />}
            {adding ? '收起' : '添加书签'}
          </button>
        }
      />

      <div className="rounded-xl border border-[color-mix(in_srgb,var(--accent)_16%,var(--border-light))] bg-[color-mix(in_srgb,var(--accent)_5%,var(--bg-elevated))] px-4 py-3">
        <div className="flex items-start gap-2.5">
          <Sparkles size={16} className="mt-0.5 shrink-0 text-[var(--accent)]" />
          <div className="min-w-0 text-xs leading-5 text-[var(--text-secondary)]">
            <p className="font-medium text-[var(--text-primary)]">先按这条线看，不要从收藏夹里随机点</p>
            <p className="mt-0.5">
              FastAPI 跑通接口 → LangGraph 编排状态 → MCP 接工具 → RAGAS 做评估 → vLLM / Docker 交付；
              下面标「必看」的就是这条主线上的节点。
            </p>
          </div>
        </div>
      </div>

      {adding && (
        <form
          onSubmit={handleAdd}
          className="rounded-xl border border-[var(--border-light)] bg-[var(--bg-elevated)] p-4 space-y-3"
        >
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-xs text-[var(--text-secondary)]">
              <span>标题</span>
              <input
                value={form.title}
                onChange={(event) => setForm((value) => ({ ...value, title: event.target.value }))}
                placeholder="例如：FastAPI 官方文档"
                className="w-full rounded-lg border border-[var(--border-light)] bg-[var(--bg-base)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
            </label>
            <label className="space-y-1 text-xs text-[var(--text-secondary)]">
              <span>链接</span>
              <input
                value={form.url}
                onChange={(event) => setForm((value) => ({ ...value, url: event.target.value }))}
                placeholder="https://..."
                className="w-full rounded-lg border border-[var(--border-light)] bg-[var(--bg-base)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
            </label>
            <label className="space-y-1 text-xs text-[var(--text-secondary)]">
              <span>分类</span>
              <select
                value={form.category}
                onChange={(event) =>
                  setForm((value) => ({ ...value, category: event.target.value as BookmarkCategory }))
                }
                className="w-full rounded-lg border border-[var(--border-light)] bg-[var(--bg-base)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              >
                {BOOKMARK_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs text-[var(--text-secondary)]">
              <span>一句话说明（可选）</span>
              <input
                value={form.description}
                onChange={(event) => setForm((value) => ({ ...value, description: event.target.value }))}
                placeholder="为什么值得收藏"
                className="w-full rounded-lg border border-[var(--border-light)] bg-[var(--bg-base)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
            </label>
          </div>
          {formError && <p className="text-xs text-[var(--danger)]">{formError}</p>}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-medium text-white hover:opacity-90 transition-opacity"
            >
              保存书签
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                resetForm();
              }}
              className="rounded-lg px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-base)] transition-colors"
            >
              取消
            </button>
            <span className="ml-auto text-[11px] text-[var(--text-muted)]">自定义书签只存在本机浏览器</span>
          </div>
        </form>
      )}

      {notice && <p className="text-xs text-[var(--success)]">{notice}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1 max-w-md">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜标题、用途、标签，例如 FastAPI / 权限 / 评估"
            aria-label="搜索书签"
            className="w-full pl-10 pr-9 py-2.5 bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="清空搜索"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-base)]"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {BOOKMARK_FILTERS.map((item) => {
            const active = filter === item;
            return (
              <button
                key={item}
                onClick={() => setFilter(item)}
                className={`px-3 py-2 text-xs rounded-lg transition-colors ${
                  active
                    ? 'bg-[var(--bg-accent)] text-[var(--accent)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-base)]'
                }`}
              >
                {item}
                <span className="ml-1 text-[10px] opacity-70">{counts[item] ?? 0}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs text-[var(--text-muted)]">
          当前 <strong className="text-[var(--text-primary)]">{filtered.length}</strong> 个入口
          {filter !== '全部' ? ` · ${filter}` : ''}
          {query ? ` · 搜索「${query}」` : ''}
        </p>
        <p className="text-[11px] text-[var(--text-muted)]">只收官方文档、官方模板/示例和工程参考站</p>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border-light)] px-6 py-12 text-center">
          <Search size={24} className="mx-auto text-[var(--text-muted)]" />
          <p className="mt-3 text-sm text-[var(--text-secondary)]">没有匹配的书签。换个关键词，或者把筛选清掉。</p>
          <button
            onClick={() => {
              setQuery('');
              setFilter('全部');
            }}
            className="mt-3 text-xs text-[var(--accent)] hover:underline"
          >
            清空筛选
          </button>
        </div>
      ) : (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
        >
          {filtered.map((bookmark) => (
            <article
              key={bookmark.id}
              className="group relative flex min-h-[172px] flex-col rounded-xl border border-[var(--border-light)] bg-[var(--bg-elevated)] p-4 transition-all hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--border-light))] hover:shadow-md"
            >
              <a
                href={bookmark.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-w-0 flex-1 flex-col"
                aria-label={`打开 ${bookmark.title}`}
              >
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[var(--bg-base)] text-xl">
                    {bookmark.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h3 className="text-sm font-semibold leading-snug text-[var(--text-primary)] group-hover:text-[#06b6d4] transition-colors">
                        {bookmark.title}
                      </h3>
                      {bookmark.mustRead && (
                        <span className="rounded bg-[color-mix(in_srgb,var(--warn)_15%,transparent)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--warn)]">
                          必看
                        </span>
                      )}
                      {bookmark.language === 'zh' && (
                        <span className="rounded bg-[var(--bg-base)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">
                          中文
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">
                      {bookmark.description}
                    </p>
                    <p className="mt-2 text-[11px] leading-4 text-[var(--text-muted)]">
                      <span className="font-medium text-[var(--text-secondary)]">为什么放这：</span>
                      {bookmark.why}
                    </p>
                  </div>
                </div>
              </a>
              <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[var(--border-light)] pt-2.5">
                <span className="text-[11px] text-[var(--text-muted)]">{hostOf(bookmark.url)}</span>
                <span className="text-[11px] text-[var(--border-medium)]">·</span>
                <span className="rounded bg-[var(--bg-base)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">
                  {bookmark.category}
                </span>
                {bookmark.tags.slice(0, 2).map((tag) => (
                  <span key={tag} className="text-[10px] text-[var(--text-muted)]">
                    #{tag}
                  </span>
                ))}
                {bookmark.custom ? (
                  <button
                    type="button"
                    onClick={() => removeCustom(bookmark)}
                    className="ml-auto inline-flex items-center gap-1 rounded p-1 text-[10px] text-[var(--text-muted)] hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] hover:text-[var(--danger)]"
                    title="删除自定义书签"
                  >
                    <Trash2 size={12} />
                    删除
                  </button>
                ) : (
                  <ExternalLink
                    size={13}
                    className="ml-auto text-[var(--border-medium)] transition-colors group-hover:text-[#06b6d4]"
                  />
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
};
