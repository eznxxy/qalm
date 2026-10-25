import { SuiteRow } from './suites.store';
import { SuitePathEntry, SuiteTreeNode, toSuiteDto } from './suites.types';

/**
 * Pure tree helpers for the suites endpoints. Keeping them free of SQL makes
 * the ordering/counting rules unit-testable without a database; the real SQL
 * path is covered by test/suites.e2e-spec.ts.
 */

/**
 * `case_count` is a SUBTREE count: cases in the suite plus every descendant,
 * soft-deleted cases already excluded by the caller's grouped query. Rolling
 * up depth-first (deepest first) means a single pass over the rows.
 */
export function rollupCaseCounts(
  rows: SuiteRow[],
  direct: ReadonlyMap<string, number>,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.parent_id !== null) totals.set(row.parent_id, totals.get(row.parent_id) ?? 0);
  }
  for (const row of rows) {
    totals.set(row.id, direct.get(row.id) ?? 0);
  }
  const deepestFirst = [...rows].sort((a, b) => b.depth - a.depth);
  for (const row of deepestFirst) {
    if (row.parent_id === null) continue;
    const own = totals.get(row.id) ?? 0;
    if (own === 0) continue;
    totals.set(row.parent_id, (totals.get(row.parent_id) ?? 0) + own);
  }
  return totals;
}

/** Turns the grouped `cases` query rows into a suite_id → count map. */
export function toCountMap(
  rows: Array<{ suite_id: string; count: number }>,
): Map<string, number> {
  return new Map(rows.map((row) => [row.suite_id, Number(row.count)]));
}

/**
 * Assembles the nested tree from a flat project listing. Children (and roots)
 * are ordered by `position`; children is always present, possibly [].
 */
export function buildSuiteTree(
  rows: SuiteRow[],
  caseCounts: ReadonlyMap<string, number>,
): SuiteTreeNode[] {
  const nodes = new Map<string, SuiteTreeNode>();
  for (const row of rows) {
    nodes.set(row.id, { ...toSuiteDto(row, caseCounts.get(row.id) ?? 0), children: [] });
  }
  const roots: SuiteTreeNode[] = [];
  for (const row of [...rows].sort((a, b) => a.position - b.position)) {
    const node = nodes.get(row.id);
    if (!node) continue;
    const parent = row.parent_id === null ? undefined : nodes.get(row.parent_id);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** Root → self trail for the GET /suites/:id breadcrumb. */
export function buildSuitePath(rows: SuiteRow[], suiteId: string): SuitePathEntry[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const trail: SuitePathEntry[] = [];
  let current = byId.get(suiteId);
  const guard = new Set<string>();
  while (current) {
    trail.push({ id: current.id, name: current.name });
    if (current.parent_id === null || guard.has(current.id)) break;
    guard.add(current.id);
    current = byId.get(current.parent_id);
  }
  return trail.reverse();
}

/**
 * Final dense order (1..n) of a sibling group after a drag: `incoming` items
 * are placed at their explicit positions, every other member keeps its
 * relative order behind them. Returns null when a position lands beyond the
 * end of the resulting group (a 400, not a silent clamp).
 */
export function arrangeSiblings(
  existingIds: string[],
  incoming: Array<{ id: string; position: number }>,
): string[] | null {
  const incomingIds = new Set(incoming.map((item) => item.id));
  const order = existingIds.filter((id) => !incomingIds.has(id));
  const placed = [...incoming].sort((a, b) => a.position - b.position);
  for (const item of placed) {
    if (item.position < 1 || item.position > order.length + 1) return null;
    order.splice(item.position - 1, 0, item.id);
  }
  return order;
}

/** Height of a subtree below `rootId` (0 for a leaf), from a flat listing. */
export function subtreeHeight(rows: SuiteRow[], rootId: string): number {
  const childrenOf = new Map<string | null, SuiteRow[]>();
  for (const row of rows) {
    const siblings = childrenOf.get(row.parent_id) ?? [];
    siblings.push(row);
    childrenOf.set(row.parent_id, siblings);
  }
  let height = 0;
  let frontier = childrenOf.get(rootId) ?? [];
  while (frontier.length > 0) {
    height += 1;
    frontier = frontier.flatMap((row) => childrenOf.get(row.id) ?? []);
  }
  return height;
}

/** Whether `candidate` sits inside the subtree rooted at `ancestorId`. */
export function isDescendantOf(
  rows: SuiteRow[],
  candidate: string,
  ancestorId: string,
): boolean {
  const byId = new Map(rows.map((row) => [row.id, row]));
  let current = byId.get(candidate);
  const guard = new Set<string>();
  while (current && current.parent_id !== null) {
    if (current.parent_id === ancestorId) return true;
    if (guard.has(current.id)) return false;
    guard.add(current.id);
    current = byId.get(current.parent_id);
  }
  return false;
}
