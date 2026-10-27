/* eslint-disable @typescript-eslint/require-await -- the in-memory fake mirrors
   the async store surface without doing I/O. */
import { Test } from '@nestjs/testing';
import { AuthUser, UserRole } from '../auth/current-user';
import { Queryable } from '../db/queryable';
import { ErrorCode } from '../errors';
import { RunsStore, RunRow, ProjectRef } from '../runs/runs.store';
import { MilestonesService } from './milestones.service';
import {
  MilestoneAggRow,
  MilestoneListFilter,
  MilestoneRow,
  MilestonesStore,
  MilestoneUpdateFields,
} from './milestones.store';

/**
 * Decision-logic tests for MilestonesService over an in-memory fake of the
 * milestones/runs tables. SQL semantics (filter, ordering, derived status and
 * rollup) are mirrored here; the real SQL path is covered by
 * test/milestones.e2e-spec.ts.
 *
 * `transaction` snapshots and restores state so the attach/detach/delete
 * atomicity claims are tested, not just stated.
 */
interface FakeRun {
  id: string;
  project_id: string;
  milestone_id: string | null;
  completed_at: Date | null;
  deleted_at: Date | null;
}

/** Per-milestone rollup numbers, seeded like the grouped SQL aggregate. */
interface FakeCounts {
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  retest: number;
  skipped: number;
  untested: number;
}

const ZERO_COUNTS: FakeCounts = {
  total: 0,
  passed: 0,
  failed: 0,
  blocked: 0,
  retest: 0,
  skipped: 0,
  untested: 0,
};

class FakeStore {
  projects: ProjectRef[] = [];
  milestones: MilestoneRow[] = [];
  runs: FakeRun[] = [];
  counts: Record<string, FakeCounts> = {};
  /** Test hook: throw on soft delete to exercise rollback. */
  failSoftDelete = false;

  private nextId = 1;
  private clock = 0;

  seed(): void {
    this.projects = [
      { id: 'p-1', status: 'active' },
      { id: 'p-2', status: 'active' },
      { id: 'p-arch', status: 'archived' },
    ];
    this.milestones = [];
    this.runs = [];
    this.counts = {};
    this.nextId = 1;
    this.clock = 0;
    this.failSoftDelete = false;
  }

  private tick(): Date {
    this.clock += 1_000;
    return new Date(Date.UTC(2026, 9, 27, 9, 0, 0) + this.clock);
  }

  addMilestone(overrides: Partial<MilestoneRow> & { counts?: Partial<FakeCounts> } = {}): MilestoneRow {
    const now = this.tick();
    const id = overrides.id ?? `ms-${this.nextId++}`;
    const row: MilestoneRow = {
      id,
      project_id: overrides.project_id ?? 'p-1',
      name: overrides.name ?? 'Release 2.4',
      description: overrides.description ?? null,
      due_date: overrides.due_date ?? null,
      created_by: overrides.created_by ?? 'u-admin',
      updated_by: overrides.updated_by ?? 'u-admin',
      deleted_at: overrides.deleted_at ?? null,
      created_at: overrides.created_at ?? now,
      updated_at: overrides.updated_at ?? now,
    };
    this.milestones.push(row);
    this.counts[id] = { ...ZERO_COUNTS, ...overrides.counts };
    return row;
  }

  addRun(overrides: Partial<FakeRun> = {}): FakeRun {
    const run: FakeRun = {
      id: overrides.id ?? `run-${this.nextId++}`,
      project_id: overrides.project_id ?? 'p-1',
      milestone_id: overrides.milestone_id ?? null,
      completed_at: overrides.completed_at ?? null,
      deleted_at: overrides.deleted_at ?? null,
    };
    this.runs.push(run);
    return run;
  }

  /** Mirrors the derived status + grouped rollup of `milestoneSelect()`. */
  private agg(row: MilestoneRow): MilestoneAggRow {
    const live = this.runs.filter(
      (run) => run.milestone_id === row.id && run.deleted_at === null,
    );
    const runCount = live.length;
    const completedRunCount = live.filter((run) => run.completed_at !== null).length;
    const counts = this.counts[row.id] ?? ZERO_COUNTS;
    return {
      ...row,
      run_count: runCount,
      completed_run_count: completedRunCount,
      status: runCount > 0 && completedRunCount === runCount ? 'completed' : 'open',
      total: counts.total,
      passed: counts.passed,
      failed: counts.failed,
      blocked: counts.blocked,
      retest: counts.retest,
      skipped: counts.skipped,
      untested: counts.untested,
    };
  }

  async transaction<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
    const snapshot = {
      milestones: this.milestones.map((row) => ({ ...row })),
      runs: this.runs.map((row) => ({ ...row })),
      counts: Object.fromEntries(
        Object.entries(this.counts).map(([id, value]) => [id, { ...value }]),
      ),
      nextId: this.nextId,
      clock: this.clock,
    };
    try {
      return await fn({} as Queryable);
    } catch (error) {
      this.milestones = snapshot.milestones;
      this.runs = snapshot.runs;
      this.counts = snapshot.counts;
      this.nextId = snapshot.nextId;
      this.clock = snapshot.clock;
      throw error;
    }
  }

  async findProject(projectId: string): Promise<ProjectRef | null> {
    return this.projects.find((project) => project.id === projectId) ?? null;
  }

  async findLiveById(id: string): Promise<MilestoneRow | null> {
    const row = this.milestones.find(
      (milestone) => milestone.id === id && milestone.deleted_at === null,
    );
    return row ? { ...row } : null;
  }

  async findLiveByIdForUpdate(id: string): Promise<MilestoneRow | null> {
    return this.findLiveById(id);
  }

  async findWithCounts(id: string): Promise<MilestoneAggRow | null> {
    const row = await this.findLiveById(id);
    return row ? this.agg(row) : null;
  }

  async findIdByNameIgnoreCase(
    projectId: string,
    name: string,
    excludeId: string | null,
  ): Promise<string | null> {
    const row = this.milestones.find(
      (milestone) =>
        milestone.project_id === projectId &&
        milestone.deleted_at === null &&
        milestone.name.toLowerCase() === name.toLowerCase() &&
        (excludeId === null || milestone.id !== excludeId),
    );
    return row?.id ?? null;
  }

  async insert(row: {
    project_id: string;
    name: string;
    description: string | null;
    due_date: string | null;
    created_by: string;
  }): Promise<MilestoneRow> {
    const created = this.addMilestone({
      project_id: row.project_id,
      name: row.name,
      description: row.description,
      due_date: row.due_date,
      created_by: row.created_by,
      updated_by: row.created_by,
    });
    return { ...created };
  }

  async update(id: string, fields: MilestoneUpdateFields): Promise<MilestoneRow | null> {
    const row = this.milestones.find(
      (milestone) => milestone.id === id && milestone.deleted_at === null,
    );
    if (!row) return null;
    if (fields.name !== undefined) row.name = fields.name;
    if (fields.description !== undefined) row.description = fields.description;
    if (fields.due_date !== undefined) row.due_date = fields.due_date;
    row.updated_by = fields.updated_by;
    row.updated_at = this.tick();
    return { ...row };
  }

  async softDelete(id: string, actorId: string): Promise<MilestoneRow | null> {
    if (this.failSoftDelete) {
      throw new Error('soft delete failed');
    }
    const row = this.milestones.find(
      (milestone) => milestone.id === id && milestone.deleted_at === null,
    );
    if (!row) return null;
    row.deleted_at = this.tick();
    row.updated_by = actorId;
    row.updated_at = this.tick();
    return { ...row };
  }

  private matches(milestone: MilestoneRow, filter: MilestoneListFilter): boolean {
    if (milestone.project_id !== filter.projectId || milestone.deleted_at !== null) return false;
    if (filter.query !== null) {
      const needle = filter.query.replace(/[\\%_]/g, '').toLowerCase();
      if (!milestone.name.toLowerCase().includes(needle)) return false;
    }
    if (filter.status !== null && this.agg(milestone).status !== filter.status) return false;
    return true;
  }

  async countForList(filter: MilestoneListFilter): Promise<number> {
    return this.milestones.filter((milestone) => this.matches(milestone, filter)).length;
  }

  async listPage(
    filter: MilestoneListFilter & { sort: string; limit: number; offset: number },
  ): Promise<MilestoneAggRow[]> {
    const descending = filter.sort.startsWith('-');
    const key = descending ? filter.sort.slice(1) : filter.sort;
    const compare = (a: MilestoneAggRow, b: MilestoneAggRow): number => {
      let primary: number;
      if (key === 'name') primary = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      else if (key === 'created_at') primary = a.created_at.getTime() - b.created_at.getTime();
      else if (key === 'updated_at') primary = a.updated_at.getTime() - b.updated_at.getTime();
      else {
        // Null due dates sort last in both directions.
        if (a.due_date === null && b.due_date === null) primary = 0;
        else if (a.due_date === null) return 1;
        else if (b.due_date === null) return -1;
        else primary = a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0;
      }
      if (primary !== 0) return descending ? -primary : primary;
      return a.id.localeCompare(b.id);
    };
    return this.milestones
      .filter((milestone) => this.matches(milestone, filter))
      .map((milestone) => this.agg(milestone))
      .sort(compare)
      .slice(filter.offset, filter.offset + filter.limit);
  }
}

/** Only the run-side surface MilestonesService touches. */
class FakeRunsStore {
  constructor(private readonly store: FakeStore) {}

  async findLiveByIdForUpdate(id: string): Promise<RunRow | null> {
    const run = this.store.runs.find((row) => row.id === id && row.deleted_at === null);
    if (!run) return null;
    // The service only reads id/project_id/milestone_id off the locked row.
    return {
      id: run.id,
      project_id: run.project_id,
      plan_id: null,
      milestone_id: run.milestone_id,
      name: 'Run',
      description: null,
      start_date: null,
      due_date: null,
      completed_at: run.completed_at,
      completed_by: null,
      created_by: 'u-admin',
      updated_by: 'u-admin',
      deleted_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };
  }

  async findLiveByIdsForUpdate(ids: string[]): Promise<RunRow[]> {
    const rows: RunRow[] = [];
    for (const id of ids) {
      const row = await this.findLiveByIdForUpdate(id);
      if (row) rows.push(row);
    }
    return rows;
  }

  async setMilestone(ids: string[], milestoneId: string | null): Promise<void> {
    for (const run of this.store.runs) {
      if (ids.includes(run.id) && run.deleted_at === null) run.milestone_id = milestoneId;
    }
  }

  async detachMilestoneRuns(milestoneId: string): Promise<number> {
    let count = 0;
    for (const run of this.store.runs) {
      if (run.milestone_id === milestoneId) {
        run.milestone_id = null;
        count += 1;
      }
    }
    return count;
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

async function expectCode(promise: Promise<unknown>, code: ErrorCode): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

describe('MilestonesService (unit, in-memory milestones)', () => {
  let service: MilestonesService;
  let store: FakeStore;

  beforeEach(async () => {
    store = new FakeStore();
    store.seed();
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: MilestonesStore, useValue: store },
        { provide: RunsStore, useValue: new FakeRunsStore(store) },
        MilestonesService,
      ],
    }).compile();
    service = moduleRef.get(MilestonesService);
  });

  describe('list', () => {
    it('returns live milestones with derived counts and pagination meta', async () => {
      const older = store.addMilestone({
        name: 'Older',
        created_at: new Date('2026-10-01T00:00:00Z'),
        counts: { total: 3, passed: 1, untested: 1 },
      });
      store.addRun({ milestone_id: older.id, completed_at: new Date() });
      store.addRun({ milestone_id: older.id });
      store.addMilestone({ name: 'Deleted', deleted_at: new Date('2026-10-06T00:00:00Z') });
      store.addMilestone({ name: 'Other project', project_id: 'p-2' });

      const result = await service.list(AS('viewer'), 'p-1', {});

      expect(result.data.map((row) => row.id)).toEqual([older.id]);
      expect(result.meta).toEqual({ page: 1, limit: 25, total: 1, total_pages: 1 });
      expect(result.data[0]).toMatchObject({
        run_count: 2,
        status: 'open',
        counts: { total: 3, passed: 1, untested: 1, percent_complete: 67 },
      });
    });

    it('derives completed only when every live run is completed', async () => {
      const milestone = store.addMilestone();
      store.addRun({ milestone_id: milestone.id, completed_at: new Date() });
      store.addRun({ milestone_id: milestone.id, deleted_at: new Date() });

      const completed = await service.list(AS('admin'), 'p-1', { status: 'completed' });
      expect(completed.data.map((row) => row.status)).toEqual(['completed']);

      store.addRun({ milestone_id: milestone.id });
      const open = await service.list(AS('admin'), 'p-1', { status: 'open' });
      expect(open.data.map((row) => row.status)).toEqual(['open']);
    });

    it('a milestone with no runs is open and filters out of completed', async () => {
      store.addMilestone({ name: 'Empty' });

      const open = await service.list(AS('admin'), 'p-1', { status: 'open' });
      expect(open.data.map((row) => [row.name, row.status, row.run_count])).toEqual([
        ['Empty', 'open', 0],
      ]);
      const completed = await service.list(AS('admin'), 'p-1', { status: 'completed' });
      expect(completed.data).toEqual([]);
    });

    it('applies the query substring and an explicit sort', async () => {
      store.addMilestone({ name: 'Alpha' });
      store.addMilestone({ name: 'Bravo' });

      const asc = await service.list(AS('admin'), 'p-1', { sort: 'name' });
      expect(asc.data.map((row) => row.name)).toEqual(['Alpha', 'Bravo']);

      const filtered = await service.list(AS('admin'), 'p-1', { query: 'brav' });
      expect(filtered.data.map((row) => row.name)).toEqual(['Bravo']);
      expect(filtered.meta.total).toBe(1);
    });

    it('sorts null due dates last in both directions by default and on request', async () => {
      store.addMilestone({ name: 'Dated', due_date: '2026-11-14' });
      store.addMilestone({ name: 'Undated', due_date: null });

      expect((await service.list(AS('admin'), 'p-1', {})).data.map((row) => row.name)).toEqual([
        'Dated',
        'Undated',
      ]);
      expect(
        (await service.list(AS('admin'), 'p-1', { sort: '-due_date' })).data.map((row) => row.name),
      ).toEqual(['Dated', 'Undated']);
    });

    it('paginates and 404s an unknown project, hiding archived from non-Admins', async () => {
      for (const name of ['A', 'B', 'C']) store.addMilestone({ name });

      const page2 = await service.list(AS('admin'), 'p-1', { page: 2, limit: 2 });
      expect(page2.data).toHaveLength(1);
      expect(page2.meta).toEqual({ page: 2, limit: 2, total: 3, total_pages: 2 });

      await expectCode(service.list(AS('admin'), 'nope', {}), 'NOT_FOUND');
      store.addMilestone({ project_id: 'p-arch' });
      await expectCode(service.list(AS('lead'), 'p-arch', {}), 'NOT_FOUND');
      await expect(service.list(AS('admin'), 'p-arch', {})).resolves.toMatchObject({
        meta: { total: 1 },
      });
    });
  });

  describe('create', () => {
    it('creates a fields-only milestone with zeroed counts, open status and audit', async () => {
      const created = await service.create(AS('lead'), 'p-1', {
        name: 'Release 2.4',
        description: 'Ship 2.4.',
        due_date: '2026-11-14',
      });

      expect(created).toMatchObject({
        project_id: 'p-1',
        name: 'Release 2.4',
        description: 'Ship 2.4.',
        due_date: '2026-11-14',
        status: 'open',
        run_count: 0,
        created_by: 'u-lead',
        updated_by: 'u-lead',
        counts: { total: 0, untested: 0, percent_complete: 0 },
      });
    });

    it('stores a blank description and an absent due date as null', async () => {
      const created = await service.create(AS('admin'), 'p-1', {
        name: 'M',
        description: '   ',
      });
      expect(created).toMatchObject({ description: null, due_date: null });
    });

    it('409s a duplicate name in the project, ignoring case and excluding deleted ones', async () => {
      await service.create(AS('admin'), 'p-1', { name: 'Release 2.4' });

      await expect(service.create(AS('lead'), 'p-1', { name: 'release 2.4' })).rejects.toMatchObject(
        { code: 'CONFLICT', details: [{ field: 'name', issue: 'already in use' }] },
      );

      // The same name in another project is fine.
      await expect(
        service.create(AS('admin'), 'p-2', { name: 'Release 2.4' }),
      ).resolves.toMatchObject({ project_id: 'p-2' });
    });

    it('frees a deleted milestone name for reuse', async () => {
      const gone = store.addMilestone({ name: 'Taken', deleted_at: new Date() });
      expect(gone.deleted_at).not.toBeNull();

      await expect(
        service.create(AS('admin'), 'p-1', { name: 'Taken' }),
      ).resolves.toMatchObject({ name: 'Taken' });
    });

    it('404s an unknown project and 409s an archived one for writers', async () => {
      await expectCode(service.create(AS('admin'), 'nope', { name: 'M' }), 'NOT_FOUND');
      await expectCode(service.create(AS('lead'), 'p-arch', { name: 'M' }), 'CONFLICT');
    });
  });

  describe('detail', () => {
    it('returns a live milestone with its derived rollup', async () => {
      const milestone = store.addMilestone({ counts: { total: 2, passed: 2 } });
      store.addRun({ milestone_id: milestone.id, completed_at: new Date() });

      const detail = await service.detail(AS('viewer'), milestone.id);
      expect(detail).toMatchObject({
        id: milestone.id,
        status: 'completed',
        run_count: 1,
        counts: { total: 2, passed: 2, percent_complete: 100 },
      });
    });

    it('404s unknown and deleted milestones and hides archived from non-Admins', async () => {
      const gone = store.addMilestone({ deleted_at: new Date() });
      await expectCode(service.detail(AS('admin'), 'nope'), 'NOT_FOUND');
      await expectCode(service.detail(AS('admin'), gone.id), 'NOT_FOUND');

      const archived = store.addMilestone({ project_id: 'p-arch' });
      await expectCode(service.detail(AS('lead'), archived.id), 'NOT_FOUND');
      await expect(service.detail(AS('admin'), archived.id)).resolves.toMatchObject({
        id: archived.id,
      });
    });
  });

  describe('update', () => {
    it('applies a non-empty subset and clears with explicit nulls', async () => {
      const milestone = store.addMilestone({ name: 'Old', description: 'x', due_date: '2026-11-01' });

      const updated = await service.update(AS('lead'), milestone.id, {
        name: 'New',
        description: null,
        due_date: null,
      });

      expect(updated).toMatchObject({
        name: 'New',
        description: null,
        due_date: null,
        updated_by: 'u-lead',
      });
    });

    it('400s an empty patch', async () => {
      const milestone = store.addMilestone();
      await expect(service.update(AS('admin'), milestone.id, {})).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [
          { field: 'name', issue: 'at least one field must be provided' },
          { field: 'description', issue: 'at least one field must be provided' },
          { field: 'due_date', issue: 'at least one field must be provided' },
        ],
      });
    });

    it('409s a rename onto another live name but allows changing its own case', async () => {
      const first = store.addMilestone({ name: 'Alpha' });
      store.addMilestone({ name: 'Bravo' });

      await expectCode(
        service.update(AS('admin'), first.id, { name: 'bravo' }),
        'CONFLICT',
      );
      await expect(
        service.update(AS('admin'), first.id, { name: 'ALPHA' }),
      ).resolves.toMatchObject({ name: 'ALPHA' });
    });

    it('404s an unknown or deleted milestone, 409s an archived project', async () => {
      const gone = store.addMilestone({ deleted_at: new Date() });
      await expectCode(service.update(AS('admin'), 'nope', { name: 'X' }), 'NOT_FOUND');
      await expectCode(service.update(AS('admin'), gone.id, { name: 'X' }), 'NOT_FOUND');

      const archived = store.addMilestone({ project_id: 'p-arch' });
      await expectCode(service.update(AS('admin'), archived.id, { name: 'X' }), 'CONFLICT');
    });

    it('changes no run dates when its own due date moves', async () => {
      const milestone = store.addMilestone({ due_date: '2026-11-01' });
      const run = store.addRun({ milestone_id: milestone.id });

      await service.update(AS('admin'), milestone.id, { due_date: '2026-11-21' });
      expect(store.runs.find((row) => row.id === run.id)?.milestone_id).toBe(milestone.id);
    });
  });

  describe('remove', () => {
    it('soft deletes and detaches every run, keeping the runs themselves', async () => {
      const milestone = store.addMilestone();
      const attached = store.addRun({ milestone_id: milestone.id });
      const loose = store.addRun();

      await service.remove(AS('lead'), milestone.id);

      expect(store.milestones.find((row) => row.id === milestone.id)?.deleted_at).not.toBeNull();
      expect(store.runs.map((row) => [row.id, row.milestone_id])).toEqual([
        [attached.id, null],
        [loose.id, null],
      ]);
    });

    it('rolls the detach back when the soft delete fails', async () => {
      const milestone = store.addMilestone();
      const run = store.addRun({ milestone_id: milestone.id });
      store.failSoftDelete = true;

      await expect(service.remove(AS('admin'), milestone.id)).rejects.toThrow(
        'soft delete failed',
      );
      expect(store.runs.find((row) => row.id === run.id)?.milestone_id).toBe(milestone.id);
      expect(store.milestones.find((row) => row.id === milestone.id)?.deleted_at).toBeNull();
    });

    it('404s an unknown or already deleted milestone and 409s an archived project', async () => {
      const gone = store.addMilestone({ deleted_at: new Date() });
      await expectCode(service.remove(AS('admin'), 'nope'), 'NOT_FOUND');
      await expectCode(service.remove(AS('admin'), gone.id), 'NOT_FOUND');

      const archived = store.addMilestone({ project_id: 'p-arch' });
      await expectCode(service.remove(AS('admin'), archived.id), 'CONFLICT');
    });
  });

  describe('attachRuns', () => {
    it('attaches runs with no milestone and reports how many', async () => {
      const milestone = store.addMilestone();
      const first = store.addRun();
      const second = store.addRun();

      const result = await service.attachRuns(AS('lead'), milestone.id, {
        run_ids: [first.id, second.id],
      });

      expect(result).toEqual({ attached: 2 });
      expect(store.runs.every((row) => row.milestone_id === milestone.id)).toBe(true);
    });

    it('400s unknown, deleted and other-project runs, naming the index', async () => {
      const milestone = store.addMilestone();
      const good = store.addRun();
      const gone = store.addRun({ deleted_at: new Date() });
      const foreign = store.addRun({ project_id: 'p-2' });

      await expect(
        service.attachRuns(AS('admin'), milestone.id, {
          run_ids: [good.id, gone.id],
        }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [{ field: 'run_ids[1]', issue: 'unknown run' }],
      });
      await expect(
        service.attachRuns(AS('admin'), milestone.id, { run_ids: [foreign.id] }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [{ field: 'run_ids[0]', issue: 'unknown run' }],
      });
      // The whole request is atomic: the valid first run stays unattached.
      expect(store.runs.find((row) => row.id === good.id)?.milestone_id).toBeNull();
    });

    it('400s a run that is already in a milestone rather than moving it silently', async () => {
      const milestone = store.addMilestone();
      const other = store.addMilestone({ name: 'Other' });
      const taken = store.addRun({ milestone_id: other.id });

      await expect(
        service.attachRuns(AS('admin'), milestone.id, { run_ids: [taken.id] }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [{ field: 'run_ids[0]', issue: 'already in a milestone' }],
      });
      expect(store.runs.find((row) => row.id === taken.id)?.milestone_id).toBe(other.id);
    });

    it('400s the same id twice, naming the later index', async () => {
      const milestone = store.addMilestone();
      const run = store.addRun();

      await expect(
        service.attachRuns(AS('admin'), milestone.id, { run_ids: [run.id, run.id] }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [{ field: 'run_ids[1]', issue: 'duplicate in request' }],
      });
      expect(store.runs.find((row) => row.id === run.id)?.milestone_id).toBeNull();
    });

    it('flips a completed milestone back to open when an open run joins', async () => {
      const milestone = store.addMilestone();
      store.addRun({ milestone_id: milestone.id, completed_at: new Date() });
      const open = store.addRun();

      await service.attachRuns(AS('admin'), milestone.id, { run_ids: [open.id] });

      const detail = await service.detail(AS('admin'), milestone.id);
      expect(detail).toMatchObject({ status: 'open', run_count: 2 });
    });

    it('404s an unknown or deleted milestone and 409s an archived project', async () => {
      const gone = store.addMilestone({ deleted_at: new Date() });
      const run = store.addRun();
      await expectCode(
        service.attachRuns(AS('admin'), 'nope', { run_ids: [run.id] }),
        'NOT_FOUND',
      );
      await expectCode(
        service.attachRuns(AS('admin'), gone.id, { run_ids: [run.id] }),
        'NOT_FOUND',
      );

      const archived = store.addMilestone({ project_id: 'p-arch' });
      await expectCode(
        service.attachRuns(AS('admin'), archived.id, { run_ids: [run.id] }),
        'CONFLICT',
      );
    });
  });

  describe('detachRun', () => {
    it('detaches one run and only that run', async () => {
      const milestone = store.addMilestone();
      const first = store.addRun({ milestone_id: milestone.id });
      const second = store.addRun({ milestone_id: milestone.id });

      await service.detachRun(AS('lead'), milestone.id, first.id);

      expect(store.runs.map((row) => [row.id, row.milestone_id])).toEqual([
        [first.id, null],
        [second.id, milestone.id],
      ]);
    });

    it('404s unknown milestones, unknown runs and runs attached elsewhere alike', async () => {
      const milestone = store.addMilestone();
      const other = store.addMilestone({ name: 'Other' });
      const elsewhere = store.addRun({ milestone_id: other.id });
      const loose = store.addRun();

      for (const [milestoneId, runId] of [
        ['nope', loose.id],
        [milestone.id, 'nope'],
        [milestone.id, elsewhere.id],
        [milestone.id, loose.id],
      ] as const) {
        await expect(
          service.detachRun(AS('admin'), milestoneId, runId),
        ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Milestone or run not found.' });
      }
      expect(store.runs.find((row) => row.id === elsewhere.id)?.milestone_id).toBe(other.id);
    });

    it('404s a deleted milestone and 409s an archived project', async () => {
      const gone = store.addMilestone({ deleted_at: new Date() });
      const run = store.addRun({ milestone_id: gone.id });
      await expectCode(service.detachRun(AS('admin'), gone.id, run.id), 'NOT_FOUND');

      const archived = store.addMilestone({ project_id: 'p-arch' });
      const archivedRun = store.addRun({
        project_id: 'p-arch',
        milestone_id: archived.id,
      });
      await expectCode(
        service.detachRun(AS('admin'), archived.id, archivedRun.id),
        'CONFLICT',
      );
    });
  });
});