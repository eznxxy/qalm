import { Inject, Injectable } from '@nestjs/common';
import { AuthUser } from '../auth/current-user';
import { ApiError } from '../errors';
import { Queryable } from '../db/queryable';
import { CaseChange } from './cases.types';
import { diffCase, CasePatch, CaseSnapshot, CaseStepValue } from './case-diff';
import {
  BULK_MOVE_MAX,
  CASE_STEPS_MAX,
  CASE_STEP_EXPECTED_MAX,
  CASE_STEP_TEXT_MAX,
  CASE_TAGS_MAX,
  CASE_TAG_MAX,
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
} from './cases.constants';
import {
  BulkMoveCasesDto,
  CaseStepInputDto,
  CreateCaseDto,
  ListCaseHistoryQuery,
  ListCasesQuery,
  UpdateCaseDto,
} from './dto';
import { CaseListFilter, CaseRow, CasesStore } from './cases.store';
import { CaseDto, CaseHistoryDto, CaseListDto, toCaseDto, toCaseHistoryDto, toCaseListDto } from './cases.types';

export interface ListMeta {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

/** api-conventions.md § Envelopes, list meta shape. */
export function buildListMeta(total: number, page: number, limit: number): ListMeta {
  return {
    page,
    limit,
    total,
    total_pages: Math.max(1, Math.ceil(total / limit)),
  };
}

interface StepWrite {
  text: string;
  expected_result: string | null;
}

function validationError(field: string, issue: string): ApiError {
  return new ApiError('VALIDATION_ERROR', 'Request validation failed.', [{ field, issue }]);
}

function caseNotFound(): ApiError {
  return new ApiError('NOT_FOUND', 'Case not found.');
}

function suiteNotFound(): ApiError {
  return new ApiError('NOT_FOUND', 'Suite not found.');
}

/** Empty/blank text is stored as null, so `""` and an absent field agree. */
function blankToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Business rules for the cases endpoints, docs/api-cases.md. Role checks live
 * in the controller (@Roles + AuthGuard); numbering, step normalisation,
 * soft-delete semantics, audit rows and archived-project rules live here.
 */
@Injectable()
export class CasesService {
  constructor(@Inject(CasesStore) private readonly store: CasesStore) {}

  /** Paginated, filterable case table (AC8). Soft-deleted rows never appear. */
  async list(
    caller: AuthUser,
    projectId: string,
    query: ListCasesQuery,
  ): Promise<{ data: CaseListDto[]; meta: ListMeta }> {
    await this.requireProject(projectId, caller, 'read');
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const suiteIds =
      query.suite_id === undefined
        ? null
        : await this.store.suiteIdsForFilter(
            projectId,
            query.suite_id,
            query.include_descendants ?? true,
          );
    const filter: CaseListFilter = {
      projectId,
      suiteIds,
      query: query.query ?? null,
      priorities: query.priority ?? null,
      types: query.type ?? null,
      tags: query.tag ?? null,
    };
    const total = await this.store.countForList(filter);
    const rows = await this.store.listPage({
      ...filter,
      sort: query.sort ?? 'case_number',
      limit,
      offset: (page - 1) * limit,
    });
    return { data: rows.map(toCaseListDto), meta: buildListMeta(total, page, limit) };
  }

  /**
   * Creates a case, allocating the next project-scoped number and writing the
   * `created` audit row in the same transaction (numbers never come from
   * `max(case_number)`).
   */
  async create(caller: AuthUser, projectId: string, dto: CreateCaseDto): Promise<CaseDto> {
    await this.requireProject(projectId, caller, 'write');
    const tags = this.normalizeTags(dto.tags) ?? [];
    const steps = this.normalizeSteps(dto.steps) ?? [];

    return this.store.transaction(async (client) => {
      await this.requireSuite(projectId, dto.suite_id, client);
      const caseNumber = await this.store.nextCaseNumber(projectId, client);
      const row = await this.store.insertCase(
        {
          project_id: projectId,
          suite_id: dto.suite_id,
          case_number: caseNumber,
          title: dto.title,
          preconditions: blankToNull(dto.preconditions),
          priority: dto.priority,
          type: dto.type,
          tags,
          estimate_minutes: dto.estimate_minutes ?? null,
          created_by: caller.id,
          updated_by: caller.id,
        },
        client,
      );
      await this.store.insertSteps(row.id, steps, client);
      await this.store.insertHistory(
        { case_id: row.id, actor_id: caller.id, action: 'created', changes: {} },
        client,
      );
      return this.loadDetail(row, client);
    });
  }

  /** Detail of a live case; soft-deleted rows are 404 like unknown ids. */
  async detail(caller: AuthUser, id: string): Promise<CaseDto> {
    const row = await this.store.findLiveById(id);
    if (!row) throw caseNotFound();
    await this.requireProject(row.project_id, caller, 'read');
    return this.loadDetail(row);
  }

  /**
   * PATCH: any non-empty subset. Steps replace wholesale, a suite change is a
   * `moved` audit row, and the `updated` row lists exactly the fields whose
   * value actually changed. A patch that changes nothing writes nothing.
   */
  async update(caller: AuthUser, id: string, dto: UpdateCaseDto): Promise<CaseDto> {
    const existing = await this.store.findLiveById(id);
    if (!existing) throw caseNotFound();
    await this.requireProject(existing.project_id, caller, 'write');
    this.assertNonEmptyPatch(dto);

    const steps = this.normalizeSteps(dto.steps);
    const tags = this.normalizeTags(dto.tags);

    return this.store.transaction(async (client) => {
      const row = await this.store.findLiveByIdForUpdate(id, client);
      if (!row) throw caseNotFound();

      if (dto.suite_id !== undefined && dto.suite_id !== row.suite_id) {
        await this.requireSuite(row.project_id, dto.suite_id, client);
      }

      const beforeSteps = await this.store.stepsFor(id, client);
      const snapshot: CaseSnapshot = {
        title: row.title,
        preconditions: row.preconditions,
        priority: row.priority,
        type: row.type,
        tags: row.tags,
        estimate_minutes: row.estimate_minutes,
        suite_id: row.suite_id,
        steps: beforeSteps.map((step): CaseStepValue => ({
          text: step.text,
          expected_result: step.expected_result,
        })),
      };
      const patch: CasePatch = {};
      if (dto.title !== undefined) patch.title = dto.title;
      if (dto.preconditions !== undefined) patch.preconditions = blankToNull(dto.preconditions);
      if (dto.priority !== undefined) patch.priority = dto.priority;
      if (dto.type !== undefined) patch.type = dto.type;
      if (dto.estimate_minutes !== undefined) patch.estimate_minutes = dto.estimate_minutes;
      if (tags !== null) patch.tags = tags;
      if (steps !== null) patch.steps = steps;
      if (dto.suite_id !== undefined) patch.suite_id = dto.suite_id;

      const diff = diffCase(snapshot, patch);
      if (!diff.changed) return toCaseDto(row, beforeSteps);

      await this.store.updateFields(
        id,
        {
          title: dto.title,
          preconditions:
            dto.preconditions === undefined ? undefined : blankToNull(dto.preconditions),
          priority: dto.priority,
          type: dto.type,
          tags: tags ?? undefined,
          estimate_minutes: dto.estimate_minutes,
          suite_id: dto.suite_id,
          updated_by: caller.id,
        },
        client,
      );
      if (steps !== null) await this.store.replaceSteps(id, steps, client);

      const changes: Record<string, CaseChange> = { ...diff.updated };
      if (diff.steps !== null) changes['steps'] = diff.steps;
      if (Object.keys(changes).length > 0) {
        await this.store.insertHistory(
          { case_id: id, actor_id: caller.id, action: 'updated', changes },
          client,
        );
      }
      if (diff.moved !== null) {
        await this.store.insertHistory(
          {
            case_id: id,
            actor_id: caller.id,
            action: 'moved',
            changes: { suite_id: diff.moved },
          },
          client,
        );
      }

      const after = await this.store.findLiveById(id, client);
      if (!after) throw caseNotFound();
      return this.loadDetail(after, client);
    });
  }

  /**
   * Soft delete: the case vanishes from lists, counts and GET, its number
   * stays reserved and its history rows survive. A second DELETE is a 404
   * (documented, deliberate).
   */
  async remove(caller: AuthUser, id: string): Promise<void> {
    const existing = await this.store.findLiveById(id);
    if (!existing) throw caseNotFound();
    await this.requireProject(existing.project_id, caller, 'write');

    await this.store.transaction(async (client) => {
      const row = await this.store.findLiveByIdForUpdate(id, client);
      if (!row) throw caseNotFound();
      await this.store.softDelete(id, caller.id, client);
      await this.store.insertHistory(
        { case_id: id, actor_id: caller.id, action: 'deleted', changes: {} },
        client,
      );
    });
  }

  /**
   * Atomic bulk move (AC9): every id must be a live case in this project, the
   * target suite in the same project; either all move or nothing does, and
   * each re-assigned case gets a `moved` audit row.
   */
  async bulkMove(
    caller: AuthUser,
    projectId: string,
    dto: BulkMoveCasesDto,
  ): Promise<{ moved: number; case_ids: string[] }> {
    await this.requireProject(projectId, caller, 'write');
    if (dto.case_ids.length > BULK_MOVE_MAX) {
      throw validationError('case_ids', `must contain at most ${BULK_MOVE_MAX} ids`);
    }
    const ids = [...new Set(dto.case_ids)];

    return this.store.transaction(async (client) => {
      const suite = await this.store.findSuiteById(dto.suite_id, client);
      if (!suite) throw suiteNotFound();
      if (suite.project_id !== projectId) {
        throw validationError('suite_id', 'must belong to the same project');
      }

      const rows = await this.store.findLiveByIds(projectId, ids, client);
      const found = new Set(rows.map((row) => row.id));
      const missing = ids.filter((id) => !found.has(id));
      if (missing.length > 0) {
        throw validationError(
          'case_ids',
          `not a live case in this project: ${missing.join(', ')}`,
        );
      }

      const moving = rows.filter((row) => row.suite_id !== suite.id);
      await this.store.setSuiteForIds(
        moving.map((row) => row.id),
        suite.id,
        caller.id,
        client,
      );
      for (const row of moving) {
        await this.store.insertHistory(
          {
            case_id: row.id,
            actor_id: caller.id,
            action: 'moved',
            changes: { suite_id: { from: row.suite_id, to: suite.id } },
          },
          client,
        );
      }
      const movedIds = new Set(moving.map((row) => row.id));
      return { moved: moving.length, case_ids: ids.filter((id) => movedIds.has(id)) };
    });
  }

  /** Newest-first audit trail; a deleted case's history is not exposed here. */
  async history(
    caller: AuthUser,
    id: string,
    query: ListCaseHistoryQuery,
  ): Promise<{ data: CaseHistoryDto[]; meta: ListMeta }> {
    const row = await this.store.findLiveById(id);
    if (!row) throw caseNotFound();
    await this.requireProject(row.project_id, caller, 'read');
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const total = await this.store.countHistory(id);
    const history = await this.store.listHistory(id, {
      limit,
      offset: (page - 1) * limit,
    });
    return { data: history.map(toCaseHistoryDto), meta: buildListMeta(total, page, limit) };
  }

  /**
   * Contract visibility: unknown project → 404; archived project → 404 for
   * non-Admins on reads and 409 on every write (PRD § Delete semantics).
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

  /** A suite must exist and belong to the project; otherwise 404. */
  private async requireSuite(projectId: string, suiteId: string, q?: Queryable): Promise<void> {
    const suite = await this.store.findSuiteById(suiteId, q);
    if (!suite || suite.project_id !== projectId) throw suiteNotFound();
  }

  private async loadDetail(row: CaseRow, q?: Queryable): Promise<CaseDto> {
    const steps = await this.store.stepsFor(row.id, q);
    return toCaseDto(row, steps);
  }

  private assertNonEmptyPatch(dto: UpdateCaseDto): void {
    if (
      dto.title !== undefined ||
      dto.preconditions !== undefined ||
      dto.steps !== undefined ||
      dto.priority !== undefined ||
      dto.type !== undefined ||
      dto.tags !== undefined ||
      dto.estimate_minutes !== undefined ||
      dto.suite_id !== undefined
    ) {
      return;
    }
    throw new ApiError('VALIDATION_ERROR', 'Provide at least one field to update.', [
      { field: 'title', issue: 'at least one field must be provided' },
      { field: 'preconditions', issue: 'at least one field must be provided' },
      { field: 'steps', issue: 'at least one field must be provided' },
      { field: 'priority', issue: 'at least one field must be provided' },
      { field: 'type', issue: 'at least one field must be provided' },
      { field: 'tags', issue: 'at least one field must be provided' },
      { field: 'estimate_minutes', issue: 'at least one field must be provided' },
      { field: 'suite_id', issue: 'at least one field must be provided' },
    ]);
  }

  /**
   * Steps are validated again here (not only in the DTO) so non-HTTP callers
   * get the same contract error, naming the offending index exactly like the
   * API does: `steps[1].text`.
   */
  private normalizeSteps(steps: CaseStepInputDto[] | undefined): StepWrite[] | null {
    if (steps === undefined) return null;
    if (steps.length > CASE_STEPS_MAX) {
      throw validationError('steps', `must contain at most ${CASE_STEPS_MAX} entries`);
    }
    return steps.map((step, index) => {
      const text = typeof step.text === 'string' ? step.text.trim() : '';
      if (text.length < 1 || text.length > CASE_STEP_TEXT_MAX) {
        throw validationError(
          `steps[${index}].text`,
          `must be 1-${CASE_STEP_TEXT_MAX} characters`,
        );
      }
      const expected = typeof step.expected_result === 'string' ? step.expected_result.trim() : '';
      if (expected.length > CASE_STEP_EXPECTED_MAX) {
        throw validationError(
          `steps[${index}].expected_result`,
          `must be at most ${CASE_STEP_EXPECTED_MAX} characters`,
        );
      }
      return { text, expected_result: expected.length === 0 ? null : expected };
    });
  }

  /**
   * Tags are trimmed, lowercased and de-duplicated, preserving first-seen
   * order (docs/api-cases.md § Validation).
   */
  private normalizeTags(tags: string[] | undefined): string[] | null {
    if (tags === undefined) return null;
    if (tags.length > CASE_TAGS_MAX) {
      throw validationError('tags', `must contain at most ${CASE_TAGS_MAX} entries`);
    }
    const seen = new Set<string>();
    const out: string[] = [];
    tags.forEach((tag, index) => {
      const value = typeof tag === 'string' ? tag.trim().toLowerCase() : '';
      if (value.length < 1 || value.length > CASE_TAG_MAX) {
        throw validationError(`tags[${index}]`, `must be 1-${CASE_TAG_MAX} characters`);
      }
      if (!seen.has(value)) {
        seen.add(value);
        out.push(value);
      }
    });
    return out;
  }
}
