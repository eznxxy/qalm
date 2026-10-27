import { Inject, Injectable } from '@nestjs/common';
import { AuthUser } from '../auth/current-user';
import { ApiError } from '../errors';
import { Queryable } from '../db/queryable';
import { ListMeta, buildListMeta } from '../projects/projects.service';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '../runs/runs.constants';
import { RunsStore } from '../runs/runs.store';
import {
  AttachMilestoneRunsDto,
  CreateMilestoneDto,
  ListMilestonesQuery,
  UpdateMilestoneDto,
} from './dto';
import { MILESTONE_DEFAULT_SORT } from './milestones.constants';
import { MilestoneListFilter, MilestonesStore } from './milestones.store';
import { MilestoneDto, toMilestoneDto } from './milestones.types';

function milestoneNotFound(): ApiError {
  return new ApiError('NOT_FOUND', 'Milestone not found.');
}

/**
 * The detach endpoint deliberately cannot tell an unknown milestone from an
 * unknown run or one attached elsewhere (docs/api-milestones.md
 * § DELETE /milestones/:id/runs/:runId), so all three share one body.
 */
function detachNotFound(): ApiError {
  return new ApiError('NOT_FOUND', 'Milestone or run not found.');
}

/** Duplicate milestone name in the project; details name the field (409). */
function nameConflict(): ApiError {
  return new ApiError('CONFLICT', 'A milestone with this name already exists.', [
    { field: 'name', issue: 'already in use' },
  ]);
}

/**
 * A run id in `run_ids` that cannot be attached (400). The field carries the
 * index so the picker can point at the offending row, exactly like
 * `runs[i].name`.
 */
function invalidRunId(index: number, issue: string): ApiError {
  return new ApiError('VALIDATION_ERROR', `Invalid run in run_ids: ${issue}.`, [
    { field: `run_ids[${index}]`, issue },
  ]);
}

/** Empty/blank text is stored as null, so `""` and an absent field agree. */
function blankToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Business rules for the milestones endpoints, docs/api-milestones.md. Role
 * checks live in the controller (@Roles + AuthGuard); the duplicate-name
 * pre-check, the archived-project rules, the attach eligibility rules and
 * detach-runs-on-delete live here. `status`, `run_count` and `counts` are never
 * stored — the store derives them on read.
 */
@Injectable()
export class MilestonesService {
  constructor(
    @Inject(MilestonesStore) private readonly store: MilestonesStore,
    @Inject(RunsStore) private readonly runs: RunsStore,
  ) {}

  /** Paginated milestones list for the milestones screen and run pickers. */
  async list(
    caller: AuthUser,
    projectId: string,
    query: ListMilestonesQuery,
  ): Promise<{ data: MilestoneDto[]; meta: ListMeta }> {
    await this.requireProject(projectId, caller, 'read');
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const filter: MilestoneListFilter = {
      projectId,
      query: query.query ?? null,
      status: query.status ?? null,
    };
    const sort = query.sort ?? MILESTONE_DEFAULT_SORT;
    const total = await this.store.countForList(filter);
    const rows = await this.store.listPage({
      ...filter,
      sort,
      limit,
      offset: (page - 1) * limit,
    });
    return { data: rows.map(toMilestoneDto), meta: buildListMeta(total, page, limit) };
  }

  /**
   * Creates a milestone from its fields only. Runs attach afterwards, so a
   * milestone with no runs is valid — it is a target, not a container
   * (PRD-milestones decision 4).
   */
  async create(
    caller: AuthUser,
    projectId: string,
    dto: CreateMilestoneDto,
  ): Promise<MilestoneDto> {
    await this.requireProject(projectId, caller, 'write');
    // Pre-check names the field; the partial unique index in the store closes
    // the concurrent-write race.
    const duplicate = await this.store.findIdByNameIgnoreCase(projectId, dto.name, null);
    if (duplicate !== null) throw nameConflict();
    const row = await this.store.insert({
      project_id: projectId,
      name: dto.name,
      description: blankToNull(dto.description),
      due_date: dto.due_date ?? null,
      created_by: caller.id,
    });
    return this.loadMilestone(row.id);
  }

  /** Detail of a live milestone, with its derived rollup; deleted ones are 404. */
  async detail(caller: AuthUser, id: string): Promise<MilestoneDto> {
    const row = await this.store.findLiveById(id);
    if (!row) throw milestoneNotFound();
    await this.requireProject(row.project_id, caller, 'read');
    return this.loadMilestone(id);
  }

  /** PATCH: any non-empty subset; `null` clears description / due date. */
  async update(
    caller: AuthUser,
    id: string,
    dto: UpdateMilestoneDto,
  ): Promise<MilestoneDto> {
    const existing = await this.store.findLiveById(id);
    if (!existing) throw milestoneNotFound();
    await this.requireProject(existing.project_id, caller, 'write');
    this.assertNonEmptyPatch(dto);

    return this.store.transaction(async (client) => {
      const row = await this.store.findLiveByIdForUpdate(id, client);
      if (!row) throw milestoneNotFound();
      if (dto.name !== undefined) {
        const duplicate = await this.store.findIdByNameIgnoreCase(
          row.project_id,
          dto.name,
          id,
          client,
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
      return this.loadMilestone(id, client);
    });
  }

  /**
   * Soft delete. Its runs are **detached** (`milestone_id = null`), never
   * deleted, in the same transaction as the `deleted_at` update
   * (PRD-milestones lifecycle; same rule as deleting a plan).
   */
  async remove(caller: AuthUser, id: string): Promise<void> {
    const existing = await this.store.findLiveById(id);
    if (!existing) throw milestoneNotFound();
    await this.requireProject(existing.project_id, caller, 'write');

    await this.store.transaction(async (client) => {
      const row = await this.store.findLiveByIdForUpdate(id, client);
      if (!row) throw milestoneNotFound();
      await this.runs.detachMilestoneRuns(id, caller.id, client);
      await this.store.softDelete(id, caller.id, client);
    });
  }

  /**
   * Attaches runs that have no milestone yet (docs/api-milestones.md § POST
   * /milestones/:id/runs). Unknown, soft-deleted and other-project ids stay
   * indistinguishable; a run already in a milestone is refused rather than
   * moved silently. `FOR UPDATE` keeps a concurrent attach from landing
   * between the check and the update.
   */
  async attachRuns(
    caller: AuthUser,
    id: string,
    dto: AttachMilestoneRunsDto,
  ): Promise<{ attached: number }> {
    const existing = await this.store.findLiveById(id);
    if (!existing) throw milestoneNotFound();
    await this.requireProject(existing.project_id, caller, 'write');

    // Duplicates are a request-shape error; the rest needs the locked rows.
    const seen = new Set<string>();
    dto.run_ids.forEach((runId, index) => {
      if (seen.has(runId)) throw invalidRunId(index, 'duplicate in request');
      seen.add(runId);
    });

    return this.store.transaction(async (client) => {
      const milestone = await this.store.findLiveByIdForUpdate(id, client);
      if (!milestone) throw milestoneNotFound();
      const rows = await this.runs.findLiveByIdsForUpdate(dto.run_ids, client);
      const byId = new Map(rows.map((row) => [row.id, row]));
      dto.run_ids.forEach((runId, index) => {
        const row = byId.get(runId);
        if (!row || row.project_id !== milestone.project_id) {
          throw invalidRunId(index, 'unknown run');
        }
        if (row.milestone_id !== null) {
          throw invalidRunId(index, 'already in a milestone');
        }
      });
      await this.runs.setMilestone(dto.run_ids, milestone.id, caller.id, client);
      return { attached: dto.run_ids.length };
    });
  }

  /**
   * Detaches one run from this milestone. An unknown milestone, an unknown run
   * and a run that is not attached here are all 404 on purpose
   * (docs/api-milestones.md § DELETE /milestones/:id/runs/:runId).
   */
  async detachRun(caller: AuthUser, id: string, runId: string): Promise<void> {
    const existing = await this.store.findLiveById(id);
    if (!existing) throw detachNotFound();
    await this.requireProject(existing.project_id, caller, 'write');

    await this.store.transaction(async (client) => {
      const milestone = await this.store.findLiveByIdForUpdate(id, client);
      if (!milestone) throw detachNotFound();
      const run = await this.runs.findLiveByIdForUpdate(runId, client);
      if (
        !run ||
        run.project_id !== milestone.project_id ||
        run.milestone_id !== milestone.id
      ) {
        throw detachNotFound();
      }
      await this.runs.setMilestone([runId], null, caller.id, client);
    });
  }

  // --- internals ----------------------------------------------------------

  private async loadMilestone(id: string, q?: Queryable): Promise<MilestoneDto> {
    const row = await this.store.findWithCounts(id, q);
    if (!row) throw milestoneNotFound();
    return toMilestoneDto(row);
  }

  /**
   * Contract visibility: unknown project → 404; archived project → 404 for
   * non-Admins on reads and 409 on every write. Mirrors PlansService and
   * RunsService so the three features cannot drift.
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

  private assertNonEmptyPatch(dto: UpdateMilestoneDto): void {
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