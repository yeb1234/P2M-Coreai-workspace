import { apiFetch } from './videoApi';

export interface AssetBranchInfo {
  name: string;
  head: string | null;
  is_default: boolean;
  protected: boolean;
  updated_at: string | null;
}

export interface AssetTagInfo {
  name: string;
  commit: string;
  message: string | null;
  created_at: string | null;
}

export interface AssetCommitInfo {
  hash: string;
  short_hash: string;
  parent: string | null;
  parent2: string | null;
  message: string;
  author: string;
  kind: string;
  created_at: string | null;
  tree: string;
}

export interface AssetRepoSummary {
  slug: string;
  name: string;
  description: string;
  default_branch: string;
  branches: AssetBranchInfo[];
  tags: AssetTagInfo[];
  latest_commit: AssetCommitInfo | null;
  assets_count: number;
}

export interface AssetTreeEntry {
  path: string;
  category: string;
  title: string;
  editable: boolean;
  blob: string;
  size: number;
  mode: string;
}

export interface AssetDiffEntry {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  additions: number;
  deletions: number;
  patch: string;
  truncated: boolean;
}

export interface AssetDiff {
  from: { ref: string; commit: string };
  to: { ref: string; commit: string };
  entries: AssetDiffEntry[];
  stats: { files: number; additions: number; deletions: number };
}

export interface AssetWorkingStatus {
  branch: string;
  head: string | null;
  dirty: boolean;
  changes: Array<{
    path: string;
    category: string;
    status: string;
    disk_size: number;
    committed_size: number;
  }>;
}

export interface AssetAuditEvent {
  id: number;
  action: string;
  actor: string;
  detail: Record<string, unknown> | null;
  created_at: string | null;
}

export async function listAssetRepositories(): Promise<AssetRepoSummary[]> {
  const data = await apiFetch<{ repos: AssetRepoSummary[] }>('/api/asset-registry/repos');
  return data.repos;
}

export async function getAssetRepository(slug: string): Promise<AssetRepoSummary> {
  return apiFetch<AssetRepoSummary>(`/api/asset-registry/repos/${encodeURIComponent(slug)}`);
}

export async function getAssetCommits(slug: string, limit = 50): Promise<AssetCommitInfo[]> {
  const data = await apiFetch<{ commits: AssetCommitInfo[] }>(
    `/api/asset-registry/repos/${encodeURIComponent(slug)}/commits?limit=${limit}`,
  );
  return data.commits;
}

export async function getAssetTree(slug: string, ref: string): Promise<AssetTreeEntry[]> {
  const data = await apiFetch<{ entries: AssetTreeEntry[] }>(
    `/api/asset-registry/repos/${encodeURIComponent(slug)}/tree?ref=${encodeURIComponent(ref)}`,
  );
  return data.entries;
}

export async function getAssetFile(
  slug: string,
  path: string,
  ref: string,
): Promise<{ content: string; blob: string; size: number; commit: string }> {
  return apiFetch(
    `/api/asset-registry/repos/${encodeURIComponent(slug)}/file?path=${encodeURIComponent(path)}&ref=${encodeURIComponent(ref)}`,
  );
}

export async function getAssetDiff(
  slug: string,
  fromRef: string,
  toRef: string,
): Promise<AssetDiff> {
  return apiFetch(
    `/api/asset-registry/repos/${encodeURIComponent(slug)}/diff?from=${encodeURIComponent(fromRef)}&to=${encodeURIComponent(toRef)}`,
  );
}

export async function getAssetWorkingStatus(
  slug: string,
  branch: string,
): Promise<AssetWorkingStatus> {
  return apiFetch(
    `/api/asset-registry/repos/${encodeURIComponent(slug)}/working-status?branch=${encodeURIComponent(branch)}`,
  );
}

export async function getAssetAudit(slug: string, limit = 50): Promise<AssetAuditEvent[]> {
  const data = await apiFetch<{ events: AssetAuditEvent[] }>(
    `/api/asset-registry/repos/${encodeURIComponent(slug)}/audit?limit=${limit}`,
  );
  return data.events;
}

export async function commitAssetChanges(
  slug: string,
  payload: { branch: string; message: string; changes: Array<{ path: string; content: string }>; base_commit: string | null },
): Promise<AssetCommitInfo> {
  const data = await apiFetch<{ commit: AssetCommitInfo }>(
    `/api/asset-registry/repos/${encodeURIComponent(slug)}/commits`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
  return data.commit;
}

export async function publishAssetCommit(
  slug: string,
  payload: { commit_hash: string; branch: string | null },
): Promise<{ status: string; commit: string; files: string[]; note: string }> {
  return apiFetch(`/api/asset-registry/repos/${encodeURIComponent(slug)}/publish`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function importAssetWorkingCopy(
  slug: string,
  payload: { branch: string; message: string },
): Promise<AssetCommitInfo> {
  const data = await apiFetch<{ commit: AssetCommitInfo }>(
    `/api/asset-registry/repos/${encodeURIComponent(slug)}/import-working`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
  return data.commit;
}

export async function createAssetBranch(
  slug: string,
  payload: { name: string; from_ref: string },
): Promise<{ name: string; head: string }> {
  return apiFetch(`/api/asset-registry/repos/${encodeURIComponent(slug)}/branches`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function createAssetTag(
  slug: string,
  payload: { name: string; ref: string; message: string },
): Promise<{ name: string; commit: string }> {
  return apiFetch(`/api/asset-registry/repos/${encodeURIComponent(slug)}/tags`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function rollbackAssetBranch(
  slug: string,
  payload: { branch: string; target_ref: string; message: string },
): Promise<AssetCommitInfo> {
  const data = await apiFetch<{ commit: AssetCommitInfo }>(
    `/api/asset-registry/repos/${encodeURIComponent(slug)}/rollback`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
  return data.commit;
}
