export interface NavGroup<T extends string> {
  label: string;
  ids: readonly T[];
}

/**
 * Turn the user's flat nav order into the visual order used by the sidebar.
 *
 * Groups own the section order (日常 → 学习 → 工具), while the user's
 * persisted order owns the order inside each section. The previous
 * implementation iterated `group.ids` and only used `navOrder` as an
 * allow-list, so every drag looked successful in the store but the DOM
 * never moved.
 */
export function groupNavOrder<T extends string>(
  navOrder: readonly T[],
  groups: readonly NavGroup<T>[],
): T[] {
  const seen = new Set<T>();
  const out: T[] = [];

  for (const group of groups) {
    for (const id of navOrder) {
      if (!seen.has(id) && group.ids.includes(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }

  // Keep unknown ids visible instead of silently dropping them.
  for (const id of navOrder) {
    if (!seen.has(id)) out.push(id);
  }

  return out;
}
