import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  FileCode2,
  GitBranch,
  GitCommit,
  History,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Tag,
  Upload,
} from 'lucide-react';
import type {
  AssetDiff,
  AssetRepoSummary,
  AssetTreeEntry,
  AssetWorkingStatus,
  AssetAuditEvent,
  AssetCommitInfo,
} from '../../lib/assetRegistryApi';
import {
  commitAssetChanges,
  createAssetBranch,
  createAssetTag,
  getAssetAudit,
  getAssetCommits,
  getAssetDiff,
  getAssetFile,
  getAssetRepository,
  getAssetTree,
  getAssetWorkingStatus,
  importAssetWorkingCopy,
  listAssetRepositories,
  publishAssetCommit,
  rollbackAssetBranch,
} from '../../lib/assetRegistryApi';

const CATEGORY_LABEL: Record<string, string> = {
  prompt: '提示词',
  retrieval: '检索',
  vector: '向量',
  llm: 'LLM',
  database: '数据库',
  governance: '治理',
  other: '其他',
};

const CATEGORY_ORDER = ['prompt', 'retrieval', 'vector', 'llm', 'database', 'governance', 'other'];

function formatTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function StatCard({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-light)] bg-[var(--bg-base)] px-3 py-2.5">
      <div className="text-[11px] text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-[var(--text-primary)]">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">{hint}</div>}
    </div>
  );
}

function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'ok' | 'warn' | 'accent' }) {
  const cls =
    tone === 'ok'
      ? 'border-[var(--success)]/30 bg-[var(--success-bg)] text-[var(--success)]'
      : tone === 'warn'
        ? 'border-[var(--warn)]/30 bg-[var(--warn-bg)] text-[var(--warn)]'
        : tone === 'accent'
          ? 'border-[var(--accent)]/30 bg-[var(--warn-bg)] text-[var(--accent)]'
          : 'border-[var(--border-light)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]';
  return <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] ${cls}`}>{children}</span>;
}

export function AssetRegistrySection({ standalone = false }: { standalone?: boolean }) {
  const [repo, setRepo] = useState<AssetRepoSummary | null>(null);
  const [branch, setBranch] = useState('main');
  const [tree, setTree] = useState<AssetTreeEntry[]>([]);
  const [commits, setCommits] = useState<AssetCommitInfo[]>([]);
  const [audit, setAudit] = useState<AssetAuditEvent[]>([]);
  const [status, setStatus] = useState<AssetWorkingStatus | null>(null);
  const [selected, setSelected] = useState<AssetTreeEntry | null>(null);
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState('');
  const [message, setMessage] = useState('');
  const [diff, setDiff] = useState<AssetDiff | null>(null);
  const [tab, setTab] = useState<'files' | 'history' | 'audit'>('files');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error' | 'warn'; text: string } | null>(null);
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<'branch' | 'tag' | null>(null);
  const [dialogValue, setDialogValue] = useState('');

  const toast = useCallback((tone: 'ok' | 'error' | 'warn', text: string) => {
    setFeedback({ tone, text });
    window.setTimeout(() => setFeedback(null), 6000);
  }, []);

  const loadRepo = useCallback(async (ref = 'main') => {
    setBusy(true);
    try {
      const repos = await listAssetRepositories();
      const first = repos[0];
      if (!first) throw new Error('没有可用版本库');
      const detail = await getAssetRepository(first.slug);
      setRepo(detail);
      const selectedBranch = detail.branches.some((item) => item.name === ref)
        ? ref
        : detail.default_branch;
      setBranch(selectedBranch);
      const [nextTree, nextCommits, nextStatus, nextAudit] = await Promise.all([
        getAssetTree(detail.slug, selectedBranch),
        getAssetCommits(detail.slug),
        getAssetWorkingStatus(detail.slug, selectedBranch),
        getAssetAudit(detail.slug),
      ]);
      setTree(nextTree);
      setCommits(nextCommits);
      setStatus(nextStatus);
      setAudit(nextAudit);
      if (nextTree.length) {
        const pick = nextTree.find((item) => item.path === selected?.path) ?? nextTree[0];
        setSelected(pick);
        const file = await getAssetFile(detail.slug, pick.path, selectedBranch);
        setContent(file.content);
        setOriginal(file.content);
      } else {
        setSelected(null);
        setContent('');
        setOriginal('');
      }
    } catch (err) {
      toast('error', err instanceof Error ? err.message : '加载配置版本库失败');
    } finally {
      setBusy(false);
    }
  }, [selected?.path, toast]);

  useEffect(() => {
    void loadRepo('main');
    // 只在挂载时加载一次；后续切换分支显式调用 loadRepo。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const head = useMemo(
    () => repo?.branches.find((item) => item.name === branch)?.head ?? null,
    [repo, branch],
  );
  const headCommit = useMemo(
    () => commits.find((item) => item.hash === head) ?? null,
    [commits, head],
  );

  const dirty = content !== original;
  const grouped = useMemo(() => {
    const filtered = tree.filter((item) => {
      const q = search.trim().toLowerCase();
      return !q || item.path.toLowerCase().includes(q) || item.title.toLowerCase().includes(q);
    });
    return CATEGORY_ORDER.map((category) => ({
      category,
      items: filtered.filter((item) => item.category === category),
    })).filter((group) => group.items.length > 0);
  }, [tree, search]);

  const refresh = useCallback(async (ref = branch) => {
    await loadRepo(ref);
  }, [branch, loadRepo]);

  const switchBranch = async (next: string) => {
    setBranch(next);
    await loadRepo(next);
  };

  const openFile = async (entry: AssetTreeEntry) => {
    if (!repo) return;
    setBusy(true);
    setTab('files');
    setDiff(null);
    try {
      const file = await getAssetFile(repo.slug, entry.path, branch);
      setSelected(entry);
      setContent(file.content);
      setOriginal(file.content);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : '读取资产失败');
    } finally {
      setBusy(false);
    }
  };

  const handleCommit = async () => {
    if (!repo || !selected) return;
    if (!message.trim()) {
      toast('warn', '先写提交说明，说明这次改了什么以及为什么');
      return;
    }
    if (!dirty) {
      toast('warn', '内容没有变化');
      return;
    }
    setBusy(true);
    try {
      await commitAssetChanges(repo.slug, {
        branch,
        message: message.trim(),
        changes: [{ path: selected.path, content }],
        base_commit: head,
      });
      setMessage('');
      toast('ok', '已提交。对比通过后再发布会写回 configs/ 工作区。');
      await refresh();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : '提交失败');
    } finally {
      setBusy(false);
    }
  };

  const handlePublish = async () => {
    if (!repo || !head) return;
    setBusy(true);
    try {
      const result = await publishAssetCommit(repo.slug, { commit_hash: head, branch });
      toast('ok', `已发布 ${result.files.length} 个文件：${result.note}`);
      await refresh();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : '发布失败');
    } finally {
      setBusy(false);
    }
  };

  const handleCompare = async () => {
    if (!repo || !head) return;
    const parent = commits.find((item) => item.hash === head)?.parent;
    if (!parent) {
      toast('warn', '当前提交没有父提交，无法对比');
      return;
    }
    setBusy(true);
    setTab('files');
    try {
      setDiff(await getAssetDiff(repo.slug, parent, head));
    } catch (err) {
      toast('error', err instanceof Error ? err.message : '对比失败');
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    if (!repo) return;
    setBusy(true);
    try {
      await importAssetWorkingCopy(repo.slug, {
        branch,
        message: message.trim() || 'chore(config): 导入工作区变更',
      });
      setMessage('');
      toast('ok', '工作区差异已导入为新提交');
      await refresh();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : '导入失败');
    } finally {
      setBusy(false);
    }
  };

  const handleRollback = async (commit: AssetCommitInfo) => {
    if (!repo) return;
    if (!window.confirm(`把 ${branch} 回滚到 ${commit.short_hash}？会创建一个新的回滚提交，历史不会丢失。`)) return;
    setBusy(true);
    try {
      await rollbackAssetBranch(repo.slug, {
        branch,
        target_ref: commit.hash,
        message: `rollback ${branch} to ${commit.short_hash}`,
      });
      toast('ok', '已创建回滚提交，确认后再发布会生效');
      await refresh();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : '回滚失败');
    } finally {
      setBusy(false);
    }
  };

  const submitDialog = async () => {
    if (!repo || !dialog) return;
    if (!dialogValue.trim()) {
      toast('warn', '名称不能为空');
      return;
    }
    setBusy(true);
    try {
      if (dialog === 'branch') {
        await createAssetBranch(repo.slug, { name: dialogValue.trim(), from_ref: branch });
        setBranch(dialogValue.trim());
        toast('ok', `分支 ${dialogValue.trim()} 已创建`);
        await loadRepo(dialogValue.trim());
      } else {
        await createAssetTag(repo.slug, { name: dialogValue.trim(), ref: branch, message: message.trim() });
        toast('ok', `标签 ${dialogValue.trim()} 已创建`);
        await refresh();
      }
      setDialog(null);
      setDialogValue('');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const feedbackColor =
    feedback?.tone === 'ok'
      ? 'text-[var(--success)]'
      : feedback?.tone === 'warn'
        ? 'text-[var(--warn)]'
        : 'text-[var(--danger)]';

  return (
    <div className={`space-y-3 ${standalone ? 'w-full' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-[var(--accent)]" />
            <h3 className="text-base font-semibold text-[var(--text-primary)]">配置资产版本库</h3>
            <Badge tone="accent">DB-native Git</Badge>
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--text-secondary)]">
            提示词、检索与向量参数、LLM 路由、数据库连接池、工具治理统一纳入 PostgreSQL 版本库。提交只进数据库；点击发布会把指定提交原子写回
            <span className="mx-1 font-medium text-[var(--text-primary)]">configs/</span>并热刷新运行时缓存。
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!standalone && (
            <button
              type="button"
              onClick={() => window.open('/asset-registry.html', '_blank', 'noopener,noreferrer')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-light)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-base)]"
            >
              <ExternalLink size={14} /> 单独打开
            </button>
          )}
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-light)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-base)] disabled:opacity-50"
          >
            <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> 刷新
          </button>
        </div>
      </div>

      {feedback && (
        <div className={`flex items-start gap-2 rounded-lg border border-[var(--border-light)] bg-[var(--bg-base)] px-3 py-2 text-xs ${feedbackColor}`}>
          {feedback.tone === 'ok' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
          <span className="leading-5">{feedback.text}</span>
        </div>
      )}

      {repo && (
        <>
          <div className={`grid gap-2 ${standalone ? 'grid-cols-2 lg:grid-cols-5' : 'grid-cols-2 lg:grid-cols-4'}`}>
            <StatCard label="当前分支" value={<span className="inline-flex items-center gap-1"><GitBranch size={13} />{branch}</span>} hint={repo.branches.find((b) => b.name === branch)?.is_default ? '默认分支' : '工作分支'} />
            <StatCard label="HEAD" value={<span className="font-mono text-xs">{head ? head.slice(0, 10) : '—'}</span>} hint={headCommit?.message.slice(0, 24) || '暂无提交'} />
            <StatCard label="纳管资产" value={`${repo.assets_count} 项`} hint={`${tree.length} 个文件在当前树`} />
            <StatCard label="工作区" value={status?.dirty ? '有未提交差异' : '干净'} hint={status?.dirty ? `${status.changes.length} 个文件待导入` : '与工作区一致'} />
            {standalone && <StatCard label="标签" value={`${repo.tags.length} 个`} hint={repo.tags[0]?.name || '尚未打标签'} />}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={branch}
              onChange={(e) => void switchBranch(e.target.value)}
              className="rounded-lg border border-[var(--border-light)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-xs text-[var(--text-primary)]"
            >
              {repo.branches.map((item) => (
                <option key={item.name} value={item.name}>{item.name} · {item.head?.slice(0, 8) || 'empty'}</option>
              ))}
            </select>
            <button type="button" onClick={() => { setDialog('branch'); setDialogValue(''); }} className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-light)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-base)]"><Plus size={13} /> 新建分支</button>
            <button type="button" onClick={() => { setDialog('tag'); setDialogValue(''); }} className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-light)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-base)]"><Tag size={13} /> 打标签</button>
            <button type="button" onClick={() => void handleCompare()} disabled={busy || !head} className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-light)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-base)] disabled:opacity-50"><GitCommit size={13} /> 对比上一提交</button>
            <button type="button" onClick={() => void handleImport()} disabled={busy || !status?.dirty} className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-light)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-base)] disabled:opacity-50"><Upload size={13} /> 导入工作区</button>
            <button type="button" onClick={() => void handlePublish()} disabled={busy || !head} className="ml-auto inline-flex items-center gap-1 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"><Upload size={13} /> 发布 HEAD 到 configs/</button>
          </div>

          {dialog && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--accent)]/30 bg-[var(--warn-bg)] px-3 py-2">
              <span className="text-xs text-[var(--text-primary)]">{dialog === 'branch' ? '分支名' : '标签名'}</span>
              <input value={dialogValue} onChange={(e) => setDialogValue(e.target.value)} placeholder={dialog === 'branch' ? 'feat/retrieval-v2' : 'v7.0.0'} className="w-48 rounded border border-[var(--border-light)] bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[var(--text-primary)]" />
              <span className="text-[11px] text-[var(--text-muted)]">基于 {branch} @ {head?.slice(0, 8)}</span>
              <button type="button" onClick={() => void submitDialog()} className="rounded bg-[var(--accent)] px-2.5 py-1 text-xs text-white">确认</button>
              <button type="button" onClick={() => setDialog(null)} className="rounded border border-[var(--border-light)] px-2.5 py-1 text-xs text-[var(--text-secondary)]">取消</button>
            </div>
          )}

          <div className="flex gap-1 border-b border-[var(--border-light)] pb-1">
            {[
              { id: 'files' as const, label: '资产与编辑' },
              { id: 'history' as const, label: `提交历史 (${commits.length})` },
              { id: 'audit' as const, label: '审计日志' },
            ].map((item) => (
              <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`rounded-t px-3 py-1.5 text-xs ${tab === item.id ? 'bg-[var(--bg-base)] font-medium text-[var(--accent)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>{item.label}</button>
            ))}
          </div>

          {tab === 'files' && (
            <div className={`grid gap-3 ${standalone ? 'lg:grid-cols-[240px_1fr]' : 'lg:grid-cols-[190px_1fr]'}`}>
              <div className="min-w-0 rounded-lg border border-[var(--border-light)] bg-[var(--bg-base)]">
                <div className="border-b border-[var(--border-light)] p-2">
                  <div className="flex items-center gap-1.5 rounded border border-[var(--border-light)] bg-[var(--bg-elevated)] px-2 py-1">
                    <Search size={12} className="text-[var(--text-muted)]" />
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索路径或标题" className="min-w-0 flex-1 bg-transparent text-[11px] text-[var(--text-primary)] outline-none" />
                  </div>
                </div>
                <div className="max-h-[420px] overflow-y-auto p-1.5">
                  {grouped.map((group) => (
                    <div key={group.category} className="mb-2">
                      <div className="px-1.5 py-1 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{CATEGORY_LABEL[group.category] || group.category}</div>
                      {group.items.map((item) => (
                        <button
                          key={item.path}
                          type="button"
                          onClick={() => void openFile(item)}
                          className={`mb-0.5 flex w-full items-start gap-1.5 rounded px-1.5 py-1.5 text-left ${selected?.path === item.path ? 'bg-[var(--warn-bg)] text-[var(--accent)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'}`}
                        >
                          <FileCode2 size={13} className="mt-0.5 shrink-0" />
                          <span className="min-w-0">
                            <span className="block truncate text-[11px] font-medium">{item.title}</span>
                            <span className="block truncate font-mono text-[10px] opacity-70">{item.path}</span>
                          </span>
                          {
                            item.path === selected?.path && dirty
                              ? <span className="ml-auto mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--warn)]" />
                              : null
                          }
                        </button>
                      ))}
                    </div>
                  ))}
                  {!grouped.length && <div className="p-3 text-[11px] text-[var(--text-muted)]">没有匹配的资产</div>}
                </div>
              </div>

              <div className="min-w-0 rounded-lg border border-[var(--border-light)] bg-[var(--bg-base)]">
                {selected ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-light)] px-3 py-2">
                      <span className="font-mono text-[11px] text-[var(--text-primary)]">{selected.path}</span>
                      <Badge>{CATEGORY_LABEL[selected.category] || selected.category}</Badge>
                      {dirty && <Badge tone="warn">未提交</Badge>}
                      <span className="ml-auto text-[10px] text-[var(--text-muted)]">{content.length} 字符 · blob {selected.blob.slice(0, 8)}</span>
                    </div>
                    <textarea
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      spellCheck={false}
                      className="h-[300px] w-full resize-y bg-[var(--bg-elevated)] p-3 font-mono text-[12px] leading-5 text-[var(--text-primary)] outline-none"
                    />
                    <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-light)] px-3 py-2">
                      <input
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="提交说明：改了什么、为什么改"
                        className="min-w-[220px] flex-1 rounded border border-[var(--border-light)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-xs text-[var(--text-primary)]"
                      />
                      <button type="button" onClick={() => void handleCommit()} disabled={busy || !dirty} className="inline-flex items-center gap-1 rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"><GitCommit size={13} /> 提交到 {branch}</button>
                    </div>
                  </>
                ) : (
                  <div className="p-6 text-center text-xs text-[var(--text-muted)]">选择一个资产开始编辑</div>
                )}
              </div>
            </div>
          )}

          {tab === 'files' && diff && (
            <div className="rounded-lg border border-[var(--border-light)] bg-[var(--bg-base)]">
              <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-light)] px-3 py-2">
                <ChevronRight size={14} className="text-[var(--accent)]" />
                <span className="text-xs font-medium text-[var(--text-primary)]">diff {diff.from.commit.slice(0, 8)} → {diff.to.commit.slice(0, 8)}</span>
                <Badge tone="ok">+{diff.stats.additions}</Badge>
                <Badge tone="warn">-{diff.stats.deletions}</Badge>
                <span className="text-[10px] text-[var(--text-muted)]">{diff.stats.files} 个文件</span>
                <button type="button" onClick={() => setDiff(null)} className="ml-auto text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">收起</button>
              </div>
              <div className="max-h-[360px] overflow-auto p-2">
                {diff.entries.map((entry) => (
                  <div key={entry.path} className="mb-2 last:mb-0">
                    <div className="mb-1 flex items-center gap-2 text-[11px]">
                      <Badge tone={entry.status === 'added' ? 'ok' : entry.status === 'deleted' ? 'warn' : 'accent'}>{entry.status}</Badge>
                      <span className="font-mono text-[var(--text-primary)]">{entry.path}</span>
                      <span className="text-[10px] text-[var(--text-muted)]">+{entry.additions} / -{entry.deletions}</span>
                    </div>
                    <pre className="overflow-x-auto rounded bg-[var(--bg-elevated)] p-2 font-mono text-[11px] leading-4 text-[var(--text-secondary)]">{entry.patch || '（内容为二进制或空）'}</pre>
                  </div>
                ))}
                {!diff.entries.length && <div className="p-3 text-[11px] text-[var(--text-muted)]">两个提交之间没有差异</div>}
              </div>
            </div>
          )}

          {tab === 'history' && (
            <div className="overflow-hidden rounded-lg border border-[var(--border-light)] bg-[var(--bg-base)]">
              <div className="divide-y divide-[var(--border-light)]">
                {commits.map((commit) => (
                  <div key={commit.hash} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-secondary)]">{commit.short_hash}</span>
                    <Badge tone={commit.kind === 'merge' ? 'accent' : commit.kind === 'rollback' ? 'warn' : 'neutral'}>{commit.kind}</Badge>
                    <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-primary)]">{commit.message}</span>
                    <span className="text-[10px] text-[var(--text-muted)]">{commit.author} · {formatTime(commit.created_at)}</span>
                    {commit.hash === head && <Badge tone="ok">HEAD</Badge>}
                    <button type="button" onClick={() => void handleRollback(commit)} className="inline-flex items-center gap-1 rounded border border-[var(--border-light)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"><RotateCcw size={11} /> 回滚到此</button>
                  </div>
                ))}
                {!commits.length && <div className="p-4 text-xs text-[var(--text-muted)]">还没有提交</div>}
              </div>
            </div>
          )}

          {tab === 'audit' && (
            <div className="overflow-hidden rounded-lg border border-[var(--border-light)] bg-[var(--bg-base)]">
              <div className="divide-y divide-[var(--border-light)]">
                {audit.map((event) => (
                  <div key={event.id} className="flex items-start gap-2 px-3 py-2">
                    <History size={13} className="mt-0.5 text-[var(--text-muted)]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={event.action === 'publish' ? 'ok' : 'neutral'}>{event.action}</Badge>
                        <span className="text-xs text-[var(--text-primary)]">{event.actor}</span>
                        <span className="text-[10px] text-[var(--text-muted)]">{formatTime(event.created_at)}</span>
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[10px] text-[var(--text-secondary)]">
                        {event.detail ? JSON.stringify(event.detail) : '—'}
                      </div>
                    </div>
                  </div>
                ))}
                {!audit.length && <div className="p-4 text-xs text-[var(--text-muted)]">暂无审计事件</div>}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function AssetRegistryPage() {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-3 py-4 md:px-5">
      <AssetRegistrySection standalone />
    </div>
  );
}
