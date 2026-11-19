import { useState, useMemo, memo, useRef, useEffect } from 'react';
import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react';
import type { CategoryTreeWithVideos } from '../../lib/videoApi';

interface CategoryTreeProps {
  nodes: CategoryTreeWithVideos[];
  selectedIds: Set<number>;
  onToggle: (node: CategoryTreeWithVideos) => void;
}

export function getDescendantIds(node: CategoryTreeWithVideos): number[] {
  const ids: number[] = [node.id];
  for (const child of node.children as CategoryTreeWithVideos[]) {
    const childIds = getDescendantIds(child);
    for (const id of childIds) ids.push(id);
  }
  return ids;
}

export function buildDescendantMap(nodes: CategoryTreeWithVideos[]): Map<number, number[]> {
  const map = new Map<number, number[]>();
  function walk(node: CategoryTreeWithVideos): number[] {
    const ids: number[] = [node.id];
    for (const child of node.children as CategoryTreeWithVideos[]) {
      const childIds = walk(child);
      for (const id of childIds) ids.push(id);
    }
    map.set(node.id, ids);
    return ids;
  }
  for (const node of nodes) walk(node);
  return map;
}

const TreeNodeRow = memo(function TreeNodeRow({
  node,
  level,
  selectedIds,
  onToggle,
  descendantMap,
}: {
  node: CategoryTreeWithVideos;
  level: number;
  selectedIds: Set<number>;
  onToggle: (node: CategoryTreeWithVideos) => void;
  descendantMap: Map<number, number[]>;
}) {
  // Default collapse nodes deeper than level 1 to avoid rendering too many DOM nodes at once
  const [expanded, setExpanded] = useState(level < 1);
  const hasChildren = node.children.length > 0;

  const descendantIds = descendantMap.get(node.id) ?? [node.id];
  const allChecked = useMemo(
    () => descendantIds.every((id) => selectedIds.has(id)),
    [descendantIds, selectedIds]
  );
  const someChecked = useMemo(
    () => !allChecked && descendantIds.some((id) => selectedIds.has(id)),
    [allChecked, descendantIds, selectedIds]
  );
  const checkboxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = someChecked;
    }
  }, [someChecked]);

  return (
    <div>
      <div
        className="flex min-w-0 items-center gap-1.5 rounded-md py-1 pr-2 hover:bg-[var(--bg-accent)]"
        style={{ paddingLeft: `${level * 16 + 4}px` }}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-muted)] transition-colors ${hasChildren ? 'hover:text-[var(--accent)]' : 'opacity-0'}`}
          disabled={!hasChildren}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={allChecked}
            ref={checkboxRef}
            onChange={() => onToggle(node)}
            className="h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
          />
          {allChecked || someChecked ? <FolderOpen size={14} className="shrink-0 text-[var(--accent)]" /> : <Folder size={14} className="shrink-0 text-[var(--text-muted)]" />}
          <span className="min-w-0 truncate text-[12px] text-[var(--text-primary)]" title={node.full_path}>
            {node.name}
          </span>
          <span className="shrink-0 text-[11px] text-[var(--text-muted)]">({node.video_count})</span>
        </label>
      </div>
      {hasChildren && expanded && (
        <div>
          {(node.children as CategoryTreeWithVideos[]).map((child) => (
            <TreeNodeRow key={child.id} node={child} level={level + 1} selectedIds={selectedIds} onToggle={onToggle} descendantMap={descendantMap} />
          ))}
        </div>
      )}
    </div>
  );
});

function deduplicateTree(nodes: CategoryTreeWithVideos[], seen = new Set<number>()): CategoryTreeWithVideos[] {
  const result: CategoryTreeWithVideos[] = [];
  for (const node of nodes) {
    if (seen.has(node.id)) {
      console.warn('CategoryTree: duplicate node id detected, skipping:', node.id, node.full_path);
      continue;
    }
    seen.add(node.id);
    const dedupedChildren = deduplicateTree(node.children as CategoryTreeWithVideos[], seen);
    result.push({ ...node, children: dedupedChildren });
  }
  return result;
}

export function CategoryTree({ nodes, selectedIds, onToggle }: CategoryTreeProps) {
  if (nodes.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border-light)] px-3 py-6 text-center text-xs text-[var(--text-muted)]">
        暂无目录
      </div>
    );
  }

  const { uniqueNodes, descendantMap } = useMemo(() => {
    const unique = deduplicateTree(nodes);
    const map = buildDescendantMap(unique);
    return { uniqueNodes: unique, descendantMap: map };
  }, [nodes]);

  return (
    <div className="min-w-0 space-y-0.5">
      {uniqueNodes.map((node) => (
        <TreeNodeRow key={node.id} node={node} level={0} selectedIds={selectedIds} onToggle={onToggle} descendantMap={descendantMap} />
      ))}
    </div>
  );
}

export function collectVideoIds(nodes: CategoryTreeWithVideos[], selectedIds: Set<number>): number[] {
  const ids = new Set<number>();
  function collectSubtree(node: CategoryTreeWithVideos) {
    for (const vid of (node.video_ids ?? [])) ids.add(vid);
    for (const child of node.children as CategoryTreeWithVideos[]) collectSubtree(child);
  }
  function walk(node: CategoryTreeWithVideos) {
    if (selectedIds.has(node.id)) {
      collectSubtree(node);
    }
    for (const child of node.children as CategoryTreeWithVideos[]) walk(child);
  }
  for (const node of nodes) walk(node);
  return Array.from(ids);
}
