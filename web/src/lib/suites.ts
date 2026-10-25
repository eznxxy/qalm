/**
 * Pure helpers over the docs/api-suites.md tree shape. The tree arrives
 * nested (depth ≤ 3); these functions flatten it for the ARIA treeview,
 * resolve breadcrumbs, and compute legal move destinations.
 */
import type { SuiteNode, SuitePathEntry } from "./api-types";

export interface FlatSuite {
  node: SuiteNode;
  /** 1-based, same as node.depth (kept explicit for rendering). */
  level: number;
  parentId: string | null;
}

/** Depth-first pre-order walk of the visible tree. */
export function flattenSuites(nodes: readonly SuiteNode[]): FlatSuite[] {
  const out: FlatSuite[] = [];
  const walk = (list: readonly SuiteNode[], parentId: string | null): void => {
    for (const node of list) {
      out.push({ node, level: node.depth, parentId });
      walk(node.children, node.id);
    }
  };
  walk(nodes, null);
  return out;
}

/** Root → suite (inclusive) trail for the cases header. */
export function findSuitePath(
  nodes: readonly SuiteNode[],
  suiteId: string | null
): SuitePathEntry[] {
  if (!suiteId) return [];
  const walk = (
    list: readonly SuiteNode[],
    trail: SuitePathEntry[]
  ): SuitePathEntry[] | null => {
    for (const node of list) {
      const next = [...trail, { id: node.id, name: node.name }];
      if (node.id === suiteId) return next;
      const found = walk(node.children, next);
      if (found) return found;
    }
    return null;
  };
  return walk(nodes, []) ?? [];
}

/** Height of a subtree (1 for a leaf) — moves may not push it past depth 3. */
export function subtreeHeight(node: SuiteNode): number {
  if (node.children.length === 0) return 1;
  return 1 + Math.max(...node.children.map(subtreeHeight));
}

/** Direct children of a parent, or the roots when parentId is null. */
export function siblingsOf(
  nodes: readonly SuiteNode[],
  parentId: string | null
): SuiteNode[] {
  if (parentId === null) return [...nodes];
  const find = (list: readonly SuiteNode[]): SuiteNode | null => {
    for (const node of list) {
      if (node.id === parentId) return node;
      const found = find(node.children);
      if (found) return found;
    }
    return null;
  };
  return [...(find(nodes)?.children ?? [])];
}

export function findSuiteById(
  nodes: readonly SuiteNode[],
  suiteId: string | null
): SuiteNode | null {
  if (!suiteId) return null;
  for (const node of nodes) {
    if (node.id === suiteId) return node;
    const found = findSuiteById(node.children, suiteId);
    if (found) return found;
  }
  return null;
}

/** True when `candidateId` is `suiteId` itself or lives inside its subtree. */
export function isSelfOrDescendant(
  nodes: readonly SuiteNode[],
  suiteId: string,
  candidateId: string
): boolean {
  if (suiteId === candidateId) return true;
  const suite = findSuiteById(nodes, suiteId);
  if (!suite) return false;
  return findSuiteById(suite.children, candidateId) !== null;
}

export interface MoveDestination {
  /** null = top level (no parent). */
  parentId: string | null;
  label: string;
  /** Depth the moved suite would have as a child of this parent. */
  depth: number;
}

/**
 * Legal parents for a move: not itself, not its own descendant, and the
 * resulting subtree must stay inside the 3-level cap. Top level is always
 * listed first.
 */
export function moveDestinations(
  nodes: readonly SuiteNode[],
  movingId: string
): MoveDestination[] {
  const moving = findSuiteById(nodes, movingId);
  if (!moving) return [];
  const height = subtreeHeight(moving);
  const out: MoveDestination[] = [
    { parentId: null, label: "Top level", depth: 1 },
  ];
  for (const flat of flattenSuites(nodes)) {
    const { node } = flat;
    if (isSelfOrDescendant(nodes, movingId, node.id)) continue;
    const childDepth = node.depth + 1;
    if (childDepth + height - 1 > 3) continue;
    out.push({
      parentId: node.id,
      label: `${"— ".repeat(node.depth - 1)}${node.name}`,
      depth: childDepth,
    });
  }
  return out;
}

/** Indented option labels for the case editor's suite picker. */
export function suiteOptions(
  nodes: readonly SuiteNode[]
): Array<{ id: string; label: string; depth: number }> {
  return flattenSuites(nodes).map(({ node }) => ({
    id: node.id,
    label: `${"— ".repeat(node.depth - 1)}${node.name}`,
    depth: node.depth,
  }));
}

export type DropIntent = "before" | "inside" | "after";

export interface SuiteMoveRequest {
  id: string;
  parentId: string | null;
  /** 1-based slot in the destination sibling group, per the contract. */
  position: number;
}

/**
 * Translates a drag/drop into PATCH /suites/:id coordinates:
 * - `inside` appends as the last child of the target;
 * - `before`/`after` insert next to it in the target's sibling group.
 * Returns null for self/descendant drops and for any move that would push
 * the subtree past the 3-level cap (the caller refuses the drop).
 */
export function dropRequest(
  nodes: readonly SuiteNode[],
  dragId: string,
  targetId: string,
  intent: DropIntent
): SuiteMoveRequest | null {
  const moving = findSuiteById(nodes, dragId);
  const target = findSuiteById(nodes, targetId);
  if (!moving || !target) return null;
  if (isSelfOrDescendant(nodes, dragId, targetId)) return null;

  if (intent === "inside") {
    // A child of a depth-3 suite would be level 4.
    if (target.depth >= 3) return null;
    return {
      id: dragId,
      parentId: target.id,
      position: target.children.length + 1,
    };
  }

  const parentId = target.parent_id;
  const parentDepth =
    parentId === null ? 0 : (findSuiteById(nodes, parentId)?.depth ?? 0);
  if (parentDepth + subtreeHeight(moving) > 3) return null;

  const siblings = siblingsOf(nodes, parentId).filter(
    (sibling) => sibling.id !== dragId
  );
  const targetIndex = siblings.findIndex((sibling) => sibling.id === targetId);
  if (targetIndex < 0) return null;
  return {
    id: dragId,
    parentId,
    position: intent === "before" ? targetIndex + 1 : targetIndex + 2,
  };
}
