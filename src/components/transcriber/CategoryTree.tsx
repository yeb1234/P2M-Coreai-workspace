import { useState, useMemo, memo } from 'react';
import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react';
import type { CategoryTreeWithVideos } from '../../lib/videoApi';

interface CategoryTreeProps {
  nodes: CategoryTreeWithVideos[];
  selectedIds: Set<number>;
  onToggle: (node: CategoryTreeWithVideos) => void;
}

function getDescendantIds(node: CategoryTreeWithVideos): number[] {
  const ids: number[] = [node.id];
  for (const child of node.children as CategoryTreeWithVideos[]) {
    ids.push(...getDescendantIds(child));
  }
  return ids;
}

const TreeNodeRow = memo(function TreeNodeRow({
  node,
  level,
  selectedIds,
  onToggle,
}: {
  node: CategoryTreeWithVideos;
  level: number;
  selectedIds: Set<number>;
  onToggle: (node: CategoryTreeWithVideos) => void;
}) {
  // Default collapse nodes deeper than level 1 to avoid rendering too many DOM nodes at once
  const [expanded, setExpanded] = useState(level < 1);
  const hasChildren = node.children.length > 0;

  const descendantIds = useMemo(() => getDescendantIds(node), [node]);
  const allChecked = useMemo(
    () => descendantIds.every((id) => selectedIds.has(id)),
    [descendantIds, selectedIds]
  );
  const someChecked = useMemo(
    () => !allChecked && descendantIds.some((id) => selectedIds.has(id)),
    [allChecked, descendantIds, selectedIds]
  );

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
            ref={(el) => {
              if (el) el.indeterminate = someChecked;
            }}
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
            <TreeNodeRow key={child.id} node={child} level={level + 1} selectedIds={selectedIds} onToggle={onToggle} />
          ))}
        </div>
      )}
    </div>
  );
});

export function CategoryTree({ nodes, selectedIds, onToggle }: CategoryTreeProps) {
  if (nodes.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border-light)] px-3 py-6 text-center text-xs text-[var(--text-muted)]">
        暂无目录
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-0.5">
      {nodes.map((node) => (
        <TreeNodeRow key={node.id} node={node} level={0} selectedIds={selectedIds} onToggle={onToggle} />
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
