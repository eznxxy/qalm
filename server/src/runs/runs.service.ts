import { Inject, Injectable } from '@nestjs/common';
import { AuthUser } from '../auth/current-user';
import { ApiError } from '../errors';
import { Queryable } from '../db/queryable';
import { ListMeta, buildListMeta } from '../projects/projects.service';
import { toDisplayId } from '../cases/cases.types';
import {
  ASSIGNEE_ROLES,
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  MAX_RUN_ITEMS,
} from './runs.constants';
import {
  AddRunItemsDto,
  AssignRunItemsDto,
  CreateRunDto,
  ListCaseRunsQuery,
  ListRunItemsQuery,
  ListRunsQuery,
  RunSelectionDto,
  UpdateRunDto,
  UpdateRunItemDto,
} from './dto';
import {
  CaseSnapshotRow,
  RunItemFilter,
  RunItemWrite,
  RunListFilter,
  RunsStore,
} from './runs.store';
import {
  CaseRunDto,
  RunDto,
  RunItemDetailDto,
  RunItemDto,
  toCaseRunDto,
  toRunDto,
  toRunItemDetailDto,
  toRunItemDto,
} from './runs.types';
import { assertDateOrder } from './date-order';
import { runNameConflict } from './run-name';

function validationError(field: string, issue: string): ApiError {
  return new ApiError('VALIDATION_ERROR', 'Request validation failed.', [{ field, issue }]);
}

function runNotFound(): ApiError {
  return new ApiError('NOT_FOUND', 'Run not found.');
}

function itemNotFound(): ApiError {
  return new ApiError('NOT_FOUND', 'Run item not found.');
}

function conflict(message: string, field = 'run_id'): ApiError {
  return new ApiError('CONFLICT', message, [{ field, issue: message.toLowerCase() }]);
}

/** Empty/blank text is stored as null, so `""` and an absent field agree. */
function blankToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Business rules for the runs and run-items endpoints, docs/api-runs.md. Role
 * checks live in the controller (@Roles + AuthGuard); selection materialisation,
 * the 2,000-item capacity, the close/reopen guard, archived-project rules and
 * item reordering live here.
 */
@Injectable()
export class RunsService {
  constructor(@Inject(RunsStore) private readonly store: RunsStore) {}

  // --- runs ---------------------------------------------------------------

  /** Paginated, filterable runs list for the runs screen (§4.3). */
  async list(
    caller: AuthUser,
    projectId: string,
    query: ListRunsQuery,
  ): Promise<{ data: RunDto[]; meta: ListMeta }> {
    await this.requireProject(projectId, caller, 'read');
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const filter: RunListFilter = {
      projectId,
      planId:
        query.plan_id === undefined
          ? null
          : query.plan_id === 'none'
            ? 'none'
            : query.plan_id,
      status: query.status ?? null,
      query: query.query ?? null,
    };
    const total = await this.store.countRuns(filter);
    const rows = await this.store.listRuns({
      ...filter,
      sort: query.sort ?? '-created_at',
      limit,
      offset: (page - 1) * limit,
    });
    return { data: rows.map(toRunDto), meta: buildListMeta(total, page, limit) };
  }

  /**
   * Creates a run and materialises its items in one transaction: the selection
   * is the de-duplicated union of explicit `case_ids` and a suite subtree
   * (contract § POST /projects/:id/runs), ordered by `case_number`.
   */
  async create(caller: AuthUser, projectId: string, dto: CreateRunDto): Promise<RunDto> {
    await this.requireProject(projectId, caller, 'write');
    // A live run's name is unique per project, ignoring case (docs/api-runs.md
    // § Validation). The pre-check names the field; the unique index in the
    // store closes the concurrent-insert race.
    const duplicate = await this.store.findIdByNameIgnoreCase(projectId, dto.name, null);
    if (duplicate !== null) throw runNameConflict();
    return this.store.transaction(async (client) => {
      const planId = await this.resolvePlan(projectId, dto.plan_id, client);
      const startDate = dto.start_date ?? null;
      const dueDate = dto.due_date ?? null;
      assertDateOrder(startDate, dueDate);
      const snapshots = await this.materializeSelection(projectId, dto.selection, client);
      if (snapshots.length > MAX_RUN_ITEMS) {
        throw validationError(
          'selection',
          `would create more than ${MAX_RUN_ITEMS} items`,
        );
      }
      const run = await this.store.insertRun(
        {
          project_id: projectId,
          plan_id: planId ?? null,
          name: dto.name,
          description: blankToNull(dto.description),
          start_date: startDate,
          due_date: dueDate,
          created_by: caller.id,
        },
        client,
      );
      await this.store.insertItems(run.id, this.toItemWrites(snapshots, 1), client);
      return this.loadRun(run.id, client);
    });
  }

  /** Detail of a live run; soft-deleted rows are 404 like unknown ids. */
  async detail(caller: AuthUser, id: string): Promise<RunDto> {
    const row = await this.store.findLiveById(id);
    if (!row) throw runNotFound();
    await this.requireProject(row.project_id, caller, 'read');
    return this.loadRun(id);
  }

  /** PATCH: any non-empty subset; `plan_id: null` detaches, `null` clears. */
  async update(caller: AuthUser, id: string, dto: UpdateRunDto): Promise<RunDto> {
    const existing = await this.store.findLiveById(id);
    if (!existing) throw runNotFound();
    await this.requireProject(existing.project_id, caller, 'write');
    this.assertNonEmptyPatch(dto);

    return this.store.transaction(async (client) => {
      const row = await this.store.findLiveByIdForUpdate(id, client);
      if (!row) throw runNotFound();
      if (dto.name !== undefined) {
        // Renaming to a different case of the run's own name is allowed, so the
        // run itself is excluded from the duplicate lookup.
        const duplicate = await this.store.findIdByNameIgnoreCase(
          row.project_id,
          dto.name,
          id,
          client,
        );
        if (duplicate !== null) throw runNameConflict();
      }
      const planId = await this.resolvePlan(row.project_id, dto.plan_id, client);
      const startDate = dto.start_date === undefined ? row.start_date : dto.start_date;
      const dueDate = dto.due_date === undefined ? row.due_date : dto.due_date;
      assertDateOrder(startDate, dueDate);
      await this.store.updateRun(
        id,
        {
          name: dto.name,
          description:
            dto.description === undefined ? undefined : blankToNull(dto.description),
          plan_id: planId,
          start_date: dto.start_date,
          due_date: dto.due_date,
          updated_by: caller.id,
        },
        client,
      );
      return this.loadRun(id, client);
    });
  }

  /** Close run: `completed_at` set; 409 when it is already completed. */
  async close(caller: AuthUser, id: string): Promise<RunDto> {
    return this.setCompleted(caller, id, true);
  }

  /** Reopen run: `completed_at` cleared; 409 when it is already open. */
  async reopen(caller: AuthUser, id: string): Promise<RunDto> {
    return this.setCompleted(caller, id, false);
  }

  /**
   * Soft delete: the run leaves lists, plan rollups and a case's Linked runs,
   * but its results are kept (PRD Q6). A completed run may also be deleted.
   */
  async remove(caller: AuthUser, id: string): Promise<void> {
    const existing = await this.store.findLiveById(id);
    if (!existing) throw runNotFound();
    await this.requireProject(existing.project_id, caller, 'write');

    await this.store.transaction(async (client) => {
      const row = await this.store.findLiveByIdForUpdate(id, client);
      if (!row) throw runNotFound();
      await this.store.softDeleteRun(id, caller.id, client);
    });
  }

  /**
   * Every live run that contains one case, with the case's status in each — the
   * case drawer's Linked runs feed (§4.2). Newest run first; soft-deleted runs
   * are absent.
   */
  async caseRuns(
    caller: AuthUser,
    caseId: string,
    query: ListCaseRunsQuery,
  ): Promise<{ data: CaseRunDto[]; meta: ListMeta }> {
    const ref = await this.store.findCaseRef(caseId);
    if (!ref) throw new ApiError('NOT_FOUND', 'Case not found.');
    await this.requireProject(ref.project_id, caller, 'read');
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const total = await this.store.countCaseRuns(caseId);
    const rows = await this.store.listCaseRuns(caseId, limit, (page - 1) * limit);
    return { data: rows.map(toCaseRunDto), meta: buildListMeta(total, page, limit) };
  }

  // --- run items ----------------------------------------------------------

  /** Paginated item table for the run detail screen (§4.4). */
  async listItems(
    caller: AuthUser,
    runId: string,
    query: ListRunItemsQuery,
  ): Promise<{ data: RunItemDto[]; meta: ListMeta }> {
    const run = await this.requireReadableRun(runId, caller);
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const suiteIds =
      query.suite_id === undefined
        ? null
        : await this.store.suiteSubtreeIds(run.project_id, query.suite_id, true);
    const filter: RunItemFilter = {
      runId,
      statuses: query.status ?? null,
      assigneeId:
        query.assignee_id === undefined
          ? null
          : query.assignee_id === 'none'
            ? 'none'
            : query.assignee_id,
      suiteIds,
      query: query.query ?? null,
    };
    const total = await this.store.countItems(filter);
    const rows = await this.store.listItems({
      ...filter,
      sort: query.sort ?? 'position',
      limit,
      offset: (page - 1) * limit,
    });
    return { data: rows.map(toRunItemDto), meta: buildListMeta(total, page, limit) };
  }

  /** Item detail for the result drawer: the item plus its step snapshot. */
  async itemDetail(
    caller: AuthUser,
    runId: string,
    itemId: string,
  ): Promise<RunItemDetailDto> {
    await this.requireReadableRun(runId, caller);
    const row = await this.store.findItemDetail(runId, itemId);
    if (!row) throw itemNotFound();
    return toRunItemDetailDto(row);
  }

  /**
   * Add cases to an open run. Already-present or non-live cases are `skipped`,
   * never an error (contract § POST /runs/:id/items); the 2,000-item cap is a
   * 400 before anything is written.
   */
  async addItems(
    caller: AuthUser,
    runId: string,
    dto: AddRunItemsDto,
  ): Promise<{ added: number; skipped: number; item_ids: string[] }> {
    return this.store.transaction(async (client) => {
      const run = await this.requireOpenRunForWrite(runId, caller, client);
      const ids = [...new Set(dto.case_ids)];
      const existing = await this.store.existingCaseIds(runId, ids, client);
      const snapshots = await this.store.selectCases(run.project_id, ids, null, client);
      const toAdd = snapshots.filter((snapshot) => !existing.has(snapshot.id));
      const current = await this.store.countItemsForRun(runId, client);
      if (current + toAdd.length > MAX_RUN_ITEMS) {
        throw validationError(
          'case_ids',
          `a run may hold at most ${MAX_RUN_ITEMS} items`,
        );
      }
      const start = (await this.store.maxPosition(runId, client)) + 1;
      const inserted = await this.store.insertItems(
        runId,
        this.toItemWrites(toAdd, start),
        client,
      );
      if (inserted.length > 0) await this.store.touchRun(runId, caller.id, client);
      return {
        added: inserted.length,
        skipped: ids.length - inserted.length,
        item_ids: inserted.map((item) => item.id),
      };
    });
  }

  /** Assign or reorder one item; both fields are optional but one is required. */
  async updateItem(
    caller: AuthUser,
    runId: string,
    itemId: string,
    dto: UpdateRunItemDto,
  ): Promise<RunItemDto> {
    this.assertNonEmptyItemPatch(dto);
    return this.store.transaction(async (client) => {
      await this.requireOpenRunForWrite(runId, caller, client);
      const item = await this.store.findItemForUpdate(runId, itemId, client);
      if (!item) throw itemNotFound();

      if (dto.assignee_id !== undefined && dto.assignee_id !== null) {
        await this.requireAssignee(dto.assignee_id, client);
      }
      if (dto.assignee_id !== undefined) {
        await this.store.updateItem(itemId, { assignee_id: dto.assignee_id }, client);
      }
      if (dto.position !== undefined) {
        const count = await this.store.countItemsForRun(runId, client);
        const moved = await this.store.reorderItem(runId, itemId, dto.position, client);
        if (!moved) {
          throw validationError('position', `must be between 1 and ${count}`);
        }
      }
      await this.store.touchRun(runId, caller.id, client);
      const updated = await this.store.findItem(runId, itemId, client);
      if (!updated) throw itemNotFound();
      return toRunItemDto(updated);
    });
  }

  /** Bulk assign the run header's "Assign" button; omit ids to assign all. */
  async assign(
    caller: AuthUser,
    runId: string,
    dto: AssignRunItemsDto,
  ): Promise<{ assigned: number }> {
    if (dto.assignee_id === undefined) {
      throw validationError('assignee_id', 'is required (use null to unassign)');
    }
    return this.store.transaction(async (client) => {
      await this.requireOpenRunForWrite(runId, caller, client);
      if (dto.assignee_id !== null) await this.requireAssignee(dto.assignee_id, client);

      let assigned: number;
      if (dto.item_ids === undefined) {
        assigned = await this.store.bulkAssign(runId, dto.assignee_id, null, client);
      } else {
        const ids = [...new Set(dto.item_ids)];
        const known = await this.store.itemIdsInRun(runId, ids, client);
        const missing = ids.filter((id) => !known.has(id));
        if (missing.length > 0) {
          throw validationError('item_ids', `not in this run: ${missing.join(', ')}`);
        }
        assigned = await this.store.bulkAssign(runId, dto.assignee_id, ids, client);
      }
      await this.store.touchRun(runId, caller.id, client);
      return { assigned };
    });
  }

  /**
   * Remove a case from a run. Blocked (409) once the item has any result, so
   * recorded evidence is never silently lost (contract § DELETE item).
   */
  async removeItem(caller: AuthUser, runId: string, itemId: string): Promise<void> {
    await this.store.transaction(async (client) => {
      const run = await this.store.findLiveByIdForUpdate(runId, client);
      if (!run) throw runNotFound();
      await this.requireProject(run.project_id, caller, 'write', client);
      const item = await this.store.findItemForUpdate(runId, itemId, client);
      if (!item) throw itemNotFound();
      if (item.result_count > 0) {
        throw conflict(
          'This item already has a result; clear the assignee instead.',
          'item_id',
        );
      }
      await this.store.deleteItem(itemId, client);
      await this.store.touchRun(runId, caller.id, client);
    });
  }

  // --- internals ----------------------------------------------------------

  private async setCompleted(
    caller: AuthUser,
    id: string,
    completed: boolean,
  ): Promise<RunDto> {
    const existing = await this.store.findLiveById(id);
    if (!existing) throw runNotFound();
    await this.requireProject(existing.project_id, caller, 'write');

    return this.store.transaction(async (client) => {
      const row = await this.store.findLiveByIdForUpdate(id, client);
      if (!row) throw runNotFound();
      if (completed && row.completed_at !== null) {
        throw conflict('Run is already completed.');
      }
      if (!completed && row.completed_at === null) {
        throw conflict('Run is already open.');
      }
      await this.store.setCompleted(id, completed, caller.id, client);
      return this.loadRun(id, client);
    });
  }

  /** Resolves a plan reference: must be a live plan in the same project. */
  private async resolvePlan(
    projectId: string,
    planId: string | null | undefined,
    q: Queryable,
  ): Promise<string | null | undefined> {
    if (planId === undefined) return undefined;
    if (planId === null) return null;
    const plan = await this.store.findPlan(planId, q);
    if (!plan || plan.project_id !== projectId) {
      throw validationError('plan_id', 'must be a plan in this project');
    }
    return plan.id;
  }

  private async materializeSelection(
    projectId: string,
    selection: RunSelectionDto | undefined,
    q: Queryable,
  ): Promise<CaseSnapshotRow[]> {
    if (selection === undefined) return [];
    const caseIds = selection.case_ids ?? [];
    let suiteIds: string[] | null = null;
    const requestedSuites = selection.suite_ids ?? [];
    if (requestedSuites.length > 0) {
      // Validate first so the error can name the row that is wrong; duplicates
      // are dropped before the subtree query but keep the original index.
      const known = await this.store.findSuiteIds(projectId, requestedSuites, q);
      const seen = new Set<string>();
      const distinct: string[] = [];
      for (const [index, suiteId] of requestedSuites.entries()) {
        if (seen.has(suiteId)) continue;
        seen.add(suiteId);
        if (!known.has(suiteId)) {
          throw validationError(
            `selection.suite_ids[${index}]`,
            'is not a suite in this project',
          );
        }
        distinct.push(suiteId);
      }
      const includeDescendants = selection.include_descendants ?? true;
      suiteIds = await this.store.suiteSubtreeIdsMany(
        projectId,
        distinct,
        includeDescendants,
        q,
      );
    }
    if (caseIds.length === 0 && suiteIds === null) return [];
    return this.store.selectCases(projectId, caseIds, suiteIds, q);
  }

  private toItemWrites(snapshots: CaseSnapshotRow[], start: number): RunItemWrite[] {
    return snapshots.map((snapshot, index) => ({
      case_id: snapshot.id,
      case_display_id: toDisplayId(snapshot.case_number),
      case_title: snapshot.title,
      case_steps: snapshot.steps,
      case_priority: snapshot.priority,
      case_suite_id: snapshot.suite_id,
      position: start + index,
    }));
  }

  private async loadRun(id: string, q?: Queryable): Promise<RunDto> {
    const row = await this.store.findWithCounts(id, q);
    if (!row) throw runNotFound();
    return toRunDto(row);
  }

  private async requireReadableRun(runId: string, caller: AuthUser) {
    const run = await this.store.findLiveById(runId);
    if (!run) throw runNotFound();
    await this.requireProject(run.project_id, caller, 'read');
    return run;
  }

  /** Write guard for item/assign writes: live run, open, project writable. */
  private async requireOpenRunForWrite(
    runId: string,
    caller: AuthUser,
    client: Queryable,
  ) {
    const run = await this.store.findLiveByIdForUpdate(runId, client);
    if (!run) throw runNotFound();
    await this.requireProject(run.project_id, caller, 'write', client);
    if (run.completed_at !== null) {
      throw conflict('Run is completed and cannot be changed.');
    }
    return run;
  }

  private async requireAssignee(userId: string, q: Queryable): Promise<void> {
    const user = await this.store.findAssignee(userId, q);
    if (
      !user ||
      !user.is_active ||
      !(ASSIGNEE_ROLES as readonly string[]).includes(user.role)
    ) {
      throw validationError('assignee_id', 'must be an active admin, lead or tester');
    }
  }

  /**
   * Contract visibility: unknown project → 404; archived project → 404 for
   * non-Admins on reads and 409 on every write.
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

  private assertNonEmptyPatch(dto: UpdateRunDto): void {
    if (
      dto.name !== undefined ||
      dto.description !== undefined ||
      dto.plan_id !== undefined ||
      dto.start_date !== undefined ||
      dto.due_date !== undefined
    ) {
      return;
    }
    const fields = ['name', 'description', 'plan_id', 'start_date', 'due_date'];
    throw new ApiError(
      'VALIDATION_ERROR',
      'Provide at least one field to update.',
      fields.map((field) => ({ field, issue: 'at least one field must be provided' })),
    );
  }

  private assertNonEmptyItemPatch(dto: UpdateRunItemDto): void {
    if (dto.assignee_id !== undefined || dto.position !== undefined) return;
    throw new ApiError('VALIDATION_ERROR', 'Provide at least one field to update.', [
      { field: 'assignee_id', issue: 'at least one field must be provided' },
      { field: 'position', issue: 'at least one field must be provided' },
    ]);
  }
}