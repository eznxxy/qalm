import { Inject, Injectable } from '@nestjs/common';
import { AuthUser } from '../auth/current-user';
import { ApiError } from '../errors';
import { Queryable } from '../db/queryable';
import { ListMeta, buildListMeta } from '../projects/projects.service';
import { assertDateOrder } from '../runs/date-order';
import { isRunNameConflict, runNameConflict } from '../runs/run-name';
import { RunsStore } from '../runs/runs.store';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '../runs/runs.constants';
import { CreatePlanDto, ListPlansQuery, UpdatePlanDto } from './dto';
import { PLAN_RUNS_MAX } from './plans.constants';
import { PlanListFilter, PlansStore } from './plans.store';
import { PlanDto, toPlanDto } from './plans.types';

function planNotFound(): ApiError {
  return new ApiError('NOT_FOUND', 'Plan not found.');
}

/** Duplicate plan name in the project; details name the field (409). */
function nameConflict(): ApiError {
  return new ApiError('CONFLICT', 'A plan with this name already exists.', [
    { field: 'name', issue: 'already in use' },
  ]);
}

/**
 * A run id in `run_ids` that cannot be attached (400). The field carries the
 * index so the dialog can point at the offending row, exactly like
 * `runs[i].name`.
 */
function invalidRunId(index: number, issue: string): ApiError {
  return new ApiError('VALIDATION_ERROR', `Invalid run in run_ids: ${issue}.`, [
    { field: `run_ids[${index}]`, issue },
  ]);
}

/** "At least one run, at most 20" spans both arrays, so the service enforces it. */
function invalidRunCount(issue: string): ApiError {
  return new ApiError('VALIDATION_ERROR', 'Invalid run selection.', [
    { field: 'runs', issue },
  ]);
}

/** Empty/blank text is stored as null, so `""` and an absent field agree. */
function blankToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Business rules for the plans endpoints, docs/api-plans.md. Role checks live in
 * the controller (@Roles + AuthGuard); the duplicate-name pre-check, the
 * archived-project rules and detach-runs-on-delete (PRD decision 7) live here.
 */
@Injectable()
export class PlansService {
  constructor(
    @Inject(PlansStore) private readonly store: PlansStore,
    @Inject(RunsStore) private readonly runs: RunsStore,
  ) {}

  /** Paginated plans list for plan pickers and the plan detail screen. */
  async list(
    caller: AuthUser,
    projectId: string,
    query: ListPlansQuery,
  ): Promise<{ data: PlanDto[]; meta: ListMeta }> {
    await this.requireProject(projectId, caller, 'read');
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const filter: PlanListFilter = { projectId, query: query.query ?? null };
    // The contract prose says "newest first", so created_at desc is the default.
    const sort = query.sort ?? '-created_at';
    const total = await this.store.countForList(filter);
    const rows = await this.store.listPage({
      ...filter,
      sort,
      limit,
      offset: (page - 1) * limit,
    });
    return { data: rows.map(toPlanDto), meta: buildListMeta(total, page, limit) };
  }

  /**
   * Creates a plan **and its runs** in one transaction (docs/api-plans.md §
   * POST). A plan is never born empty: it gets at least one run, either new
   * (`runs`) or an existing unplanned one (`run_ids`, 3.10). A rejected run
   * rolls the plan back with it.
   */
  async create(caller: AuthUser, projectId: string, dto: CreatePlanDto): Promise<PlanDto> {
    await this.requireProject(projectId, caller, 'write');
    const newRuns = dto.runs ?? [];
    const runIds = dto.run_ids ?? [];
    const total = newRuns.length + runIds.length;
    if (total === 0) throw invalidRunCount('at least one run is required');
    if (total > PLAN_RUNS_MAX) {
      throw invalidRunCount(`at most ${PLAN_RUNS_MAX} runs are allowed`);
    }
    // Duplicates are a request-shape error, so they are caught before the
    // transaction; the rest needs the rows (and their row locks) to answer.
    const uniqueRunIds = new Set<string>();
    runIds.forEach((id, index) => {
      if (uniqueRunIds.has(id)) throw invalidRunId(index, 'duplicate in request');
      uniqueRunIds.add(id);
    });
    // Pre-check names the field; the partial unique index (catch path) closes
    // the concurrent-write race.
    const duplicate = await this.store.findIdByNameIgnoreCase(projectId, dto.name, null);
    if (duplicate !== null) throw nameConflict();

    return this.store.transaction(async (client) => {
      const row = await this.store.insert(
        {
          project_id: projectId,
          name: dto.name,
          description: blankToNull(dto.description),
          due_date: dto.due_date ?? null,
          created_by: caller.id,
        },
        client,
      );
      // Run names are unique per project (docs/api-runs.md), so an embedded run
      // can clash either with a live run already in the project or with an
      // earlier run in this same request. Both are reported against the run.
      const seenNames = new Set<string>();
      for (const [index, run] of newRuns.entries()) {
        const field = `runs[${index}].name`;
        const key = run.name.toLowerCase();
        if (seenNames.has(key)) throw runNameConflict(field);
        seenNames.add(key);
        const duplicate = await this.runs.findIdByNameIgnoreCase(
          projectId,
          run.name,
          null,
          client,
        );
        if (duplicate !== null) throw runNameConflict(field);

        const startDate = run.start_date ?? null;
        const dueDate = run.due_date ?? null;
        assertDateOrder(startDate, dueDate, `runs[${index}].start_date`);
        try {
          await this.runs.insertRun(
            {
              project_id: projectId,
              plan_id: row.id,
              milestone_id: null,
              name: run.name,
              description: blankToNull(run.description),
              start_date: startDate,
              due_date: dueDate,
              created_by: caller.id,
            },
            client,
          );
        } catch (error) {
          // The store names the field `name`; from here it is one of the runs.
          if (isRunNameConflict(error)) throw runNameConflict(field);
          throw error;
        }
      }
      await this.attachRuns(runIds, projectId, row.id, caller.id, client);
      return this.loadPlan(row.id, client);
    });
  }

  /** Detail of a live plan, with its rollup; soft-deleted plans are 404. */
  async detail(caller: AuthUser, id: string): Promise<PlanDto> {
    const row = await this.store.findLiveById(id);
    if (!row) throw planNotFound();
    await this.requireProject(row.project_id, caller, 'read');
    return this.loadPlan(id);
  }

  /** PATCH: any non-empty subset; `null` clears description / due date. */
  async update(caller: AuthUser, id: string, dto: UpdatePlanDto): Promise<PlanDto> {
    const existing = await this.store.findLiveById(id);
    if (!existing) throw planNotFound();
    await this.requireProject(existing.project_id, caller, 'write');
    this.assertNonEmptyPatch(dto);

    return this.store.transaction(async (client) => {
      const row = await this.store.findLiveByIdForUpdate(id, client);
      if (!row) throw planNotFound();
      if (dto.name !== undefined) {
        const duplicate = await this.store.findIdByNameIgnoreCase(
          row.project_id,
          dto.name,
          id,
        );
        if (duplicate !== null) throw nameConflict();
      }
      await this.store.update(
        id,
        {
          name: dto.name,
          description:
            dto.description === undefined ? undefined : blankToNull(dto.description),
          due_date: dto.due_date,
          updated_by: caller.id,
        },
        client,
      );
      return this.loadPlan(id, client);
    });
  }

  /**
   * Soft delete. Its runs are **detached** (`plan_id = null`), never deleted
   * (PRD decision 7), in the same transaction as the `deleted_at` update.
   */
  async remove(caller: AuthUser, id: string): Promise<void> {
    const existing = await this.store.findLiveById(id);
    if (!existing) throw planNotFound();
    await this.requireProject(existing.project_id, caller, 'write');

    await this.store.transaction(async (client) => {
      const row = await this.store.findLiveByIdForUpdate(id, client);
      if (!row) throw planNotFound();
      await this.store.detachRuns(id, client);
      await this.store.softDelete(id, caller.id, client);
    });
  }

  // --- internals ----------------------------------------------------------

  /**
   * Attaches the requested existing runs (docs/api-plans.md § Attaching
   * existing runs). Only live runs of this project that have no plan qualify —
   * a run in another plan is never moved silently, and unknown/other-project
   * ids stay indistinguishable. `FOR UPDATE` keeps a concurrent attach from
   * landing between the check and the update.
   */
  private async attachRuns(
    runIds: string[],
    projectId: string,
    planId: string,
    actorId: string,
    client: Queryable,
  ): Promise<void> {
    if (runIds.length === 0) return;
    const rows = await this.runs.findLiveByIdsForUpdate(runIds, client);
    const byId = new Map(rows.map((row) => [row.id, row]));
    runIds.forEach((id, index) => {
      const row = byId.get(id);
      if (!row || row.project_id !== projectId) throw invalidRunId(index, 'unknown run');
      if (row.plan_id !== null) throw invalidRunId(index, 'already in a plan');
    });
    await this.runs.attachToPlan(runIds, planId, actorId, client);
  }

  private async loadPlan(id: string, q?: Queryable): Promise<PlanDto> {
    const row = await this.store.findWithCounts(id, q);
    if (!row) throw planNotFound();
    return toPlanDto(row);
  }

  /**
   * Contract visibility: unknown project → 404; archived project → 404 for
   * non-Admins on reads and 409 on every write. Mirrors RunsService so the two
   * features cannot drift.
   */
  private async requireProject(
    projectId: string,
    caller: AuthUser,
    mode: 'read' | 'write',
    q?: Queryable,
  ): Promise<void> {
    const project = await this.store.findProject(projectId, q);
    if (!project) throw new ApiError('NOT_FOUND', 'Project not found.');
    if (project.status !== 'archived') return;
    if (mode === 'write') {
      throw new ApiError('CONFLICT', 'Project is archived and cannot be changed.', [
        { field: 'project_id', issue: 'project is archived' },
      ]);
    }
    if (caller.role !== 'admin') {
      throw new ApiError('NOT_FOUND', 'Project not found.');
    }
  }

  private assertNonEmptyPatch(dto: UpdatePlanDto): void {
    if (
      dto.name !== undefined ||
      dto.description !== undefined ||
      dto.due_date !== undefined
    ) {
      return;
    }
    const fields = ['name', 'description', 'due_date'];
    throw new ApiError(
      'VALIDATION_ERROR',
      'Provide at least one field to update.',
      fields.map((field) => ({ field, issue: 'at least one field must be provided' })),
    );
  }
}