/* eslint-disable @typescript-eslint/require-await -- the in-memory fake mirrors
   the async store surface without doing I/O. */
import { Test } from '@nestjs/testing';
import { AuthUser, UserRole } from '../auth/current-user';
import { Queryable } from '../db/queryable';
import { CasesService } from './cases.service';
import {
  CaseHistoryRow,
  CaseHistoryWrite,
  CaseListFilter,
  CaseListRow,
  CaseProjectRef,
  CaseRow,
  CaseStepRow,
  CaseSuiteRef,
  CasesStore,
  CaseUpdateFields,
  CaseWriteRow,
} from './cases.store';
import { CreateCaseDto, UpdateCaseDto } from './dto';
import { CASE_PRIORITY_RANK, CasePriority, CaseType } from './cases.constants';

/**
 * Decision-logic tests for CasesService over an in-memory fake of the cases
 * tables. SQL semantics (filters, ordering, step counts, history ordering) are
 * mirrored here; the real SQL path is covered by test/cases.e2e-spec.ts.
 *
 * `transaction` snapshots and restores state so the bulk-move atomicity claim
 * is tested, not just stated.
 */
interface FakeStep extends CaseStepRow {
  case_id: string;
}

class FakeStore {
  projects: CaseProjectRef[] = [];
  suites: CaseSuiteRef[] = [];
  cases: CaseRow[] = [];
  steps: FakeStep[] = [];
  history: CaseHistoryRow[] = [];
  counters = new Map<string, number>();

  private nextId = 1;
  private nextNumber = 1;
  private clock = 0;

  seed(): void {
    this.projects = [
      { id: 'p-1', status: 'active' },
      { id: 'p-2', status: 'active' },
      { id: 'p-arch', status: 'archived' },
    ];
    this.suites = [
      { id: 's-root', project_id: 'p-1' },
      { id: 's-child', project_id: 'p-1' },
      { id: 's-grand', project_id: 'p-1' },
      { id: 's-other', project_id: 'p-1' },
      { id: 's-project2', project_id: 'p-2' },
      { id: 's-arch', project_id: 'p-arch' },
    ];
    this.cases = [];
    this.steps = [];
    this.history = [];
    this.counters = new Map();
  }

  /** Deterministic, strictly increasing clock (ISO output stays stable). */
  private tick(): Date {
    this.clock += 1_000;
    return new Date(Date.UTC(2026, 9, 25, 9, 0, 0) + this.clock);
  }

  async transaction<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
    const snapshot = {
      cases: this.cases.map((row) => ({ ...row })),
      steps: this.steps.map((row) => ({ ...row })),
      history: this.history.map((row) => ({ ...row })),
      counters: new Map(this.counters),
      nextId: this.nextId,
      nextNumber: this.nextNumber,
      clock: this.clock,
    };
    try {
      return await fn({} as Queryable);
    } catch (error) {
      this.cases = snapshot.cases;
      this.steps = snapshot.steps;
      this.history = snapshot.history;
      this.counters = snapshot.counters;
      this.nextId = snapshot.nextId;
      this.nextNumber = snapshot.nextNumber;
      this.clock = snapshot.clock;
      throw error;
    }
  }

  async findProject(projectId: string): Promise<CaseProjectRef | null> {
    return this.projects.find((project) => project.id === projectId) ?? null;
  }

  async findSuiteById(suiteId: string): Promise<CaseSuiteRef | null> {
    return this.suites.find((suite) => suite.id === suiteId) ?? null;
  }

  async suiteIdsForFilter(
    projectId: string,
    suiteId: string,
    includeDescendants: boolean,
  ): Promise<string[]> {
    if (!includeDescendants) return [suiteId];
    const inProject = this.suites.filter((suite) => suite.project_id === projectId);
    if (!inProject.some((suite) => suite.id === suiteId)) return [];
    return this.descendantsOf(suiteId, inProject);
  }

  /** The fake stores no parent link; nesting is fixed for the preset ids. */
  private descendantsOf(suiteId: string, inProject: CaseSuiteRef[]): string[] {
    const children: Record<string, string[]> = {
      's-root': ['s-child'],
      's-child': ['s-grand'],
    };
    const ids = new Set(inProject.map((suite) => suite.id));
    const walk = (id: string): string[] => [
      id,
      ...(children[id] ?? []).filter((child) => ids.has(child)).flatMap(walk),
    ];
    return walk(suiteId);
  }

  async nextCaseNumber(projectId: string): Promise<number> {
    const next = (this.counters.get(projectId) ?? 0) + 1;
    this.counters.set(projectId, next);
    return next;
  }

  async insertCase(row: CaseWriteRow): Promise<CaseRow> {
    const now = this.tick();
    const created: CaseRow = {
      id: `c-${this.nextId++}`,
      project_id: row.project_id,
      suite_id: row.suite_id,
      case_number: row.case_number,
      title: row.title,
      preconditions: row.preconditions,
      priority: row.priority,
      type: row.type,
      tags: [...row.tags],
      estimate_minutes: row.estimate_minutes,
      created_by: row.created_by,
      updated_by: row.updated_by,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    };
    this.cases.push(created);
    return created;
  }

  /** Test seed for list/detail cases; bypasses numbering on purpose. */
  addCase(overrides: {
    projectId?: string;
    suiteId?: string;
    title?: string;
    priority?: CasePriority;
    type?: CaseType;
    tags?: string[];
    steps?: Array<{ text: string; expected_result: string | null }>;
    deleted?: boolean;
    caseNumber?: number;
  }): CaseRow {
    const now = this.tick();
    const row: CaseRow = {
      id: `c-${this.nextId++}`,
      project_id: overrides.projectId ?? 'p-1',
      suite_id: overrides.suiteId === undefined ? 's-root' : overrides.suiteId,
      case_number: overrides.caseNumber ?? this.nextNumber++,
      title: overrides.title ?? 'Case',
      preconditions: null,
      priority: overrides.priority ?? 'medium',
      type: overrides.type ?? 'functional',
      tags: overrides.tags ?? [],
      estimate_minutes: null,
      created_by: 'u-admin',
      updated_by: 'u-admin',
      deleted_at: overrides.deleted ? now : null,
      created_at: now,
      updated_at: now,
    };
    this.cases.push(row);
    for (const [index, step] of (overrides.steps ?? []).entries()) {
      this.steps.push({ case_id: row.id, position: index + 1, ...step });
    }
    return row;
  }

  async stepsFor(caseId: string): Promise<CaseStepRow[]> {
    return this.steps
      .filter((step) => step.case_id === caseId)
      .sort((a, b) => a.position - b.position)
      .map(({ position, text, expected_result }) => ({ position, text, expected_result }));
  }

  async insertSteps(
    caseId: string,
    steps: Array<{ text: string; expected_result: string | null }>,
  ): Promise<void> {
    for (const [index, step] of steps.entries()) {
      this.steps.push({ case_id: caseId, position: index + 1, ...step });
    }
  }

  async replaceSteps(
    caseId: string,
    steps: Array<{ text: string; expected_result: string | null }>,
  ): Promise<void> {
    this.steps = this.steps.filter((step) => step.case_id !== caseId);
    await this.insertSteps(caseId, steps);
  }

  async findLiveById(id: string): Promise<CaseRow | null> {
    return this.cases.find((row) => row.id === id && row.deleted_at === null) ?? null;
  }

  async findLiveByIdForUpdate(id: string): Promise<CaseRow | null> {
    return this.findLiveById(id);
  }

  async findLiveByIds(projectId: string, ids: string[]): Promise<CaseRow[]> {
    // Copies, like pg rows: the service reads `from` before rows are updated.
    return this.cases
      .filter(
        (row) =>
          row.project_id === projectId && row.deleted_at === null && ids.includes(row.id),
      )
      .map((row) => ({ ...row }));
  }

  async updateFields(id: string, fields: CaseUpdateFields): Promise<CaseRow | null> {
    const row = await this.findLiveById(id);
    if (!row) return null;
    if (fields.title !== undefined) row.title = fields.title;
    if (fields.preconditions !== undefined) row.preconditions = fields.preconditions;
    if (fields.priority !== undefined) row.priority = fields.priority;
    if (fields.type !== undefined) row.type = fields.type;
    if (fields.tags !== undefined) row.tags = [...fields.tags];
    if (fields.estimate_minutes !== undefined) row.estimate_minutes = fields.estimate_minutes;
    if (fields.suite_id !== undefined) row.suite_id = fields.suite_id;
    row.updated_by = fields.updated_by;
    row.updated_at = this.tick();
    return row;
  }

  async softDelete(id: string, actorId: string): Promise<CaseRow | null> {
    const row = await this.findLiveById(id);
    if (!row) return null;
    const now = this.tick();
    row.deleted_at = now;
    row.updated_at = now;
    row.updated_by = actorId;
    return row;
  }

  async setSuiteForIds(ids: string[], suiteId: string, actorId: string): Promise<number> {
    const rows = this.cases.filter(
      (row) => ids.includes(row.id) && row.deleted_at === null,
    );
    for (const row of rows) {
      row.suite_id = suiteId;
      row.updated_by = actorId;
      row.updated_at = this.tick();
    }
    return rows.length;
  }

  private matchesFilter(row: CaseRow, filter: CaseListFilter): boolean {
    if (row.project_id !== filter.projectId || row.deleted_at !== null) return false;
    if (filter.suiteIds !== null) {
      if (row.suite_id === null || !filter.suiteIds.includes(row.suite_id)) return false;
    }
    if (filter.query !== null) {
      const needle = filter.query.replace(/\\([\\%_])/g, '$1').toLowerCase();
      if (!row.title.toLowerCase().includes(needle)) return false;
    }
    if (filter.priorities !== null && !filter.priorities.includes(row.priority)) return false;
    if (filter.types !== null && !filter.types.includes(row.type)) return false;
    if (filter.tags !== null && !filter.tags.every((tag) => row.tags.includes(tag))) return false;
    return true;
  }

  private filtered(filter: CaseListFilter): CaseRow[] {
    return this.cases.filter((row) => this.matchesFilter(row, filter));
  }

  async countForList(filter: CaseListFilter): Promise<number> {
    return this.filtered(filter).length;
  }

  private compareForSort(a: CaseRow, b: CaseRow, sort: string): number {
    const descending = sort.startsWith('-');
    const key = descending ? sort.slice(1) : sort;
    let primary: number;
    if (key === 'title') primary = a.title.toLowerCase().localeCompare(b.title.toLowerCase());
    else if (key === 'updated_at') primary = a.updated_at.getTime() - b.updated_at.getTime();
    else if (key === 'priority') primary = CASE_PRIORITY_RANK[a.priority] - CASE_PRIORITY_RANK[b.priority];
    else primary = a.case_number - b.case_number;
    if (primary !== 0) return descending ? -primary : primary;
    return a.case_number - b.case_number;
  }

  async listPage(
    filter: CaseListFilter & { sort: string; limit: number; offset: number },
  ): Promise<CaseListRow[]> {
    return this.filtered(filter)
      .sort((a, b) => this.compareForSort(a, b, filter.sort))
      .slice(filter.offset, filter.offset + filter.limit)
      .map((row) => ({
        ...row,
        step_count: this.steps.filter((step) => step.case_id === row.id).length,
      }));
  }

  async insertHistory(entry: CaseHistoryWrite): Promise<void> {
    this.history.push({
      id: `h-${this.nextId++}`,
      case_id: entry.case_id,
      actor_id: entry.actor_id,
      action: entry.action,
      changes: JSON.parse(JSON.stringify(entry.changes)) as Record<string, unknown>,
      created_at: this.tick(),
    });
  }

  async countHistory(caseId: string): Promise<number> {
    return this.history.filter((row) => row.case_id === caseId).length;
  }

  async listHistory(
    caseId: string,
    params: { limit: number; offset: number },
  ): Promise<CaseHistoryRow[]> {
    return this.history
      .filter((row) => row.case_id === caseId)
      .sort(
        (a, b) =>
          b.created_at.getTime() - a.created_at.getTime() || b.id.localeCompare(a.id),
      )
      .slice(params.offset, params.offset + params.limit);
  }

  historyFor(caseId: string): CaseHistoryRow[] {
    return this.history.filter((row) => row.case_id === caseId);
  }

  caseById(id: string): CaseRow {
    const row = this.cases.find((entry) => entry.id === id);
    if (!row) throw new Error(`no case ${id}`);
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

function createDto(overrides: Partial<CreateCaseDto> = {}): CreateCaseDto {
  return {
    suite_id: 's-root',
    title: 'Pay with saved card',
    priority: 'high',
    type: 'functional',
    ...overrides,
  };
}

function updateDto(overrides: Partial<UpdateCaseDto> = {}): UpdateCaseDto {
  return { ...overrides };
}

describe('CasesService (unit, in-memory cases)', () => {
  let service: CasesService;
  let store: FakeStore;

  beforeEach(async () => {
    store = new FakeStore();
    store.seed();
    const moduleRef = await Test.createTestingModule({
      providers: [{ provide: CasesStore, useValue: store }, CasesService],
    }).compile();
    service = moduleRef.get(CasesService);
  });

  describe('list', () => {
    it('returns live cases by case_number with step counts and pagination meta', async () => {
      store.addCase({ title: 'Second', caseNumber: 2, steps: [{ text: 'a', expected_result: null }] });
      store.addCase({ title: 'First', caseNumber: 1 });
      store.addCase({ title: 'Gone', caseNumber: 3, deleted: true });

      const result = await service.list(AS('viewer'), 'p-1', {});

      expect(result.data.map((row) => row.case_number)).toEqual([1, 2]);
      expect(result.data.map((row) => row.display_id)).toEqual(['C1', 'C2']);
      expect(result.data[1]!.step_count).toBe(1);
      expect(result.data[0]!.step_count).toBe(0);
      expect(result.data[0]).not.toHaveProperty('steps');
      expect(result.data[0]).not.toHaveProperty('preconditions');
      expect(result.meta).toEqual({ page: 1, limit: 25, total: 2, total_pages: 1 });
    });

    it('restricts to a suite and its descendants by default, direct children only when asked', async () => {
      store.addCase({ title: 'Root', suiteId: 's-root', caseNumber: 1 });
      store.addCase({ title: 'Child', suiteId: 's-child', caseNumber: 2 });
      store.addCase({ title: 'Grand', suiteId: 's-grand', caseNumber: 3 });
      store.addCase({ title: 'Other', suiteId: 's-other', caseNumber: 4 });

      const subtree = await service.list(AS('tester'), 'p-1', { suite_id: 's-root' });
      expect(subtree.data.map((row) => row.title)).toEqual(['Root', 'Child', 'Grand']);

      const direct = await service.list(AS('tester'), 'p-1', {
        suite_id: 's-child',
        include_descendants: false,
      });
      expect(direct.data.map((row) => row.title)).toEqual(['Child']);
    });

    it('applies query, priority/type OR and tag AND filters together', async () => {
      store.addCase({
        title: 'Pay with saved card',
        priority: 'high',
        type: 'functional',
        tags: ['payments', 'smoke'],
        caseNumber: 1,
      });
      store.addCase({
        title: 'Pay with new card',
        priority: 'low',
        type: 'smoke',
        tags: ['payments'],
        caseNumber: 2,
      });
      store.addCase({
        title: 'Refund order',
        priority: 'high',
        type: 'functional',
        tags: ['payments', 'smoke'],
        caseNumber: 3,
      });

      const byQuery = await service.list(AS('admin'), 'p-1', { query: 'SAVED' });
      expect(byQuery.data.map((row) => row.title)).toEqual(['Pay with saved card']);

      const byPriority = await service.list(AS('admin'), 'p-1', {
        priority: ['high', 'low'],
      });
      expect(byPriority.data).toHaveLength(3);
      const byType = await service.list(AS('admin'), 'p-1', { type: ['smoke'] });
      expect(byType.data.map((row) => row.title)).toEqual(['Pay with new card']);

      const byTags = await service.list(AS('admin'), 'p-1', { tag: ['payments', 'smoke'] });
      expect(byTags.data.map((row) => row.title)).toEqual([
        'Pay with saved card',
        'Refund order',
      ]);

      const combined = await service.list(AS('admin'), 'p-1', {
        query: 'pay',
        priority: ['high'],
        tag: ['smoke'],
      });
      expect(combined.data.map((row) => row.title)).toEqual(['Pay with saved card']);
    });

    it('treats LIKE wildcards in the query as literal text', async () => {
      store.addCase({ title: '100% coverage', caseNumber: 1 });
      store.addCase({ title: '1000 coverage', caseNumber: 2 });

      const result = await service.list(AS('admin'), 'p-1', { query: '100%' });
      expect(result.data.map((row) => row.title)).toEqual(['100% coverage']);
    });

    it('paginates and sorts with an explicit direction', async () => {
      for (const [index, title] of ['bravo', 'alpha', 'charlie', 'delta'].entries()) {
        store.addCase({ title, caseNumber: index + 1 });
      }

      const page2 = await service.list(AS('viewer'), 'p-1', { page: 2, limit: 3 });
      expect(page2.data.map((row) => row.case_number)).toEqual([4]);
      expect(page2.meta).toEqual({ page: 2, limit: 3, total: 4, total_pages: 2 });

      const titles = await service.list(AS('viewer'), 'p-1', { sort: 'title' });
      expect(titles.data.map((row) => row.title)).toEqual([
        'alpha',
        'bravo',
        'charlie',
        'delta',
      ]);

      const newest = await service.list(AS('viewer'), 'p-1', { sort: '-updated_at' });
      expect(newest.data.map((row) => row.case_number)).toEqual([4, 3, 2, 1]);
    });

    it('sorts by priority severity (critical first), not alphabetically', async () => {
      const priorities: CasePriority[] = ['low', 'high', 'critical', 'medium', 'high'];
      priorities.forEach((priority, index) =>
        store.addCase({ title: `case ${index + 1}`, caseNumber: index + 1, priority }),
      );

      const ascending = await service.list(AS('viewer'), 'p-1', { sort: 'priority' });
      expect(ascending.data.map((row) => row.priority)).toEqual([
        'critical',
        'high',
        'high',
        'medium',
        'low',
      ]);
      // Equal priorities keep case_number ascending as the tiebreaker.
      expect(ascending.data.map((row) => row.case_number)).toEqual([3, 2, 5, 4, 1]);

      const descending = await service.list(AS('viewer'), 'p-1', { sort: '-priority' });
      expect(descending.data.map((row) => row.priority)).toEqual([
        'low',
        'medium',
        'high',
        'high',
        'critical',
      ]);
      // The tiebreaker stays ascending even when the primary key reverses.
      expect(descending.data.map((row) => row.case_number)).toEqual([1, 4, 2, 5, 3]);
    });

    it('404s an unknown project and hides an archived one from non-Admins', async () => {
      store.addCase({ projectId: 'p-arch', suiteId: 's-arch', caseNumber: 1 });

      await expect(service.list(AS('admin'), 'p-missing', {})).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(service.list(AS('lead'), 'p-arch', {})).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      const adminView = await service.list(AS('admin'), 'p-arch', {});
      expect(adminView.data).toHaveLength(1);
    });
  });

  describe('create', () => {
    it('allocates project-scoped numbers in sequence and keeps counters separate per project', async () => {
      const first = await service.create(AS('admin'), 'p-1', createDto());
      const second = await service.create(AS('lead'), 'p-1', createDto({ title: 'Next' }));
      const otherProject = await service.create(
        AS('admin'),
        'p-2',
        createDto({ suite_id: 's-project2' }),
      );

      expect([first.case_number, second.case_number, otherProject.case_number]).toEqual([1, 2, 1]);
      expect([first.display_id, second.display_id, otherProject.display_id]).toEqual([
        'C1',
        'C2',
        'C1',
      ]);
    });

    it('stores the validated fields, ordered steps, normalised tags and the author', async () => {
      const created = await service.create(
        AS('lead'),
        'p-1',
        createDto({
          title: 'Pay with saved card',
          preconditions: '  Customer has a saved card  ',
          steps: [
            { text: '  Open checkout ', expected_result: ' Cart total is shown ' },
            { text: ' Pay ', expected_result: '' },
          ],
          tags: [' Payments ', 'smoke', 'payments'],
          estimate_minutes: 15,
        }),
      );

      expect(created).toMatchObject({
        project_id: 'p-1',
        suite_id: 's-root',
        title: 'Pay with saved card',
        preconditions: 'Customer has a saved card',
        priority: 'high',
        type: 'functional',
        tags: ['payments', 'smoke'],
        estimate_minutes: 15,
        created_by: 'u-lead',
        updated_by: 'u-lead',
      });
      expect(created.steps).toEqual([
        { position: 1, text: 'Open checkout', expected_result: 'Cart total is shown' },
        { position: 2, text: 'Pay', expected_result: null },
      ]);
    });

    it('defaults optional fields and writes the created history row', async () => {
      const created = await service.create(
        AS('admin'),
        'p-1',
        createDto({ preconditions: '   ', steps: [], tags: [] }),
      );

      expect(created.preconditions).toBeNull();
      expect(created.steps).toEqual([]);
      expect(created.tags).toEqual([]);
      expect(created.estimate_minutes).toBeNull();
      expect(store.historyFor(created.id)).toEqual([
        expect.objectContaining({ action: 'created', changes: {}, actor_id: 'u-admin' }),
      ]);
    });

    it('404s an unknown suite or a suite from another project without consuming a number', async () => {
      await expect(
        service.create(AS('admin'), 'p-1', createDto({ suite_id: 's-missing' })),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        service.create(AS('admin'), 'p-1', createDto({ suite_id: 's-project2' })),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      const created = await service.create(AS('admin'), 'p-1', createDto());
      expect(created.case_number).toBe(1);
    });

    it('409s every write in an archived project, including for an Admin', async () => {
      await expect(
        service.create(AS('admin'), 'p-arch', createDto({ suite_id: 's-arch' })),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        details: [{ field: 'project_id', issue: 'project is archived' }],
      });
    });

    it('404s an unknown project', async () => {
      await expect(service.create(AS('admin'), 'p-missing', createDto())).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  describe('detail', () => {
    it('returns ordered steps for a live case', async () => {
      const row = store.addCase({
        title: 'Checkout',
        steps: [
          { text: 'Open', expected_result: null },
          { text: 'Pay', expected_result: 'Order confirmed' },
        ],
      });

      const detail = await service.detail(AS('viewer'), row.id);
      expect(detail.display_id).toBe(`C${row.case_number}`);
      expect(detail.steps.map((step) => step.position)).toEqual([1, 2]);
    });

    it('404s unknown and soft-deleted cases', async () => {
      const row = store.addCase({ deleted: true });
      await expect(service.detail(AS('admin'), 'c-missing')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(service.detail(AS('admin'), row.id)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('hides an archived project from non-Admins but serves it to an Admin', async () => {
      const row = store.addCase({ projectId: 'p-arch', suiteId: 's-arch' });
      await expect(service.detail(AS('tester'), row.id)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(service.detail(AS('admin'), row.id)).resolves.toMatchObject({
        id: row.id,
      });
    });
  });

  describe('update', () => {
    it('writes one updated row with from → to for the changed fields only', async () => {
      const created = await service.create(AS('admin'), 'p-1', createDto());

      const updated = await service.update(
        AS('lead'),
        created.id,
        updateDto({ title: 'Pay with card', priority: 'critical' }),
      );

      expect(updated).toMatchObject({
        title: 'Pay with card',
        priority: 'critical',
        type: 'functional',
        updated_by: 'u-lead',
      });
      const history = store.historyFor(created.id);
      expect(history.map((row) => row.action)).toEqual(['created', 'updated']);
      expect(history[1]!.changes).toEqual({
        title: { from: 'Pay with saved card', to: 'Pay with card' },
        priority: { from: 'high', to: 'critical' },
      });
    });

    it('writes nothing when the patch changes no stored value', async () => {
      const created = await service.create(AS('admin'), 'p-1', createDto());
      const before = store.caseById(created.id);
      const updatedAt = before.updated_at.getTime();

      const unchanged = await service.update(
        AS('admin'),
        created.id,
        updateDto({
          title: created.title,
          tags: [...created.tags],
          steps: created.steps.map((step) => ({
            text: step.text,
            expected_result: step.expected_result,
          })),
        }),
      );

      expect(unchanged.updated_at).toBe(created.updated_at);
      expect(store.caseById(created.id).updated_at.getTime()).toBe(updatedAt);
      expect(store.historyFor(created.id).map((row) => row.action)).toEqual(['created']);
    });

    it('replaces steps wholesale and summarises the change by count', async () => {
      const created = await service.create(
        AS('admin'),
        'p-1',
        createDto({
          steps: [
            { text: 'Open', expected_result: null },
            { text: 'Pay', expected_result: 'Done' },
          ],
        }),
      );

      const updated = await service.update(
        AS('admin'),
        created.id,
        updateDto({
          steps: [
            { text: 'Open checkout', expected_result: null },
            { text: 'Pay', expected_result: 'Done' },
            { text: 'Confirm', expected_result: 'Email sent' },
          ],
        }),
      );

      expect(updated.steps.map((step) => step.position)).toEqual([1, 2, 3]);
      const updatedRow = store
        .historyFor(created.id)
        .find((row) => row.action === 'updated');
      expect(updatedRow?.changes).toEqual({ steps: { from: 2, to: 3 } });
    });

    it('clears preconditions and the estimate with an explicit null', async () => {
      const created = await service.create(
        AS('admin'),
        'p-1',
        createDto({ preconditions: 'Saved card', estimate_minutes: 15 }),
      );

      const updated = await service.update(
        AS('admin'),
        created.id,
        updateDto({ preconditions: null, estimate_minutes: null }),
      );

      expect(updated.preconditions).toBeNull();
      expect(updated.estimate_minutes).toBeNull();
      expect(store.historyFor(created.id)[1]!.changes).toEqual({
        preconditions: { from: 'Saved card', to: null },
        estimate_minutes: { from: 15, to: null },
      });
    });

    it('writes a moved row for a suite change, alongside updated when other fields moved', async () => {
      const created = await service.create(AS('admin'), 'p-1', createDto());

      await service.update(AS('admin'), created.id, updateDto({ suite_id: 's-child' }));
      expect(store.historyFor(created.id).map((row) => row.action)).toEqual([
        'created',
        'moved',
      ]);
      expect(store.historyFor(created.id)[1]!.changes).toEqual({
        suite_id: { from: 's-root', to: 's-child' },
      });

      await service.update(
        AS('admin'),
        created.id,
        updateDto({ suite_id: 's-grand', title: 'Moved and renamed' }),
      );
      expect(store.historyFor(created.id).map((row) => row.action)).toEqual([
        'created',
        'moved',
        'updated',
        'moved',
      ]);
    });

    it('rejects an empty patch with a VALIDATION_ERROR listing the fields', async () => {
      const created = await service.create(AS('admin'), 'p-1', createDto());
      await expect(service.update(AS('admin'), created.id, updateDto())).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: expect.arrayContaining([
          { field: 'title', issue: 'at least one field must be provided' },
        ]),
      });
    });

    it('404s an unknown target suite and leaves the case untouched', async () => {
      const created = await service.create(AS('admin'), 'p-1', createDto());
      await expect(
        service.update(AS('admin'), created.id, updateDto({ suite_id: 's-project2' })),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(store.caseById(created.id).suite_id).toBe('s-root');
      expect(store.historyFor(created.id)).toHaveLength(1);
    });

    it('404s a soft-deleted case and 409s an archived project', async () => {
      const deleted = store.addCase({ deleted: true });
      await expect(
        service.update(AS('admin'), deleted.id, updateDto({ title: 'x' })),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      const archived = store.addCase({ projectId: 'p-arch', suiteId: 's-arch' });
      await expect(
        service.update(AS('admin'), archived.id, updateDto({ title: 'x' })),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  describe('remove', () => {
    it('soft deletes: hidden from read paths, number stays reserved, history survives', async () => {
      const created = await service.create(AS('admin'), 'p-1', createDto());

      await service.remove(AS('lead'), created.id);

      expect(store.caseById(created.id).deleted_at).not.toBeNull();
      await expect(service.detail(AS('admin'), created.id)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect((await service.list(AS('admin'), 'p-1', {})).data).toEqual([]);
      expect(store.historyFor(created.id).map((row) => row.action)).toEqual([
        'created',
        'deleted',
      ]);
      expect(store.historyFor(created.id)[1]!.changes).toEqual({});

      const next = await service.create(AS('admin'), 'p-1', createDto({ title: 'Renumbered' }));
      expect(next.case_number).toBe(2);
      expect(next.display_id).toBe('C2');
    });

    it('404s a second DELETE and hides the deleted case history', async () => {
      const created = await service.create(AS('admin'), 'p-1', createDto());
      await service.remove(AS('admin'), created.id);

      await expect(service.remove(AS('admin'), created.id)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(service.history(AS('admin'), created.id, {})).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('409s an archived project', async () => {
      const row = store.addCase({ projectId: 'p-arch', suiteId: 's-arch' });
      await expect(service.remove(AS('admin'), row.id)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });
  });

  describe('bulkMove', () => {
    it('moves cases atomically and writes one moved row per re-assigned case', async () => {
      const first = await service.create(AS('admin'), 'p-1', createDto({ title: 'One' }));
      const second = await service.create(AS('admin'), 'p-1', createDto({ title: 'Two' }));

      const result = await service.bulkMove(AS('lead'), 'p-1', {
        case_ids: [first.id, second.id],
        suite_id: 's-grand',
      });

      expect(result).toEqual({ moved: 2, case_ids: [first.id, second.id] });
      expect(store.caseById(first.id).suite_id).toBe('s-grand');
      expect(store.caseById(second.id).suite_id).toBe('s-grand');
      expect(store.historyFor(first.id).map((row) => row.action)).toEqual([
        'created',
        'moved',
      ]);
      expect(store.historyFor(first.id)[1]!.changes).toEqual({
        suite_id: { from: 's-root', to: 's-grand' },
      });
    });

    it('de-duplicates ids and reports only the cases that actually moved', async () => {
      const alreadyThere = await service.create(
        AS('admin'),
        'p-1',
        createDto({ suite_id: 's-child' }),
      );
      const moving = await service.create(AS('admin'), 'p-1', createDto({ title: 'Move me' }));

      const result = await service.bulkMove(AS('admin'), 'p-1', {
        case_ids: [alreadyThere.id, moving.id, moving.id],
        suite_id: 's-child',
      });

      expect(result).toEqual({ moved: 1, case_ids: [moving.id] });
      expect(store.historyFor(alreadyThere.id)).toHaveLength(1);
      expect(store.historyFor(moving.id)).toHaveLength(2);
    });

    it('400s an unknown or deleted case id and moves nothing (atomic)', async () => {
      const first = await service.create(AS('admin'), 'p-1', createDto());
      const deleted = store.addCase({ deleted: true, suiteId: 's-root' });

      const before = store.caseById(first.id).suite_id;
      await expect(
        service.bulkMove(AS('admin'), 'p-1', {
          case_ids: [first.id, 'c-missing'],
          suite_id: 's-other',
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(
        service.bulkMove(AS('admin'), 'p-1', {
          case_ids: [first.id, deleted.id],
          suite_id: 's-other',
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

      expect(store.caseById(first.id).suite_id).toBe(before);
      expect(store.historyFor(first.id)).toHaveLength(1);
    });

    it('400s a target suite from another project and 404s an unknown suite', async () => {
      const created = await service.create(AS('admin'), 'p-1', createDto());
      await expect(
        service.bulkMove(AS('admin'), 'p-1', {
          case_ids: [created.id],
          suite_id: 's-project2',
        }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [{ field: 'suite_id', issue: 'must belong to the same project' }],
      });
      await expect(
        service.bulkMove(AS('admin'), 'p-1', {
          case_ids: [created.id],
          suite_id: 's-missing',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('404s an unknown project and 409s an archived one', async () => {
      const created = await service.create(AS('admin'), 'p-1', createDto());
      await expect(
        service.bulkMove(AS('admin'), 'p-missing', {
          case_ids: [created.id],
          suite_id: 's-root',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        service.bulkMove(AS('admin'), 'p-arch', {
          case_ids: [created.id],
          suite_id: 's-arch',
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  describe('history', () => {
    it('returns newest first with pagination meta', async () => {
      const created = await service.create(AS('admin'), 'p-1', createDto());
      await service.update(AS('admin'), created.id, updateDto({ title: 'First edit' }));
      await service.update(AS('admin'), created.id, updateDto({ title: 'Second edit' }));

      const all = await service.history(AS('viewer'), created.id, {});
      expect(all.data.map((row) => row.action)).toEqual(['updated', 'updated', 'created']);
      expect(all.meta).toEqual({ page: 1, limit: 25, total: 3, total_pages: 1 });

      const firstPage = await service.history(AS('viewer'), created.id, { page: 1, limit: 2 });
      expect(firstPage.data).toHaveLength(2);
      expect(firstPage.meta).toEqual({ page: 1, limit: 2, total: 3, total_pages: 2 });
      const secondPage = await service.history(AS('viewer'), created.id, { page: 2, limit: 2 });
      expect(secondPage.data.map((row) => row.action)).toEqual(['created']);
    });

    it('404s an unknown case', async () => {
      await expect(service.history(AS('admin'), 'c-missing', {})).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });
});
