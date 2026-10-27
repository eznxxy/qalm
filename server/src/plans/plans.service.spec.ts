/* eslint-disable @typescript-eslint/require-await -- the in-memory fake mirrors
   the async store surface without doing I/O. */
import { Test } from '@nestjs/testing';
import { AuthUser, UserRole } from '../auth/current-user';
import { ApiError, ErrorCode } from '../errors';
import { Queryable } from '../db/queryable';
import { PlansService } from './plans.service';
import { RunsStore } from '../runs/runs.store';
import {
  PlanAggRow,
  PlanListFilter,
  PlanProjectRef,
  PlanRow,
  PlansStore,
  PlanUpdateFields,
} from './plans.store';

/**
 * Decision-logic tests for PlansService over an in-memory fake of the plans
 * tables. SQL semantics (filter, ordering, grouped rollup) are mirrored here;
 * the real SQL path is covered by test/plans.e2e-spec.ts.
 *
 * `transaction` snapshots and restores state so the create/delete atomicity
 * claims are tested, not just stated.
 */
interface FakePlan extends PlanRow {
  run_count: number;
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  retest: number;
  skipped: number;
  untested: number;
}

interface FakeRun {
  id: string;
  project_id: string;
  plan_id: string | null;
  name: string;
  description: string | null;
  start_date: string | null;
  due_date: string | null;
  created_by: string;
}

class FakeStore {
  projects: PlanProjectRef[] = [];
  plans: FakePlan[] = [];
  /** Runs inserted by `create`, in insert order. */
  runs: FakeRun[] = [];
  /** Live run counts per plan id, so `detachRuns` has something to clear. */
  runsOfPlan: Record<string, number> = {};
  detachCalls: string[] = [];
  /** Test hook: when true, `softDelete` throws to exercise rollback. */
  failSoftDelete = false;
  /** Test hook: throw instead of the Nth run insert (0-based) — rollback. */
  failInsertRunAt: number | null = null;

  private nextId = 1;
  private nextRunId = 1;
  private clock = 0;

  seed(): void {
    this.projects = [
      { id: 'p-1', status: 'active' },
      { id: 'p-2', status: 'active' },
      { id: 'p-arch', status: 'archived' },
    ];
    this.plans = [];
    this.runs = [];
    this.runsOfPlan = {};
    this.detachCalls = [];
    this.nextId = 1;
    this.nextRunId = 1;
    this.clock = 0;
    this.failSoftDelete = false;
    this.failInsertRunAt = null;
  }

  private tick(): Date {
    this.clock += 1_000;
    return new Date(Date.UTC(2026, 9, 25, 9, 0, 0) + this.clock);
  }

  private make(overrides: Partial<FakePlan>): FakePlan {
    const now = this.tick();
    return {
      id: overrides.id ?? `plan-${this.nextId++}`,
      project_id: overrides.project_id ?? 'p-1',
      name: overrides.name ?? 'Plan',
      description: overrides.description ?? null,
      due_date: overrides.due_date ?? null,
      created_by: overrides.created_by ?? 'u-admin',
      updated_by: overrides.updated_by ?? 'u-admin',
      deleted_at: overrides.deleted_at ?? null,
      created_at: overrides.created_at ?? now,
      updated_at: overrides.updated_at ?? now,
      run_count: overrides.run_count ?? 0,
      total: overrides.total ?? 0,
      passed: overrides.passed ?? 0,
      failed: overrides.failed ?? 0,
      blocked: overrides.blocked ?? 0,
      retest: overrides.retest ?? 0,
      skipped: overrides.skipped ?? 0,
      untested: overrides.untested ?? 0,
    };
  }

  /** Test helper: add a live plan and return it. */
  addPlan(overrides: Partial<FakePlan> = {}): FakePlan {
    const plan = this.make(overrides);
    this.plans.push(plan);
    return plan;
  }

  private agg(plan: FakePlan): PlanAggRow {
    return { ...plan };
  }

  async transaction<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
    const snapshot = {
      plans: this.plans.map((row) => ({ ...row })),
      runs: this.runs.map((row) => ({ ...row })),
      runsOfPlan: { ...this.runsOfPlan },
      detachCalls: [...this.detachCalls],
      nextId: this.nextId,
      nextRunId: this.nextRunId,
      clock: this.clock,
    };
    try {
      return await fn({} as Queryable);
    } catch (error) {
      this.plans = snapshot.plans;
      this.runs = snapshot.runs;
      this.runsOfPlan = snapshot.runsOfPlan;
      this.detachCalls = snapshot.detachCalls;
      this.nextId = snapshot.nextId;
      this.nextRunId = snapshot.nextRunId;
      this.clock = snapshot.clock;
      throw error;
    }
  }

  async findProject(projectId: string): Promise<PlanProjectRef | null> {
    return this.projects.find((project) => project.id === projectId) ?? null;
  }

  async findLiveById(id: string): Promise<PlanRow | null> {
    const plan = this.plans.find((row) => row.id === id && row.deleted_at === null);
    return plan ? { ...plan } : null;
  }

  async findLiveByIdForUpdate(id: string): Promise<PlanRow | null> {
    return this.findLiveById(id);
  }

  async findWithCounts(id: string): Promise<PlanAggRow | null> {
    const plan = this.plans.find((row) => row.id === id && row.deleted_at === null);
    return plan ? this.agg(plan) : null;
  }

  async findIdByNameIgnoreCase(
    projectId: string,
    name: string,
    excludeId: string | null,
  ): Promise<string | null> {
    const wanted = name.toLowerCase();
    const found = this.plans.find(
      (row) =>
        row.project_id === projectId &&
        row.deleted_at === null &&
        row.name.toLowerCase() === wanted &&
        (excludeId === null || row.id !== excludeId),
    );
    return found?.id ?? null;
  }

  async insert(row: {
    project_id: string;
    name: string;
    description: string | null;
    due_date: string | null;
    created_by: string;
  }): Promise<PlanRow> {
    if (
      this.plans.some(
        (plan) =>
          plan.project_id === row.project_id &&
          plan.deleted_at === null &&
          plan.name.toLowerCase() === row.name.toLowerCase(),
      )
    ) {
      // Mirror the partial unique index: the store throws the same 409.
      throw new ApiError('CONFLICT', 'A plan with this name already exists.', [
        { field: 'name', issue: 'already in use' },
      ]);
    }
    const plan = this.make({
      project_id: row.project_id,
      name: row.name,
      description: row.description,
      due_date: row.due_date,
      created_by: row.created_by,
      updated_by: row.created_by,
    });
    this.plans.push(plan);
    return { ...plan };
  }

  /** Mirrors `RunsStore.insertRun` for the plan-create path. */
  async insertRun(row: {
    project_id: string;
    plan_id: string | null;
    name: string;
    description: string | null;
    start_date: string | null;
    due_date: string | null;
    created_by: string;
  }): Promise<FakeRun> {
    if (this.failInsertRunAt !== null && this.runs.length === this.failInsertRunAt) {
      throw new ApiError('VALIDATION_ERROR', 'Request validation failed.', [
        { field: `runs[${this.runs.length}].name`, issue: 'must be unique' },
      ]);
    }
    const run: FakeRun = { id: `run-${this.nextRunId++}`, ...row };
    this.runs.push(run);
    const plan = this.plans.find((candidate) => candidate.id === row.plan_id);
    if (plan) plan.run_count += 1;
    return run;
  }

  async update(id: string, fields: PlanUpdateFields): Promise<PlanRow | null> {
    const plan = this.plans.find((row) => row.id === id && row.deleted_at === null);
    if (!plan) return null;
    if (fields.name !== undefined) {
      const clash = this.plans.some(
        (row) =>
          row.id !== id &&
          row.project_id === plan.project_id &&
          row.deleted_at === null &&
          row.name.toLowerCase() === fields.name?.toLowerCase(),
      );
      if (clash) {
        throw new ApiError('CONFLICT', 'A plan with this name already exists.', [
          { field: 'name', issue: 'already in use' },
        ]);
      }
      plan.name = fields.name;
    }
    if (fields.description !== undefined) plan.description = fields.description;
    if (fields.due_date !== undefined) plan.due_date = fields.due_date;
    plan.updated_by = fields.updated_by;
    plan.updated_at = this.tick();
    return { ...plan };
  }

  async softDelete(id: string, actorId: string): Promise<PlanRow | null> {
    if (this.failSoftDelete) throw new Error('boom');
    const plan = this.plans.find((row) => row.id === id && row.deleted_at === null);
    if (!plan) return null;
    plan.deleted_at = this.tick();
    plan.updated_by = actorId;
    plan.updated_at = plan.deleted_at;
    return { ...plan };
  }

  async detachRuns(planId: string): Promise<number> {
    this.detachCalls.push(planId);
    const count = this.runsOfPlan[planId] ?? 0;
    this.runsOfPlan[planId] = 0;
    return count;
  }

  private sortPlans(rows: FakePlan[], sort: string): FakePlan[] {
    const descending = sort.startsWith('-');
    const key = descending ? sort.slice(1) : sort;
    const copy = [...rows];
    copy.sort((a, b) => {
      let cmp: number;
      if (key === 'due_date') {
        // Null due dates sort last, whichever direction was asked for.
        const ad = a.due_date;
        const bd = b.due_date;
        if (ad === null && bd === null) cmp = 0;
        else if (ad === null) cmp = 1;
        else if (bd === null) cmp = -1;
        else {
          cmp = ad < bd ? -1 : ad > bd ? 1 : 0;
          if (descending) cmp = -cmp;
        }
      } else if (key === 'name') {
        const an = a.name.toLowerCase();
        const bn = b.name.toLowerCase();
        cmp = descending ? (an < bn ? 1 : an > bn ? -1 : 0) : an < bn ? -1 : an > bn ? 1 : 0;
      } else if (key === 'updated_at') {
        cmp = a.updated_at.getTime() - b.updated_at.getTime();
        if (descending) cmp = -cmp;
      } else {
        cmp = a.created_at.getTime() - b.created_at.getTime();
        if (descending) cmp = -cmp;
      }
      if (cmp === 0) cmp = a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      return cmp;
    });
    return copy;
  }

  private filtered(filter: PlanListFilter): FakePlan[] {
    return this.plans.filter((plan) => {
      if (plan.project_id !== filter.projectId || plan.deleted_at !== null) return false;
      if (filter.query !== null && !plan.name.toLowerCase().includes(filter.query.toLowerCase())) {
        return false;
      }
      return true;
    });
  }

  async countForList(filter: PlanListFilter): Promise<number> {
    return this.filtered(filter).length;
  }

  async listPage(
    filter: PlanListFilter & { sort: string; limit: number; offset: number },
  ): Promise<PlanAggRow[]> {
    const sorted = this.sortPlans(this.filtered(filter), filter.sort);
    return sorted
      .slice(filter.offset, filter.offset + filter.limit)
      .map((plan) => this.agg(plan));
  }

  planById(id: string): FakePlan {
    const plan = this.plans.find((row) => row.id === id);
    if (!plan) throw new Error(`no plan ${id}`);
    return plan;
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

describe('PlansService (unit, in-memory plans)', () => {
  let service: PlansService;
  let store: FakeStore;

  beforeEach(async () => {
    store = new FakeStore();
    store.seed();
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: PlansStore, useValue: store },
        { provide: RunsStore, useValue: store },
        PlansService,
      ],
    }).compile();
    service = moduleRef.get(PlansService);
  });

  describe('list', () => {
    it('returns live plans newest-first with rollups and pagination meta', async () => {
      const older = store.addPlan({ name: 'Older', created_at: new Date('2026-10-01T00:00:00Z') });
      const newer = store.addPlan({ name: 'Newer', created_at: new Date('2026-10-05T00:00:00Z') });
      store.addPlan({ name: 'Deleted', deleted_at: new Date('2026-10-06T00:00:00Z') });
      store.addPlan({ name: 'Other project', project_id: 'p-2' });

      const result = await service.list(AS('viewer'), 'p-1', {});

      expect(result.data.map((plan) => plan.id)).toEqual([newer.id, older.id]);
      expect(result.meta).toEqual({ page: 1, limit: 25, total: 2, total_pages: 1 });
    });

    it('derives percent_complete from the summed row, rounding', async () => {
      store.addPlan({ name: 'Half', total: 3, passed: 1, untested: 1, run_count: 2 });
      const result = await service.list(AS('admin'), 'p-1', {});
      expect(result.data[0]?.counts).toMatchObject({
        total: 3,
        passed: 1,
        untested: 1,
        percent_complete: 67,
      });
      expect(result.data[0]?.run_count).toBe(2);
    });

    it('applies an explicit sort and honours the query substring', async () => {
      store.addPlan({ name: 'Alpha', created_at: new Date('2026-10-01T00:00:00Z') });
      store.addPlan({ name: 'Bravo', created_at: new Date('2026-10-05T00:00:00Z') });

      const asc = await service.list(AS('admin'), 'p-1', { sort: 'name' });
      expect(asc.data.map((plan) => plan.name)).toEqual(['Alpha', 'Bravo']);

      const filtered = await service.list(AS('admin'), 'p-1', { query: 'brav' });
      expect(filtered.data.map((plan) => plan.name)).toEqual(['Bravo']);
      expect(filtered.meta.total).toBe(1);
    });

    it('sorts null due dates last regardless of direction', async () => {
      store.addPlan({ name: 'Dated', due_date: '2026-11-14' });
      store.addPlan({ name: 'Undated', due_date: null });

      const asc = await service.list(AS('admin'), 'p-1', { sort: 'due_date' });
      expect(asc.data.map((plan) => plan.name)).toEqual(['Dated', 'Undated']);
      const desc = await service.list(AS('admin'), 'p-1', { sort: '-due_date' });
      expect(desc.data.map((plan) => plan.name)).toEqual(['Dated', 'Undated']);
    });

    it('is 404 for an unknown project and for an archived project as non-Admin', async () => {
      await expectCode(service.list(AS('admin'), 'nope', {}), 'NOT_FOUND');
      await expectCode(service.list(AS('viewer'), 'p-arch', {}), 'NOT_FOUND');
      // An Admin still sees an archived project's plans.
      await expect(service.list(AS('admin'), 'p-arch', {})).resolves.toMatchObject({
        meta: { total: 0 },
      });
    });
  });

  describe('create', () => {
    it('stores blank description as null and inserts the plan with its run', async () => {
      const plan = await service.create(AS('lead'), 'p-1', {
        name: 'Release 2.4',
        description: '   ',
        due_date: '2026-11-14',
        runs: [{ name: 'Smoke', description: '  ', start_date: '2026-11-01' }],
      });
      expect(plan).toMatchObject({
        name: 'Release 2.4',
        description: null,
        due_date: '2026-11-14',
        run_count: 1,
        created_by: 'u-lead',
        updated_by: 'u-lead',
      });
      expect(plan.counts).toEqual({
        total: 0,
        passed: 0,
        failed: 0,
        blocked: 0,
        retest: 0,
        skipped: 0,
        untested: 0,
        percent_complete: 0,
      });
      expect(store.runs).toEqual([
        {
          id: 'run-1',
          project_id: 'p-1',
          plan_id: plan.id,
          name: 'Smoke',
          description: null,
          start_date: '2026-11-01',
          due_date: null,
          created_by: 'u-lead',
        },
      ]);
    });

    it('inserts every run in request order, all pointing at the new plan', async () => {
      const plan = await service.create(AS('admin'), 'p-1', {
        name: 'Release 2.4',
        runs: [
          { name: 'First' },
          { name: 'Second', start_date: '2026-11-02', due_date: '2026-11-06' },
          { name: 'Third' },
        ],
      });

      expect(store.runs.map((run) => run.name)).toEqual(['First', 'Second', 'Third']);
      expect(new Set(store.runs.map((run) => run.plan_id))).toEqual(new Set([plan.id]));
      expect(plan.run_count).toBe(3);
    });

    it('rolls the plan back when a later run is rejected', async () => {
      // Second run insert fails: neither the plan nor the first run may remain.
      store.failInsertRunAt = 1;

      await expect(
        service.create(AS('admin'), 'p-1', {
          name: 'Release 2.4',
          runs: [{ name: 'First' }, { name: 'Second' }],
        }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [{ field: 'runs[1].name' }],
      });

      expect(store.plans).toEqual([]);
      expect(store.runs).toEqual([]);
      await expectCode(service.detail(AS('admin'), 'plan-1'), 'NOT_FOUND');
    });

    it('names the indexed run field when start_date lands after due_date', async () => {
      await expect(
        service.create(AS('lead'), 'p-1', {
          name: 'Release 2.4',
          runs: [
            { name: 'Fine', start_date: '2026-11-01', due_date: '2026-11-02' },
            { name: 'Backwards', start_date: '2026-11-09', due_date: '2026-11-02' },
          ],
        }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [{ field: 'runs[1].start_date', issue: 'must be on or before due_date' }],
      });
      expect(store.plans).toEqual([]);
      expect(store.runs).toEqual([]);
    });

    it('is 409 for a duplicate name, ignoring case and spaces', async () => {
      store.addPlan({ name: 'Release 2.4' });
      await expectCode(
        service.create(AS('admin'), 'p-1', { name: 'release 2.4', runs: [{ name: 'R' }] }),
        'CONFLICT',
      );
      expect(store.runs).toEqual([]);
    });

    it('frees the name once the plan is deleted', async () => {
      const existing = store.addPlan({ name: 'Release 2.4' });
      existing.deleted_at = new Date('2026-10-06T00:00:00Z');
      await expect(
        service.create(AS('admin'), 'p-1', {
          name: 'Release 2.4',
          runs: [{ name: 'R' }],
        }),
      ).resolves.toMatchObject({ name: 'Release 2.4', run_count: 1 });
    });

    it('is 404 for an unknown project and 409 for an archived project', async () => {
      await expectCode(
        service.create(AS('admin'), 'nope', { name: 'X', runs: [{ name: 'R' }] }),
        'NOT_FOUND',
      );
      await expectCode(
        service.create(AS('admin'), 'p-arch', { name: 'X', runs: [{ name: 'R' }] }),
        'CONFLICT',
      );
      expect(store.runs).toEqual([]);
    });
  });

  describe('detail', () => {
    it('returns the plan with its rollup and is 404 for unknown/deleted', async () => {
      const plan = store.addPlan({ name: 'Release 2.4', run_count: 3, total: 10, passed: 7, untested: 3 });
      const dto = await service.detail(AS('tester'), plan.id);
      expect(dto).toMatchObject({ name: 'Release 2.4', run_count: 3 });
      expect(dto.counts).toMatchObject({ total: 10, passed: 7, untested: 3, percent_complete: 70 });

      await expectCode(service.detail(AS('admin'), 'nope'), 'NOT_FOUND');
      const gone = store.addPlan({ name: 'Gone', deleted_at: new Date('2026-10-06T00:00:00Z') });
      await expectCode(service.detail(AS('admin'), gone.id), 'NOT_FOUND');
    });

    it('hides an archived project plan from non-Admins', async () => {
      const plan = store.addPlan({ project_id: 'p-arch', name: 'Old' });
      await expectCode(service.detail(AS('viewer'), plan.id), 'NOT_FOUND');
      await expect(service.detail(AS('admin'), plan.id)).resolves.toMatchObject({ name: 'Old' });
    });
  });

  describe('update', () => {
    it('is 400 for an empty patch', async () => {
      const plan = store.addPlan({ name: 'Release 2.4' });
      await expectCode(service.update(AS('admin'), plan.id, {}), 'VALIDATION_ERROR');
    });

    it('renames, excluding the plan itself from the duplicate check', async () => {
      const plan = store.addPlan({ name: 'Release 2.4' });
      const dto = await service.update(AS('lead'), plan.id, { name: 'Release 2.4' });
      expect(dto.name).toBe('Release 2.4');

      store.addPlan({ name: 'Other' });
      await expectCode(service.update(AS('admin'), plan.id, { name: 'other' }), 'CONFLICT');
    });

    it('clears description and due date with explicit null', async () => {
      const plan = store.addPlan({
        name: 'Release 2.4',
        description: 'keep?',
        due_date: '2026-11-14',
      });
      const dto = await service.update(AS('admin'), plan.id, { description: null, due_date: null });
      expect(dto.description).toBeNull();
      expect(dto.due_date).toBeNull();
    });

    it('is 404 for unknown/deleted and 409 for an archived project', async () => {
      await expectCode(service.update(AS('admin'), 'nope', { name: 'X' }), 'NOT_FOUND');
      const plan = store.addPlan({ name: 'Release 2.4' });
      const gone = store.addPlan({ name: 'Gone', deleted_at: new Date('2026-10-06T00:00:00Z') });
      await expectCode(service.update(AS('admin'), gone.id, { name: 'X' }), 'NOT_FOUND');
      const archived = store.addPlan({ project_id: 'p-arch', name: 'Archived' });
      await expectCode(service.update(AS('admin'), archived.id, { name: 'X' }), 'CONFLICT');
      expect(plan.deleted_at).toBeNull();
    });
  });

  describe('remove', () => {
    it('detaches runs, then soft-deletes in one transaction', async () => {
      const plan = store.addPlan({ name: 'Release 2.4' });
      store.runsOfPlan[plan.id] = 3;

      await service.remove(AS('lead'), plan.id);

      expect(store.detachCalls).toEqual([plan.id]);
      expect(store.planById(plan.id).deleted_at).not.toBeNull();
      await expectCode(service.detail(AS('admin'), plan.id), 'NOT_FOUND');
    });

    it('rolls the detach back when the delete fails inside the transaction', async () => {
      const plan = store.addPlan({ name: 'Release 2.4' });
      store.runsOfPlan[plan.id] = 2;
      store.failSoftDelete = true;

      await expect(service.remove(AS('admin'), plan.id)).rejects.toThrow('boom');

      store.failSoftDelete = false;
      expect(store.detachCalls).toEqual([]);
      expect(store.runsOfPlan[plan.id]).toBe(2);
      expect(store.planById(plan.id).deleted_at).toBeNull();
    });

    it('is 404 for unknown/deleted and 409 for an archived project', async () => {
      await expectCode(service.remove(AS('admin'), 'nope'), 'NOT_FOUND');
      const archived = store.addPlan({ project_id: 'p-arch', name: 'Archived' });
      await expectCode(service.remove(AS('admin'), archived.id), 'CONFLICT');
    });
  });
});