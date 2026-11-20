import React, { useCallback, useMemo, useState } from 'react';
import { Check, Clock3, Copy, FlaskConical, GitBranch, Package, Search, ShieldCheck } from 'lucide-react';
import { PAGES } from '../../config/pageRegistry';
import { PLUGIN_STAGE_LABEL, PLUGIN_VERSIONS } from '../../config/pluginVersions';
import type { PluginStage } from '../../config/pluginVersions';

type StageFilter = 'all' | PluginStage;
type GroupFilter = 'all' | '日常' | '学习' | '产品线' | '工具';

const STAGE_STYLE: Record<PluginStage, string> = {
  stable: 'border-[var(--success)]/30 bg-[var(--success-bg)] text-[var(--success)]',
  beta: 'border-[var(--warn)]/30 bg-[var(--warn-bg)] text-[var(--warn)]',
  dev: 'border-[var(--border-light)] bg-[var(--bg-base)] text-[var(--text-muted)]',
};

function StatCard({ label, value, hint }: { label: string; value: React.ReactNode; hint: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-[var(--border-light)] bg-[var(--bg-base)] px-3 py-2.5">
      <div className="text-[11px] text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-[var(--text-primary)]">{value}</div>
      <div className="mt-0.5 truncate text-[10px] text-[var(--text-muted)]">{hint}</div>
    </div>
  );
}

export function PluginVersionsSection() {
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState<StageFilter>('all');
  const [group, setGroup] = useState<GroupFilter>('all');
  const [copied, setCopied] = useState(false);

  const rows = useMemo(() => (
    PAGES.map((page) => ({
      id: page.id,
      label: page.label,
      path: page.path === '' ? '/' : `/${page.path}`,
      icon: page.icon,
      meta: PLUGIN_VERSIONS[page.id],
    })).sort((a, b) => b.meta.updatedAt.localeCompare(a.meta.updatedAt) || a.label.localeCompare(b.label, 'zh-CN'))
  ), []);

  const visibleRows = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (stage !== 'all' && row.meta.stage !== stage) return false;
      if (group !== 'all' && row.meta.group !== group) return false;
      if (!keyword) return true;
      return [row.label, row.path, row.meta.version, row.meta.summary]
        .some((value) => value.toLowerCase().includes(keyword));
    });
  }, [group, query, rows, stage]);

  const stableCount = rows.filter((row) => row.meta.stage === 'stable').length;
  const devCount = rows.filter((row) => row.meta.stage === 'dev').length;
  const latestDate = rows.reduce((latest, row) => (row.meta.updatedAt > latest ? row.meta.updatedAt : latest), '');
  const recentCount = rows.filter((row) => row.meta.updatedAt === latestDate).length;

  const copyLedger = useCallback(async () => {
    const payload = {
      generatedAt: new Date().toISOString(),
      plugins: rows.map((row) => ({
        id: row.id,
        label: row.label,
        path: row.path,
        ...row.meta,
      })),
    };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }, [rows]);

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="内部插件" value={`${rows.length} 个`} hint="全部页面入口" />
        <StatCard label="稳定版" value={`${stableCount} 个`} hint="可用功能已收口" />
        <StatCard label="开发中" value={`${devCount} 个`} hint="静态占位或半成品" />
        <StatCard label="最近更新" value={latestDate || '—'} hint={`${recentCount} 个插件同日更新`} />
      </div>

      <div className="rounded-lg border border-[var(--border-light)] bg-[var(--bg-elevated)]">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-light)] px-3 py-2.5">
          <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-md border border-[var(--border-light)] bg-[var(--bg-base)] px-2 py-1.5">
            <Search size={13} className="shrink-0 text-[var(--text-muted)]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索插件、路径、版本或变更"
              className="w-full bg-transparent text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
            />
          </div>
          <select
            value={stage}
            onChange={(event) => setStage(event.target.value as StageFilter)}
            className="rounded-md border border-[var(--border-light)] bg-[var(--bg-base)] px-2 py-1.5 text-xs text-[var(--text-secondary)] outline-none"
            aria-label="按阶段筛选"
          >
            <option value="all">全部阶段</option>
            <option value="stable">稳定</option>
            <option value="beta">公测</option>
            <option value="dev">开发中</option>
          </select>
          <select
            value={group}
            onChange={(event) => setGroup(event.target.value as GroupFilter)}
            className="rounded-md border border-[var(--border-light)] bg-[var(--bg-base)] px-2 py-1.5 text-xs text-[var(--text-secondary)] outline-none"
            aria-label="按分组筛选"
          >
            <option value="all">全部分组</option>
            <option value="日常">日常</option>
            <option value="学习">学习</option>
            <option value="产品线">产品线</option>
            <option value="工具">工具</option>
          </select>
          <button
            type="button"
            onClick={() => void copyLedger()}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-light)] bg-[var(--bg-base)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--accent)]"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? '已复制' : '复制台账'}
          </button>
        </div>

        <div className="divide-y divide-[var(--border-light)]/70">
          {visibleRows.map((row) => (
            <div key={row.id} className="flex items-start gap-2.5 px-3 py-2.5">
              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md border border-[var(--border-light)] bg-[var(--bg-base)] text-[var(--text-secondary)] [&>svg]:h-4 [&>svg]:w-4">
                {row.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="truncate text-xs font-medium text-[var(--text-primary)]">{row.label}</span>
                  <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${STAGE_STYLE[row.meta.stage]}`}>
                    {row.meta.stage === 'dev' ? <FlaskConical size={10} /> : <ShieldCheck size={10} />}
                    {PLUGIN_STAGE_LABEL[row.meta.stage]}
                  </span>
                  <span className="rounded bg-[var(--bg-base)] px-1.5 py-0.5 font-mono text-[10px] font-medium text-[var(--accent)]">
                    v{row.meta.version}
                  </span>
                  <span className="ml-auto whitespace-nowrap font-mono text-[10px] text-[var(--text-muted)]">{row.meta.updatedAt}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-[var(--text-muted)]">
                  <span className="font-mono">{row.path}</span>
                  <span>·</span>
                  <span>{row.meta.group}</span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">{row.meta.summary}</p>
              </div>
            </div>
          ))}
          {visibleRows.length === 0 && (
            <div className="px-4 py-10 text-center text-xs text-[var(--text-muted)]">没有匹配的插件</div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--border-light)] px-3 py-2 text-[10px] text-[var(--text-muted)]">
          <span className="inline-flex items-center gap-1"><Package size={11} /> {visibleRows.length} / {rows.length} 个插件</span>
          <span className="inline-flex items-center gap-1"><GitBranch size={11} /> 版本随代码提交，不提供运行时热插拔</span>
          <span className="inline-flex items-center gap-1"><Clock3 size={11} /> 改插件时同步 bump 版本与变更摘要</span>
        </div>
      </div>
    </div>
  );
}
