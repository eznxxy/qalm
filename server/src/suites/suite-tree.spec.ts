import {
  arrangeSiblings,
  buildSuitePath,
  buildSuiteTree,
  isDescendantOf,
  rollupCaseCounts,
  subtreeHeight,
  toCountMap,
} from './suite-tree';
import { SuiteRow } from './suites.store';

/**
 * Pure tree rules for docs/api-suites.md: subtree case counts, nesting,
 * position ordering, breadcrumbs and sibling placement. SQL behaviour is
 * covered by test/suites.e2e-spec.ts.
 */
function suite(params: {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  position: number;
}): SuiteRow {
  return {
    id: params.id,
    project_id: 'p-1',
    parent_id: params.parentId,
    name: params.name,
    description: null,
    depth: params.depth,
    position: params.position,
    created_by: 'u-admin',
    created_at: new Date('2026-10-25T00:00:00.000Z'),
    updated_at: new Date('2026-10-25T00:00:00.000Z'),
  };
}

const FOREST: SuiteRow[] = [
  suite({ id: 'root-a', name: 'Checkout', parentId: null, depth: 1, position: 1 }),
  suite({ id: 'root-b', name: 'Account', parentId: null, depth: 1, position: 2 }),
  suite({ id: 'child-a1', name: 'Payment', parentId: 'root-a', depth: 2, position: 1 }),
  suite({ id: 'child-a2', name: 'Cart', parentId: 'root-a', depth: 2, position: 2 }),
  suite({ id: 'grand-a1', name: 'Wallet', parentId: 'child-a1', depth: 3, position: 1 }),
];

describe('suite-tree', () => {
  describe('rollupCaseCounts', () => {
    it('sums a suite’s own cases plus every descendant', () => {
      const direct = toCountMap([
        { suite_id: 'root-a', count: 2 },
        { suite_id: 'child-a1', count: 3 },
        { suite_id: 'grand-a1', count: 4 },
      ]);
      const totals = rollupCaseCounts(FOREST, direct);
      expect(totals.get('root-a')).toBe(9);
      expect(totals.get('child-a1')).toBe(7);
      expect(totals.get('grand-a1')).toBe(4);
      expect(totals.get('child-a2')).toBe(0);
      expect(totals.get('root-b')).toBe(0);
    });

    it('keeps a parent at zero when nothing below it has cases', () => {
      const totals = rollupCaseCounts(FOREST, new Map());
      for (const row of FOREST) expect(totals.get(row.id)).toBe(0);
    });
  });

  describe('buildSuiteTree', () => {
    it('nests children under their parent in position order', () => {
      const counts = new Map([['root-a', 9]]);
      const tree = buildSuiteTree(FOREST, counts);
      expect(tree.map((node) => node.name)).toEqual(['Checkout', 'Account']);
      expect(tree[0]!.children.map((node) => node.name)).toEqual(['Payment', 'Cart']);
      expect(tree[0]!.children[0]!.children.map((node) => node.name)).toEqual(['Wallet']);
      expect(tree[0]!.children[0]!.children[0]!.children).toEqual([]);
      expect(tree[1]!.children).toEqual([]);
      expect(tree[0]!.case_count).toBe(9);
    });

    it('orders roots by position, not by input order', () => {
      const shuffled = [FOREST[1]!, FOREST[0]!];
      expect(buildSuiteTree(shuffled, new Map()).map((node) => node.name)).toEqual([
        'Checkout',
        'Account',
      ]);
    });
  });

  describe('buildSuitePath', () => {
    it('returns root → self including the suite itself', () => {
      expect(buildSuitePath(FOREST, 'grand-a1')).toEqual([
        { id: 'root-a', name: 'Checkout' },
        { id: 'child-a1', name: 'Payment' },
        { id: 'grand-a1', name: 'Wallet' },
      ]);
    });

    it('returns a single entry for a root suite', () => {
      expect(buildSuitePath(FOREST, 'root-b')).toEqual([{ id: 'root-b', name: 'Account' }]);
    });
  });

  describe('arrangeSiblings', () => {
    it('places an explicit position and keeps the rest in relative order', () => {
      expect(arrangeSiblings(['a', 'b', 'c'], [{ id: 'c', position: 1 }])).toEqual([
        'c',
        'a',
        'b',
      ]);
    });

    it('supports partial groups (only the dragged rows are sent)', () => {
      expect(
        arrangeSiblings(['a', 'b', 'c'], [
          { id: 'c', position: 1 },
          { id: 'b', position: 2 },
        ]),
      ).toEqual(['c', 'b', 'a']);
    });

    it('appends when the position is one past the end', () => {
      expect(arrangeSiblings(['a', 'b'], [{ id: 'c', position: 3 }])).toEqual(['a', 'b', 'c']);
    });

    it('returns null when a position lands beyond the group', () => {
      expect(arrangeSiblings(['a'], [{ id: 'b', position: 3 }])).toBeNull();
    });
  });

  describe('subtreeHeight', () => {
    it('measures the deepest chain below a suite', () => {
      expect(subtreeHeight(FOREST, 'root-a')).toBe(2);
      expect(subtreeHeight(FOREST, 'child-a1')).toBe(1);
      expect(subtreeHeight(FOREST, 'grand-a1')).toBe(0);
    });
  });

  describe('isDescendantOf', () => {
    it('detects children and grandchildren', () => {
      expect(isDescendantOf(FOREST, 'child-a1', 'root-a')).toBe(true);
      expect(isDescendantOf(FOREST, 'grand-a1', 'root-a')).toBe(true);
      expect(isDescendantOf(FOREST, 'root-b', 'root-a')).toBe(false);
      expect(isDescendantOf(FOREST, 'root-a', 'child-a1')).toBe(false);
    });
  });
});
