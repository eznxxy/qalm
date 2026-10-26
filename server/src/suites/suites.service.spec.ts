/* eslint-disable @typescript-eslint/require-await -- the in-memory fake mirrors
   the async store surface without doing I/O. */
import { Test } from '@nestjs/testing';
import { AuthUser, UserRole } from '../auth/current-user';
import { SuitesService } from './suites.service';
import { Queryable, SuiteProjectRef, SuiteRow, SuitesStore } from './suites.store';

/**
 * Decision-logic tests for SuitesService over an in-memory fake of the suites
 * + cases tables. SQL semantics (unique siblings, recursive depth rewrite,
 * position shifting, grouped counts) are mirrored here; the real SQL path is
 * covered end-to-end by test/suites.e2e-spec.ts.
 */
interface FakeCase {
  suite_id: string;
  deleted: boolean;
}

class FakeStore {
  projects: SuiteProjectRef[] = [];
  suites: SuiteRow[] = [];
  cases: FakeCase[] = [];
  private nextId = 1;
  private readonly now = new Date('2026-10-25T10:00:00.000Z');

  seed(): void {
    this.projects = [
      { id: 'p-1', status: 'active' },
      { id: 'p-2', status: 'active' },
      { id: 'p-arch', status: 'archived' },
    ];
    this.suites = [
      this.row('root-a', 'Checkout', null, 1, 1),
      this.row('root-b', 'Account', null, 1, 2),
      this.row('child-a1', 'Payment', 'root-a', 2, 1),
      this.row('child-a2', 'Cart', 'root-a', 2, 2),
      this.row('grand-a1', 'Wallet', 'child-a1', 3, 1),
    ];
    this.cases = [];
  }

  row(
    id: string,
    name: string,
    parentId: string | null,
    depth: number,
    position: number,
    projectId = 'p-1',
  ): SuiteRow {
    return {
      id,
      project_id: projectId,
      parent_id: parentId,
      name,
      description: null,
      depth,
      position,
      created_by: 'u-admin',
      created_at: this.now,
      updated_at: this.now,
    };
  }

  async transaction<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
    return fn({} as Queryable);
  }

  async findProject(projectId: string): Promise<SuiteProjectRef | null> {
    return this.projects.find((project) => project.id === projectId) ?? null;
  }

  async findById(id: string): Promise<SuiteRow | null> {
    return this.suites.find((suite) => suite.id === id) ?? null;
  }

  async findByIdForUpdate(id: string): Promise<SuiteRow | null> {
    return this.findById(id);
  }

  async listByProject(projectId: string): Promise<SuiteRow[]> {
    return this.suites
      .filter((suite) => suite.project_id === projectId)
      .sort((a, b) => a.depth - b.depth || a.position - b.position);
  }

  async listSiblings(projectId: string, parentId: string | null): Promise<SuiteRow[]> {
    return this.suites
      .filter((suite) => suite.project_id === projectId && suite.parent_id === parentId)
      .sort((a, b) => a.position - b.position);
  }

  async listForUpdate(projectId: string): Promise<SuiteRow[]> {
    return this.suites
      .filter((suite) => suite.project_id === projectId)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async findIdBySiblingName(
    projectId: string,
    parentId: string | null,
    name: string,
    excludeId: string | null,
  ): Promise<string | null> {
    const clash = this.suites.find(
      (suite) =>
        suite.project_id === projectId &&
        suite.parent_id === parentId &&
        suite.id !== excludeId &&
        suite.name.toLowerCase() === name.toLowerCase(),
    );
    return clash?.id ?? null;
  }

  async countSiblings(projectId: string, parentId: string | null): Promise<number> {
    return (await this.listSiblings(projectId, parentId)).length;
  }

  async insert(
    row: Pick<
      SuiteRow,
      'project_id' | 'parent_id' | 'name' | 'description' | 'depth' | 'position' | 'created_by'
    >,
  ): Promise<SuiteRow> {
    const created: SuiteRow = {
      ...row,
      id: `s-${this.nextId++}`,
      created_at: this.now,
      updated_at: this.now,
    };
    this.suites.push(created);
    return created;
  }

  async updateFields(
    id: string,
    fields: {
      name?: string;
      description?: string | null;
      parent_id?: string | null;
      depth?: number;
      position?: number;
    },
  ): Promise<SuiteRow | null> {
    const row = this.suites.find((suite) => suite.id === id);
    if (!row) return null;
    if (fields.name !== undefined) row.name = fields.name;
    if (fields.description !== undefined) row.description = fields.description;
    if (fields.parent_id !== undefined) row.parent_id = fields.parent_id;
    if (fields.depth !== undefined) row.depth = fields.depth;
    if (fields.position !== undefined) row.position = fields.position;
    row.updated_at = new Date();
    return row;
  }

  async touch(id: string): Promise<SuiteRow | null> {
    const row = this.suites.find((suite) => suite.id === id);
    if (!row) return null;
    row.updated_at = new Date();
    return row;
  }

  async shiftPositions(
    projectId: string,
    parentId: string | null,
    fromPosition: number,
    delta: 1 | -1,
  ): Promise<void> {
    for (const row of this.suites) {
      if (
        row.project_id === projectId &&
        row.parent_id === parentId &&
        row.position >= fromPosition
      ) {
        row.position += delta;
      }
    }
  }

  async setPositions(entries: Array<{ id: string; position: number }>): Promise<void> {
    for (const entry of entries) {
      const row = this.suites.find((suite) => suite.id === entry.id);
      if (row) row.position = entry.position;
    }
  }

  async applyLayout(
    entries: Array<{ id: string; parent_id: string | null; depth: number; position: number }>,
  ): Promise<void> {
    for (const entry of entries) {
      const row = this.suites.find((suite) => suite.id === entry.id);
      if (!row) continue;
      row.parent_id = entry.parent_id;
      row.depth = entry.depth;
      row.position = entry.position;
      row.updated_at = new Date();
    }
  }

  async updateSubtreeDepth(rootId: string, delta: number): Promise<void> {
    const collect = (id: string): string[] => [
      id,
      ...this.suites.filter((suite) => suite.parent_id === id).flatMap((suite) => collect(suite.id)),
    ];
    for (const id of collect(rootId)) {
      const row = this.suites.find((suite) => suite.id === id);
      if (row) row.depth += delta;
    }
  }

  async deleteById(id: string): Promise<void> {
    this.suites = this.suites.filter((suite) => suite.id !== id);
  }

  async countChildren(id: string): Promise<number> {
    return this.suites.filter((suite) => suite.parent_id === id).length;
  }

  async countLiveCases(id: string): Promise<number> {
    return this.cases.filter((testCase) => testCase.suite_id === id && !testCase.deleted).length;
  }

  async liveCaseCountsByProject(
    projectId: string,
  ): Promise<Array<{ suite_id: string; count: number }>> {
    const inProject = new Set(
      this.suites.filter((suite) => suite.project_id === projectId).map((suite) => suite.id),
    );
    const counts = new Map<string, number>();
    for (const testCase of this.cases) {
      if (testCase.deleted || !inProject.has(testCase.suite_id)) continue;
      counts.set(testCase.suite_id, (counts.get(testCase.suite_id) ?? 0) + 1);
    }
    return [...counts].map(([suite_id, count]) => ({ suite_id, count }));
  }

  suiteNamed(name: string): SuiteRow {
    const row = this.suites.find((suite) => suite.name === name);
    if (!row) throw new Error(`no suite ${name}`);
    return row;
  }
}

const USER: AuthUser = {
  id: 'u-admin',
  email: 'admin@example.com',
  name: 'Admin',
  role: 'admin',
  isActive: true,
  mustChangePassword: false,
};

const AS = (role: UserRole): AuthUser => ({ ...USER, id: `u-${role}`, role });

describe('SuitesService (unit, in-memory suites + cases)', () => {
  let service: SuitesService;
  let store: FakeStore;

  beforeEach(async () => {
    store = new FakeStore();
    store.seed();
    const moduleRef = await Test.createTestingModule({
      providers: [{ provide: SuitesStore, useValue: store }, SuitesService],
    }).compile();
    service = moduleRef.get(SuitesService);
  });

  describe('tree', () => {
    it('nests the project forest and rolls up subtree counts', async () => {
      store.cases = [
        { suite_id: 'root-a', deleted: false },
        { suite_id: 'grand-a1', deleted: false },
        { suite_id: 'grand-a1', deleted: true },
      ];
      const tree = await service.tree(AS('viewer'), 'p-1');
      expect(tree.map((node) => node.name)).toEqual(['Checkout', 'Account']);
      expect(tree[0]!.children.map((node) => node.name)).toEqual(['Payment', 'Cart']);
      expect(tree[0]!.case_count).toBe(2);
      expect(tree[0]!.children[0]!.children[0]!.case_count).toBe(1);
    });

    it('404s an unknown project', async () => {
      await expect(service.tree(AS('admin'), 'p-missing')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('lets an Admin read an archived project but hides it from a Lead', async () => {
      await expect(service.tree(AS('admin'), 'p-arch')).resolves.toEqual([]);
      await expect(service.tree(AS('lead'), 'p-arch')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  describe('detail', () => {
    it('returns the root → self path and the subtree count', async () => {
      store.cases = [{ suite_id: 'grand-a1', deleted: false }];
      const detail = await service.detail(AS('tester'), 'child-a1');
      expect(detail.path.map((entry) => entry.name)).toEqual(['Checkout', 'Payment']);
      expect(detail.case_count).toBe(1);
    });

    it('404s an unknown suite', async () => {
      await expect(service.detail(AS('admin'), 'missing')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('404s a suite in an archived project for a Tester', async () => {
      store.suites.push(store.row('arch-suite', 'Old', null, 1, 1, 'p-arch'));
      await expect(service.detail(AS('tester'), 'arch-suite')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(service.detail(AS('admin'), 'arch-suite')).resolves.toMatchObject({
        name: 'Old',
      });
    });
  });

  describe('create', () => {
    it('creates a root suite at the end of the sibling group', async () => {
      const created = await service.create(AS('lead'), 'p-1', { name: 'Reports' });
      expect(created).toMatchObject({
        name: 'Reports',
        parent_id: null,
        depth: 1,
        position: 3,
        case_count: 0,
        created_by: 'u-lead',
      });
    });

    it('creates a child at depth 2 and a grandchild at depth 3', async () => {
      const child = await service.create(AS('admin'), 'p-1', {
        name: 'Wallet',
        parent_id: 'root-b',
      });
      expect(child).toMatchObject({ parent_id: 'root-b', depth: 2, position: 1 });
      const grandchild = await service.create(AS('admin'), 'p-1', {
        name: 'Refunds',
        parent_id: child.id,
      });
      expect(grandchild.depth).toBe(3);
    });

    it('400s parent_id when it would create a 4th level', async () => {
      await expect(
        service.create(AS('admin'), 'p-1', { name: 'Too deep', parent_id: 'grand-a1' }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [{ field: 'parent_id', issue: 'suites are limited to 3 levels' }],
      });
    });

    it('400s a parent in another project', async () => {
      await expect(
        service.create(AS('admin'), 'p-2', { name: 'Child', parent_id: 'root-a' }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [{ field: 'parent_id', issue: 'must belong to the same project' }],
      });
    });

    it('400s an explicit position beyond the end of the group', async () => {
      await expect(
        service.create(AS('admin'), 'p-1', { name: 'Late', position: 4 }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('inserts at an explicit position and shifts the rest down', async () => {
      const created = await service.create(AS('admin'), 'p-1', { name: 'First', position: 1 });
      expect(created.position).toBe(1);
      expect(store.suiteNamed('Checkout').position).toBe(2);
      expect(store.suiteNamed('Account').position).toBe(3);
    });

    it('409s a sibling name clash, case-insensitively', async () => {
      await expect(
        service.create(AS('admin'), 'p-1', { name: 'payment', parent_id: 'root-a' }),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        details: [{ field: 'name', issue: 'already in use among siblings' }],
      });
    });

    it('allows the same name under a different parent', async () => {
      const created = await service.create(AS('admin'), 'p-1', {
        name: 'Payment',
        parent_id: 'root-b',
      });
      expect(created.parent_id).toBe('root-b');
    });

    it('404s an unknown project and 409s a write to an archived one', async () => {
      await expect(service.create(AS('admin'), 'p-missing', { name: 'X' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(service.create(AS('admin'), 'p-arch', { name: 'X' })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });
  });

  describe('update', () => {
    it('400s an empty body', async () => {
      await expect(service.update(AS('admin'), 'root-a', {})).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });

    it('renames and clears the description', async () => {
      const updated = await service.update(AS('admin'), 'root-a', {
        name: 'Checkout v2',
        description: null,
      });
      expect(updated).toMatchObject({ name: 'Checkout v2', description: null });
    });

    it('moves a subtree to a new parent, rewriting depths and re-densifying both groups', async () => {
      const moved = await service.update(AS('admin'), 'child-a1', { parent_id: 'root-b' });
      expect(moved).toMatchObject({ parent_id: 'root-b', depth: 2, position: 1 });
      expect(store.suiteNamed('Wallet').depth).toBe(3);
      expect(store.suiteNamed('Cart')).toMatchObject({ position: 1 });
      expect(store.suiteNamed('Account').position).toBe(2);
    });

    it('400s a move into itself', async () => {
      await expect(
        service.update(AS('admin'), 'root-a', { parent_id: 'root-a' }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [{ field: 'parent_id', issue: 'a suite cannot be its own parent' }],
      });
    });

    it('400s a move into its own descendant', async () => {
      await expect(
        service.update(AS('admin'), 'root-a', { parent_id: 'grand-a1' }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [{ field: 'parent_id', issue: 'cannot move a suite into its own descendant' }],
      });
    });

    it('400s a move that would exceed 3 levels', async () => {
      // child-b1 is depth 2; child-a1 brings one level of subtree with it.
      store.suites.push(store.row('child-b1', 'Security', 'root-b', 2, 1));
      await expect(
        service.update(AS('admin'), 'child-a1', { parent_id: 'child-b1' }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [{ field: 'parent_id', issue: 'a move would exceed the 3-level limit' }],
      });
    });

    it('409s a name clash in the destination group', async () => {
      store.suites.push(store.row('root-b-child', 'Payment', 'root-b', 2, 1));
      await expect(
        service.update(AS('admin'), 'child-a1', { parent_id: 'root-b' }),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        details: [{ field: 'name', issue: 'already in use among siblings' }],
      });
    });

    it('moves a suite to the root and sets depth 1', async () => {
      const moved = await service.update(AS('admin'), 'grand-a1', { parent_id: null });
      expect(moved).toMatchObject({ parent_id: null, depth: 1, position: 3 });
    });

    it('reorders within the same group', async () => {
      const moved = await service.update(AS('admin'), 'child-a2', { position: 1 });
      expect(moved.position).toBe(1);
      expect(store.suiteNamed('Payment').position).toBe(2);
    });

    it('400s a position beyond the group', async () => {
      await expect(
        service.update(AS('admin'), 'child-a1', { position: 3 }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [{ field: 'position', issue: 'must be between 1 and 2' }],
      });
    });

    it('404s an unknown suite and 409s an archived project', async () => {
      await expect(service.update(AS('admin'), 'missing', { name: 'X' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      store.suites.push(store.row('arch-suite', 'Old', null, 1, 1, 'p-arch'));
      await expect(
        service.update(AS('admin'), 'arch-suite', { name: 'New' }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  describe('remove', () => {
    it('deletes an empty suite and closes the position gap', async () => {
      store.suites.push(store.row('child-a3', 'Coupons', 'root-a', 2, 3));
      await service.remove(AS('admin'), 'child-a2');
      expect(store.suites.some((suite) => suite.id === 'child-a2')).toBe(false);
      expect(store.suiteNamed('Coupons').position).toBe(2);
    });

    it('409s a suite with child suites', async () => {
      await expect(service.remove(AS('admin'), 'root-a')).rejects.toMatchObject({
        code: 'CONFLICT',
        details: [{ field: 'suite', issue: 'suite has 2 child suites' }],
      });
    });

    it('409s a suite with live cases', async () => {
      store.cases = [{ suite_id: 'child-a2', deleted: false }];
      await expect(service.remove(AS('admin'), 'child-a2')).rejects.toMatchObject({
        code: 'CONFLICT',
        details: [{ field: 'suite', issue: 'suite has 1 cases' }],
      });
    });

    it('ignores soft-deleted cases', async () => {
      store.cases = [{ suite_id: 'child-a2', deleted: true }];
      await service.remove(AS('lead'), 'child-a2');
      expect(store.suites.some((suite) => suite.id === 'child-a2')).toBe(false);
    });

    it('404s an unknown suite and 409s an archived project', async () => {
      await expect(service.remove(AS('admin'), 'missing')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      store.suites.push(store.row('arch-suite', 'Old', null, 1, 1, 'p-arch'));
      await expect(service.remove(AS('admin'), 'arch-suite')).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });
  });

  describe('reorder', () => {
    it('swaps root positions and returns the reconciled tree', async () => {
      const tree = await service.reorder(AS('admin'), 'p-1', {
        items: [
          { id: 'root-a', parent_id: null, position: 2 },
          { id: 'root-b', parent_id: null, position: 1 },
        ],
      });
      expect(tree.map((node) => node.name)).toEqual(['Account', 'Checkout']);
      expect(store.suiteNamed('Checkout').position).toBe(2);
    });

    it('reparents a suite and re-densifies the group it left', async () => {
      const tree = await service.reorder(AS('lead'), 'p-1', {
        items: [{ id: 'child-a2', parent_id: 'root-b', position: 1 }],
      });
      expect(store.suiteNamed('Cart')).toMatchObject({ parent_id: 'root-b', depth: 2, position: 1 });
      expect(store.suiteNamed('Payment').position).toBe(1);
      expect(tree[1]!.children.map((node) => node.name)).toEqual(['Cart']);
    });

    it('400s an unknown suite id', async () => {
      await expect(
        service.reorder(AS('admin'), 'p-1', {
          items: [{ id: 'missing', parent_id: null, position: 1 }],
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('400s a parent that is not in this project', async () => {
      await expect(
        service.reorder(AS('admin'), 'p-1', {
          items: [{ id: 'root-a', parent_id: 'other-project-suite', position: 1 }],
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('400s duplicate positions within a group', async () => {
      await expect(
        service.reorder(AS('admin'), 'p-1', {
          items: [
            { id: 'root-a', parent_id: null, position: 1 },
            { id: 'root-b', parent_id: null, position: 1 },
          ],
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('400s a move into its own descendant (cycle)', async () => {
      await expect(
        service.reorder(AS('admin'), 'p-1', {
          items: [{ id: 'root-a', parent_id: 'grand-a1', position: 1 }],
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('400s a move that would exceed 3 levels', async () => {
      await expect(
        service.reorder(AS('admin'), 'p-1', {
          items: [{ id: 'root-b', parent_id: 'grand-a1', position: 1 }],
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('409s a write to an archived project', async () => {
      await expect(
        service.reorder(AS('admin'), 'p-arch', {
          items: [{ id: 'x', parent_id: null, position: 1 }],
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });
});
