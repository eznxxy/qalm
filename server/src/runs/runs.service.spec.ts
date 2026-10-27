/* eslint-disable @typescript-eslint/require-await -- the in-memory fake mirrors
   the async store surface without doing I/O. */
import { Test } from '@nestjs/testing';
import { AuthUser, UserRole } from '../auth/current-user';
import { ErrorCode } from '../errors';
import { Queryable } from '../db/queryable';
import { ITEM_STATUS_RANK, ItemStatus, ResultStatus } from './runs.constants';
import { countsForStatuses } from './run-counts';
import { RunsService } from './runs.service';
import {
  CaseSnapshotRow,
  PlanRef,
  ProjectRef,
  RunItemDetailRow,
  RunItemFilter,
  RunItemRow,
  RunItemUpdateFields,
  RunItemWrite,
  RunListFilter,
  RunRow,
  RunUpdateFields,
  RunsStore,
  RunWithCountsRow,
  UserRef,
} from './runs.store';

/**
 * Decision-logic tests for RunsService over an in-memory fake of the runs
 * tables. SQL semantics (filters, ordering, the lateral latest-result join,
 * rollups, selection materialisation, reordering) are mirrored here; the real
 * SQL path is covered by test/runs.e2e-spec.ts.
 *
 * `transaction` snapshots and restores state so the create/add atomicity claim
 * is tested, not just stated.
 */
interface FakeItem {
  id: string;
  run_id: string;
  case_id: string | null;
  case_display_id: string;
  case_title: string;
  case_priority: string;
  case_suite_id: string;
  assignee_id: string | null;
  position: number;
  created_at: Date;
  updated_at: Date;
  case_steps: unknown;
}

interface FakeResult {
  id: string;
  run_item_id: string;
  status: ResultStatus;
  comment: string | null;
  elapsed_minutes: number | null;
  defect_url: string | null;
  attachment_count: number;
  created_by: string;
  created_at: Date;
}

interface FakeSuite {
  id: string;
  project_id: string;
  parent_id: string | null;
}

interface FakeCase {
  id: string;
  project_id: string;
  case_number: number;
  title: string;
  priority: string;
  suite_id: string | null;
  steps: unknown;
  preconditions: string | null;
  deleted_at: Date | null;
}

class FakeStore {
  projects: ProjectRef[] = [];
  plans: Array<PlanRef & { deleted: boolean }> = [];
  suites: FakeSuite[] = [];
  users: UserRef[] = [];
  cases: FakeCase[] = [];
  runs: RunRow[] = [];
  items: FakeItem[] = [];
  results: FakeResult[] = [];

  private nextId = 1;
  private clock = 0;

  seed(): void {
    this.projects = [
      { id: 'p-1', status: 'active' },
      { id: 'p-2', status: 'active' },
      { id: 'p-arch', status: 'archived' },
    ];
    this.plans = [
      { id: 'pl-1', project_id: 'p-1', deleted: false },
      { id: 'pl-2', project_id: 'p-1', deleted: false },
      { id: 'pl-gone', project_id: 'p-1', deleted: true },
      { id: 'pl-other', project_id: 'p-2', deleted: false },
    ];
    this.suites = [
      { id: 's-root', project_id: 'p-1', parent_id: null },
      { id: 's-child', project_id: 'p-1', parent_id: 's-root' },
      { id: 's-grand', project_id: 'p-1', parent_id: 's-child' },
      { id: 's-other', project_id: 'p-1', parent_id: null },
      { id: 's-project2', project_id: 'p-2', parent_id: null },
      { id: 's-arch', project_id: 'p-arch', parent_id: null },
    ];
    this.users = [
      { id: 'u-admin', role: 'admin', is_active: true },
      { id: 'u-lead', role: 'lead', is_active: true },
      { id: 'u-tester', role: 'tester', is_active: true },
      { id: 'u-viewer', role: 'viewer', is_active: true },
      { id: 'u-inactive', role: 'tester', is_active: false },
    ];
    this.cases = [];
    this.runs = [];
    this.items = [];
    this.results = [];
  }

  /** Deterministic, strictly increasing clock (ISO output stays stable). */
  private tick(): Date {
    this.clock += 1_000;
    return new Date(Date.UTC(2026, 9, 25, 9, 0, 0) + this.clock);
  }

  async transaction<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
    const snapshot = {
      runs: this.runs.map((row) => ({ ...row })),
      items: this.items.map((row) => ({ ...row })),
      results: this.results.map((row) => ({ ...row })),
      nextId: this.nextId,
      clock: this.clock,
    };
    try {
      return await fn({} as Queryable);
    } catch (error) {
      this.runs = snapshot.runs;
      this.items = snapshot.items;
      this.results = snapshot.results;
      this.nextId = snapshot.nextId;
      this.clock = snapshot.clock;
      throw error;
    }
  }

  // --- references ---------------------------------------------------------

  async findProject(projectId: string): Promise<ProjectRef | null> {
    return this.projects.find((project) => project.id === projectId) ?? null;
  }

  async findPlan(planId: string): Promise<PlanRef | null> {
    const plan = this.plans.find((row) => row.id === planId && !row.deleted);
    return plan ? { id: plan.id, project_id: plan.project_id } : null;
  }

  async findAssignee(id: string): Promise<UserRef | null> {
    return this.users.find((user) => user.id === id) ?? null;
  }

  async suiteSubtreeIds(
    projectId: string,
    suiteId: string,
    includeDescendants: boolean,
  ): Promise<string[]> {
    const inProject = this.suites.filter((suite) => suite.project_id === projectId);
    if (!inProject.some((suite) => suite.id === suiteId)) return [];
    if (!includeDescendants) return [suiteId];
    const walk = (id: string): string[] => [
      id,
      ...inProject
        .filter((suite) => suite.parent_id === id)
        .flatMap((child) => walk(child.id)),
    ];
    return walk(suiteId);
  }

  // --- runs ---------------------------------------------------------------

  async findLiveById(id: string): Promise<RunRow | null> {
    const row = this.runs.find((entry) => entry.id === id && entry.deleted_at === null);
    return row ? { ...row } : null;
  }

  async findLiveByIdForUpdate(id: string): Promise<RunRow | null> {
    return this.findLiveById(id);
  }

  async findWithCounts(id: string): Promise<RunWithCountsRow | null> {
    const row = await this.findLiveById(id);
    return row ? this.runWithCounts(row) : null;
  }

  async insertRun(row: {
    project_id: string;
    plan_id: string | null;
    name: string;
    description: string | null;
    start_date: string | null;
    due_date: string | null;
    created_by: string;
  }): Promise<RunRow> {
    const now = this.tick();
    const created: RunRow = {
      id: `run-${this.nextId++}`,
      project_id: row.project_id,
      plan_id: row.plan_id,
      name: row.name,
      description: row.description,
      start_date: row.start_date,
      due_date: row.due_date,
      completed_at: null,
      completed_by: null,
      created_by: row.created_by,
      updated_by: row.created_by,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    };
    this.runs.push(created);
    return created;
  }

  async updateRun(id: string, fields: RunUpdateFields): Promise<RunRow | null> {
    const row = this.runs.find((entry) => entry.id === id && entry.deleted_at === null);
    if (!row) return null;
    if (fields.name !== undefined) row.name = fields.name;
    if (fields.description !== undefined) row.description = fields.description;
    if (fields.plan_id !== undefined) row.plan_id = fields.plan_id;
    if (fields.start_date !== undefined) row.start_date = fields.start_date;
    if (fields.due_date !== undefined) row.due_date = fields.due_date;
    row.updated_by = fields.updated_by;
    row.updated_at = this.tick();
    return row;
  }

  async setCompleted(id: string, completed: boolean, actorId: string): Promise<RunRow | null> {
    const row = this.runs.find((entry) => entry.id === id && entry.deleted_at === null);
    if (!row) return null;
    row.completed_at = completed ? this.tick() : null;
    row.completed_by = completed ? actorId : null;
    row.updated_by = actorId;
    row.updated_at = this.tick();
    return row;
  }

  async softDeleteRun(id: string, actorId: string): Promise<RunRow | null> {
    const row = this.runs.find((entry) => entry.id === id && entry.deleted_at === null);
    if (!row) return null;
    row.deleted_at = this.tick();
    row.updated_by = actorId;
    row.updated_at = this.tick();
    return row;
  }

  async touchRun(id: string, actorId: string): Promise<void> {
    const row = this.runs.find((entry) => entry.id === id);
    if (!row) return;
    row.updated_by = actorId;
    row.updated_at = this.tick();
  }

  private compareRuns(a: RunWithCountsRow, b: RunWithCountsRow, sort: string): number {
    const descending = sort.startsWith('-');
    const key = descending ? sort.slice(1) : sort;
    let primary: number;
    if (key === 'name') primary = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    else if (key === 'updated_at') primary = a.updated_at.getTime() - b.updated_at.getTime();
    else if (key === 'due_date' || key === 'start_date') {
      // Null dates always sort last, whichever direction was asked for.
      const av = key === 'due_date' ? a.due_date : a.start_date;
      const bv = key === 'due_date' ? b.due_date : b.start_date;
      if (av === null && bv === null) primary = 0;
      else if (av === null) return 1;
      else if (bv === null) return -1;
      else primary = av < bv ? -1 : av > bv ? 1 : 0;
    } else primary = a.created_at.getTime() - b.created_at.getTime();
    if (primary !== 0) return descending ? -primary : primary;
    return a.id.localeCompare(b.id);
  }

  private matchesRuns(run: RunRow, filter: RunListFilter): boolean {
    if (run.project_id !== filter.projectId || run.deleted_at !== null) return false;
    if (filter.planId === 'none' && run.plan_id !== null) return false;
    if (filter.planId !== null && filter.planId !== 'none' && run.plan_id !== filter.planId) {
      return false;
    }
    if (filter.status === 'open' && run.completed_at !== null) return false;
    if (filter.status === 'completed' && run.completed_at === null) return false;
    if (filter.query !== null) {
      const needle = unescapeLike(filter.query).toLowerCase();
      if (!run.name.toLowerCase().includes(needle)) return false;
    }
    return true;
  }

  async countRuns(filter: RunListFilter): Promise<number> {
    return this.runs.filter((run) => this.matchesRuns(run, filter)).length;
  }

  async listRuns(
    filter: RunListFilter & { sort: string; limit: number; offset: number },
  ): Promise<RunWithCountsRow[]> {
    return this.runs
      .filter((run) => this.matchesRuns(run, filter))
      .map((run) => this.runWithCounts(run))
      .sort((a, b) => this.compareRuns(a, b, filter.sort))
      .slice(filter.offset, filter.offset + filter.limit);
  }

  // --- run items ----------------------------------------------------------

  private latestResult(itemId: string): FakeResult | null {
    const sorted = this.results
      .filter((result) => result.run_item_id === itemId)
      .sort(
        (a, b) =>
          b.created_at.getTime() - a.created_at.getTime() || b.id.localeCompare(a.id),
      );
    return sorted[0] ?? null;
  }

  private statusOf(itemId: string): ItemStatus {
    return this.latestResult(itemId)?.status ?? 'untested';
  }

  private materializeItem(item: FakeItem): RunItemRow {
    const latest = this.latestResult(item.id);
    return {
      id: item.id,
      run_id: item.run_id,
      case_id: item.case_id,
      case_display_id: item.case_display_id,
      case_title: item.case_title,
      case_priority: item.case_priority,
      case_suite_id: item.case_suite_id,
      assignee_id: item.assignee_id,
      position: item.position,
      created_at: item.created_at,
      updated_at: item.updated_at,
      status: latest?.status ?? 'untested',
      result_count: this.results.filter((result) => result.run_item_id === item.id).length,
      latest_result_id: latest?.id ?? null,
      latest_result_status: latest?.status ?? null,
      latest_result_comment: latest?.comment ?? null,
      latest_result_elapsed_minutes: latest?.elapsed_minutes ?? null,
      latest_result_defect_url: latest?.defect_url ?? null,
      latest_result_attachment_count: latest?.attachment_count ?? 0,
      latest_result_created_by: latest?.created_by ?? null,
      latest_result_created_at: latest?.created_at ?? null,
    };
  }

  async findItem(runId: string, itemId: string): Promise<RunItemRow | null> {
    const item = this.items.find((entry) => entry.id === itemId && entry.run_id === runId);
    return item ? this.materializeItem(item) : null;
  }

  async findItemById(itemId: string): Promise<RunItemRow | null> {
    const item = this.items.find((entry) => entry.id === itemId);
    return item ? this.materializeItem(item) : null;
  }

  async findItemDetail(runId: string, itemId: string): Promise<RunItemDetailRow | null> {
    const item = this.items.find((entry) => entry.id === itemId && entry.run_id === runId);
    if (!item) return null;
    const liveCase = this.cases.find(
      (row) => row.id === item.case_id && row.deleted_at === null,
    );
    return {
      ...this.materializeItem(item),
      case_steps: item.case_steps,
      case_preconditions: liveCase?.preconditions ?? null,
    };
  }

  async findItemForUpdate(runId: string, itemId: string): Promise<RunItemRow | null> {
    return this.findItem(runId, itemId);
  }

  private compareItems(a: RunItemRow, b: RunItemRow, sort: string): number {
    const descending = sort.startsWith('-');
    const key = descending ? sort.slice(1) : sort;
    let primary: number;
    if (key === 'case_display_id') {
      primary = Number(a.case_display_id.slice(1)) - Number(b.case_display_id.slice(1));
    } else if (key === 'status') {
      primary = ITEM_STATUS_RANK[a.status] - ITEM_STATUS_RANK[b.status];
    } else if (key === 'updated_at') {
      primary = a.updated_at.getTime() - b.updated_at.getTime();
    } else primary = a.position - b.position;
    if (primary !== 0) return descending ? -primary : primary;
    return a.position - b.position;
  }

  private matchesItems(item: RunItemRow, filter: RunItemFilter): boolean {
    if (item.run_id !== filter.runId) return false;
    if (filter.statuses !== null && filter.statuses.length > 0) {
      if (!filter.statuses.includes(item.status)) return false;
    }
    if (filter.assigneeId === 'none' && item.assignee_id !== null) return false;
    if (
      filter.assigneeId !== null &&
      filter.assigneeId !== 'none' &&
      item.assignee_id !== filter.assigneeId
    ) {
      return false;
    }
    if (filter.suiteIds !== null && !filter.suiteIds.includes(item.case_suite_id)) return false;
    if (filter.query !== null) {
      const needle = unescapeLike(filter.query).toLowerCase();
      if (!item.case_title.toLowerCase().includes(needle)) return false;
    }
    return true;
  }

  async countItems(filter: RunItemFilter): Promise<number> {
    return this.items
      .map((item) => this.materializeItem(item))
      .filter((item) => this.matchesItems(item, filter)).length;
  }

  async listItems(
    filter: RunItemFilter & { sort: string; limit: number; offset: number },
  ): Promise<RunItemRow[]> {
    return this.items
      .map((item) => this.materializeItem(item))
      .filter((item) => this.matchesItems(item, filter))
      .sort((a, b) => this.compareItems(a, b, filter.sort))
      .slice(filter.offset, filter.offset + filter.limit);
  }

  async countItemsForRun(runId: string): Promise<number> {
    return this.items.filter((item) => item.run_id === runId).length;
  }

  async existingCaseIds(runId: string, caseIds: string[]): Promise<Set<string>> {
    return new Set(
      this.items
        .filter((item) => item.run_id === runId && item.case_id && caseIds.includes(item.case_id))
        .map((item) => item.case_id as string),
    );
  }

  async maxPosition(runId: string): Promise<number> {
    const positions = this.items
      .filter((item) => item.run_id === runId)
      .map((item) => item.position);
    return positions.length === 0 ? 0 : Math.max(...positions);
  }

  async insertItems(runId: string, items: RunItemWrite[]): Promise<RunItemRow[]> {
    const now = this.tick();
    const created = items.map((item): FakeItem => ({
      id: `item-${this.nextId++}`,
      run_id: runId,
      case_id: item.case_id,
      case_display_id: item.case_display_id,
      case_title: item.case_title,
      case_priority: item.case_priority,
      case_suite_id: item.case_suite_id,
      assignee_id: null,
      position: item.position,
      created_at: now,
      updated_at: now,
      case_steps: item.case_steps,
    }));
    this.items.push(...created);
    return created.map((item) => this.materializeItem(item));
  }

  async updateItem(itemId: string, fields: RunItemUpdateFields): Promise<RunItemRow | null> {
    const item = this.items.find((entry) => entry.id === itemId);
    if (!item) return null;
    if (fields.assignee_id !== undefined) item.assignee_id = fields.assignee_id;
    item.updated_at = this.tick();
    return this.materializeItem(item);
  }

  async bulkAssign(runId: string, assigneeId: string | null, itemIds: string[] | null): Promise<number> {
    const targets = this.items.filter(
      (item) => item.run_id === runId && (itemIds === null || itemIds.includes(item.id)),
    );
    for (const item of targets) {
      item.assignee_id = assigneeId;
      item.updated_at = this.tick();
    }
    return targets.length;
  }

  async itemIdsInRun(runId: string, itemIds: string[]): Promise<Set<string>> {
    return new Set(
      this.items
        .filter((item) => item.run_id === runId && itemIds.includes(item.id))
        .map((item) => item.id),
    );
  }

  async deleteItem(itemId: string): Promise<boolean> {
    const before = this.items.length;
    this.items = this.items.filter((item) => item.id !== itemId);
    return this.items.length < before;
  }

  async reorderItem(runId: string, itemId: string, newPosition: number): Promise<boolean> {
    const ids = this.items
      .filter((item) => item.run_id === runId)
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
      .map((item) => item.id);
    const fromIndex = ids.indexOf(itemId);
    if (fromIndex === -1) return false;
    if (newPosition < 1 || newPosition > ids.length) return false;
    const reordered = [...ids];
    reordered.splice(fromIndex, 1);
    reordered.splice(newPosition - 1, 0, itemId);
    reordered.forEach((id, index) => {
      const item = this.items.find((entry) => entry.id === id);
      if (item) {
        item.position = index + 1;
        item.updated_at = this.tick();
      }
    });
    return true;
  }

  // --- case selection -----------------------------------------------------

  async selectCases(
    projectId: string,
    caseIds: string[],
    suiteIds: string[] | null,
  ): Promise<CaseSnapshotRow[]> {
    return this.cases
      .filter(
        (row) =>
          row.project_id === projectId &&
          row.deleted_at === null &&
          row.suite_id !== null &&
          (caseIds.includes(row.id) ||
            (suiteIds !== null && suiteIds.includes(row.suite_id))),
      )
      .sort((a, b) => a.case_number - b.case_number)
      .map((row) => ({
        id: row.id,
        case_number: row.case_number,
        title: row.title,
        priority: row.priority,
        suite_id: row.suite_id as string,
        steps: row.steps,
      }));
  }

  async countLiveCasesByIds(projectId: string, caseIds: string[]): Promise<Set<string>> {
    return new Set(
      this.cases
        .filter(
          (row) =>
            row.project_id === projectId &&
            row.deleted_at === null &&
            row.suite_id !== null &&
            caseIds.includes(row.id),
        )
        .map((row) => row.id),
    );
  }

  // --- fixtures -----------------------------------------------------------

  private runWithCounts(run: RunRow): RunWithCountsRow {
    const statuses = this.items
      .filter((item) => item.run_id === run.id)
      .map((item) => this.statusOf(item.id));
    const counts = countsForStatuses(statuses);
    const assignees = [
      ...new Set(
        this.items
          .filter((item) => item.run_id === run.id && item.assignee_id !== null)
          .map((item) => item.assignee_id as string),
      ),
    ];
    const suites = [
      ...new Set(
        this.items
          .filter((item) => item.run_id === run.id && item.case_suite_id !== null)
          .map((item) => item.case_suite_id),
      ),
    ];
    return {
      ...run,
      total: counts.total,
      passed: counts.passed,
      failed: counts.failed,
      blocked: counts.blocked,
      retest: counts.retest,
      skipped: counts.skipped,
      untested: counts.untested,
      assignee_ids: assignees.length > 0 ? assignees : null,
      suite_ids: suites.length > 0 ? suites : null,
    };
  }

  addRun(overrides: {
    projectId?: string;
    planId?: string | null;
    name?: string;
    description?: string | null;
    startDate?: string | null;
    dueDate?: string | null;
    completedAt?: Date | null;
    deleted?: boolean;
    createdBy?: string;
  } = {}): RunRow {
    const now = this.tick();
    const row: RunRow = {
      id: `run-${this.nextId++}`,
      project_id: overrides.projectId ?? 'p-1',
      plan_id: overrides.planId ?? null,
      name: overrides.name ?? 'Run',
      description: overrides.description ?? null,
      start_date: overrides.startDate ?? null,
      due_date: overrides.dueDate ?? null,
      completed_at: overrides.completedAt ?? null,
      completed_by: overrides.completedAt ? 'u-admin' : null,
      created_by: overrides.createdBy ?? 'u-admin',
      updated_by: overrides.createdBy ?? 'u-admin',
      deleted_at: overrides.deleted ? now : null,
      created_at: now,
      updated_at: now,
    };
    this.runs.push(row);
    return row;
  }

  addCase(overrides: {
    projectId?: string;
    suiteId?: string | null;
    caseNumber?: number;
    title?: string;
    priority?: string;
    steps?: unknown;
    deleted?: boolean;
    preconditions?: string | null;
  } = {}): FakeCase {
    const row: FakeCase = {
      id: `c-${this.nextId++}`,
      project_id: overrides.projectId ?? 'p-1',
      case_number: overrides.caseNumber ?? this.nextId,
      title: overrides.title ?? 'Case',
      priority: overrides.priority ?? 'medium',
      suite_id: overrides.suiteId === undefined ? 's-root' : overrides.suiteId,
      steps: overrides.steps ?? [],
      preconditions: overrides.preconditions ?? null,
      deleted_at: overrides.deleted ? this.tick() : null,
    };
    this.cases.push(row);
    return row;
  }

  addItem(
    runId: string,
    overrides: {
      caseId?: string | null;
      caseDisplayId?: string;
      caseTitle?: string;
      casePriority?: string;
      caseSuiteId?: string;
      assigneeId?: string | null;
      position?: number;
      caseSteps?: unknown;
    } = {},
  ): RunItemRow {
    const now = this.tick();
    const item: FakeItem = {
      id: `item-${this.nextId++}`,
      run_id: runId,
      case_id: overrides.caseId === undefined ? `c-${this.nextId}` : overrides.caseId,
      case_display_id: overrides.caseDisplayId ?? `C${this.nextId}`,
      case_title: overrides.caseTitle ?? 'Case',
      case_priority: overrides.casePriority ?? 'medium',
      case_suite_id: overrides.caseSuiteId ?? 's-root',
      assignee_id: overrides.assigneeId ?? null,
      position: overrides.position ?? this.items.filter((i) => i.run_id === runId).length + 1,
      created_at: now,
      updated_at: now,
      case_steps: overrides.caseSteps ?? [],
    };
    this.items.push(item);
    return this.materializeItem(item);
  }

  addResult(
    itemId: string,
    overrides: {
      status?: ResultStatus;
      comment?: string | null;
      elapsedMinutes?: number | null;
      defectUrl?: string | null;
      attachmentCount?: number;
      createdBy?: string;
    } = {},
  ): FakeResult {
    const row: FakeResult = {
      id: `res-${this.nextId++}`,
      run_item_id: itemId,
      status: overrides.status ?? 'passed',
      comment: overrides.comment ?? null,
      elapsed_minutes: overrides.elapsedMinutes ?? null,
      defect_url: overrides.defectUrl ?? null,
      attachment_count: overrides.attachmentCount ?? 0,
      created_by: overrides.createdBy ?? 'u-admin',
      created_at: this.tick(),
    };
    this.results.push(row);
    return row;
  }

  runById(id: string): RunRow {
    const row = this.runs.find((entry) => entry.id === id);
    if (!row) throw new Error(`no run ${id}`);
    return row;
  }

  itemById(id: string): FakeItem {
    const row = this.items.find((entry) => entry.id === id);
    if (!row) throw new Error(`no item ${id}`);
    return row;
  }
}

/** Reverses the store's LIKE escaping so the fake matches literal text. */
function unescapeLike(raw: string): string {
  return raw.replace(/\\([\\%_])/g, '$1');
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

describe('RunsService (unit, in-memory runs)', () => {
  let service: RunsService;
  let store: FakeStore;

  beforeEach(async () => {
    store = new FakeStore();
    store.seed();
    const moduleRef = await Test.createTestingModule({
      providers: [{ provide: RunsStore, useValue: store }, RunsService],
    }).compile();
    service = moduleRef.get(RunsService);
  });

  describe('list', () => {
    it('returns live runs newest-first with rollups, assignees, suites and pagination meta', async () => {
      const first = store.addRun({ name: 'Oldest', createdBy: 'u-admin' });
      store.addRun({ name: 'Newest', createdBy: 'u-admin' });
      store.addRun({ name: 'Deleted', deleted: true });
      const item = store.addItem(first.id, { caseSuiteId: 's-root' });
      store.addItem(first.id, { assigneeId: 'u-tester', caseSuiteId: 's-root' });
      store.addResult(item.id, { status: 'passed' });

      const result = await service.list(AS('viewer'), 'p-1', {});

      expect(result.data.map((row) => row.name)).toEqual(['Newest', 'Oldest']);
      expect(result.data[1]!.counts).toEqual({
        total: 2,
        passed: 1,
        failed: 0,
        blocked: 0,
        retest: 0,
        skipped: 0,
        untested: 1,
        percent_complete: 50,
      });
      expect(result.data[1]!.assignee_ids).toEqual(['u-tester']);
      expect(result.data[0]!.assignee_ids).toEqual([]);
      // Both items snapshot the same suite, so it appears once; the empty run
      // reports [] rather than null.
      expect(result.data[1]!.suite_ids).toEqual(['s-root']);
      expect(result.data[0]!.suite_ids).toEqual([]);
      expect(result.meta).toEqual({ page: 1, limit: 25, total: 2, total_pages: 1 });
    });

    it('filters by plan id, the none sentinel, status and name substring', async () => {
      store.addRun({ name: 'Release smoke', planId: 'pl-1' });
      store.addRun({ name: 'Release full', planId: 'pl-2', completedAt: new Date() });
      store.addRun({ name: 'Ad hoc', planId: null });

      const inPlan = await service.list(AS('admin'), 'p-1', { plan_id: 'pl-1' });
      expect(inPlan.data.map((row) => row.name)).toEqual(['Release smoke']);

      const noPlan = await service.list(AS('admin'), 'p-1', { plan_id: 'none' });
      expect(noPlan.data.map((row) => row.name)).toEqual(['Ad hoc']);

      const completed = await service.list(AS('admin'), 'p-1', { status: 'completed' });
      expect(completed.data.map((row) => row.name)).toEqual(['Release full']);

      const byName = await service.list(AS('admin'), 'p-1', { query: 'release' });
      expect(byName.data.map((row) => row.name).sort()).toEqual(['Release full', 'Release smoke']);
    });

    it('treats LIKE wildcards in the query as literal text', async () => {
      store.addRun({ name: '100% coverage' });
      store.addRun({ name: '1000 coverage' });

      const result = await service.list(AS('admin'), 'p-1', { query: '100%' });
      expect(result.data.map((row) => row.name)).toEqual(['100% coverage']);
    });

    it('sorts by name, paginates and keeps null due dates last', async () => {
      store.addRun({ name: 'bravo', dueDate: '2026-11-02' });
      store.addRun({ name: 'alpha', dueDate: null });
      store.addRun({ name: 'charlie', dueDate: '2026-11-01' });

      const byName = await service.list(AS('admin'), 'p-1', { sort: 'name' });
      expect(byName.data.map((row) => row.name)).toEqual(['alpha', 'bravo', 'charlie']);

      const byDue = await service.list(AS('admin'), 'p-1', { sort: 'due_date' });
      expect(byDue.data.map((row) => row.name)).toEqual(['charlie', 'bravo', 'alpha']);

      const page2 = await service.list(AS('admin'), 'p-1', { page: 2, limit: 2 });
      expect(page2.data).toHaveLength(1);
      expect(page2.meta).toEqual({ page: 2, limit: 2, total: 3, total_pages: 2 });
    });

    it('sorts by start date with null start dates last in both directions', async () => {
      store.addRun({ name: 'later', startDate: '2026-11-05' });
      store.addRun({ name: 'none', startDate: null });
      store.addRun({ name: 'earlier', startDate: '2026-11-01' });

      const ascending = await service.list(AS('admin'), 'p-1', { sort: 'start_date' });
      expect(ascending.data.map((row) => row.name)).toEqual(['earlier', 'later', 'none']);

      const descending = await service.list(AS('admin'), 'p-1', { sort: '-start_date' });
      expect(descending.data.map((row) => row.name)).toEqual(['later', 'earlier', 'none']);
    });

    it('404s an unknown project and hides an archived one from non-Admins', async () => {
      await expectCode(service.list(AS('admin'), 'nope', {}), 'NOT_FOUND');
      await expectCode(service.list(AS('tester'), 'p-arch', {}), 'NOT_FOUND');
      await expect(service.list(AS('admin'), 'p-arch', {})).resolves.toMatchObject({
        data: [],
      });
    });
  });

  describe('create', () => {
    it('materialises the union of case ids and a suite subtree, deduplicated and in case order', async () => {
      const c1 = store.addCase({ caseNumber: 1, suiteId: 's-root', title: 'Root' });
      store.addCase({ caseNumber: 2, suiteId: 's-child', title: 'Child' });
      store.addCase({ caseNumber: 3, suiteId: 's-grand', title: 'Grand' });
      const c4 = store.addCase({ caseNumber: 4, suiteId: 's-other', title: 'Other' });

      const dto = {
        name: 'Smoke',
        selection: { case_ids: [c4.id, c1.id], suite_id: 's-root' },
      };
      const run = await service.create(AS('lead'), 'p-1', dto);

      expect(run.counts.total).toBe(4);
      const items = await service.listItems(AS('lead'), run.id, {});
      expect(items.data.map((row) => row.case_display_id)).toEqual(['C1', 'C2', 'C3', 'C4']);
      expect(items.data.map((row) => row.position)).toEqual([1, 2, 3, 4]);
      expect(items.data[0]!.case_title).toBe('Root');
      expect(items.data[0]!.status).toBe('untested');
    });

    it('creates an empty run when the selection is omitted or matches nothing', async () => {
      const empty = await service.create(AS('admin'), 'p-1', { name: 'Empty' });
      expect(empty.counts.total).toBe(0);

      const unknownCase = await service.create(AS('admin'), 'p-1', {
        name: 'No matches',
        selection: { case_ids: ['c-unknown'] },
      });
      expect(unknownCase.counts.total).toBe(0);
    });

    it('400s an unknown selection suite and writes nothing', async () => {
      await expectCode(
        service.create(AS('admin'), 'p-1', {
          name: 'Bad suite',
          selection: { suite_id: 's-other-project' },
        }),
        'VALIDATION_ERROR',
      );
      expect(store.runs).toHaveLength(0);
    });

    it('400s a plan_id that is unknown, deleted or from another project', async () => {
      await expectCode(
        service.create(AS('admin'), 'p-1', { name: 'Bad plan', plan_id: 'pl-gone' }),
        'VALIDATION_ERROR',
      );
      await expectCode(
        service.create(AS('admin'), 'p-1', { name: 'Foreign', plan_id: 'pl-other' }),
        'VALIDATION_ERROR',
      );
      await expect(service.create(AS('admin'), 'p-1', {
        name: 'Good',
        plan_id: 'pl-1',
      })).resolves.toMatchObject({ plan_id: 'pl-1' });
    });

    it('409s every write in an archived project', async () => {
      await expectCode(service.create(AS('admin'), 'p-arch', { name: 'Nope' }), 'CONFLICT');
    });

    it('stores an optional start_date and rejects one that lands after the due date', async () => {
      const run = await service.create(AS('lead'), 'p-1', {
        name: 'Dated',
        start_date: '2026-11-01',
        due_date: '2026-11-14',
      });
      expect(run).toMatchObject({ start_date: '2026-11-01', due_date: '2026-11-14' });

      await expect(
        service.create(AS('admin'), 'p-1', {
          name: 'Backwards',
          start_date: '2026-11-20',
          due_date: '2026-11-14',
        }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [{ field: 'start_date', issue: 'must be on or before due_date' }],
      });
      expect(store.runs).toHaveLength(1);
    });

    it('accepts a start_date with no due date, and a due date alone', async () => {
      const startOnly = await service.create(AS('lead'), 'p-1', {
        name: 'Starts only',
        start_date: '2026-11-01',
      });
      expect(startOnly).toMatchObject({ start_date: '2026-11-01', due_date: null });

      const dueOnly = await service.create(AS('lead'), 'p-1', {
        name: 'Due only',
        due_date: '2026-11-14',
      });
      expect(dueOnly).toMatchObject({ start_date: null, due_date: '2026-11-14' });
    });

    it('400s a selection larger than the 2,000-item cap and commits nothing', async () => {
      store.addCase({ caseNumber: 1, suiteId: 's-root' });
      const many = Array.from({ length: 2_001 }, (_, index) => `c-${index + 2}`);
      for (const [index, id] of many.entries()) {
        store.cases.push({
          id,
          project_id: 'p-1',
          case_number: index + 2,
          title: 'Case',
          priority: 'low',
          suite_id: 's-root',
          steps: [],
          preconditions: null,
          deleted_at: null,
        });
      }
      await expectCode(
        service.create(AS('admin'), 'p-1', {
          name: 'Too big',
          selection: { suite_id: 's-root' },
        }),
        'VALIDATION_ERROR',
      );
      expect(store.runs).toHaveLength(0);
    });
  });

  describe('detail', () => {
    it('returns a live run with counts, assignees and the suites it touches', async () => {
      const run = store.addRun({ name: 'Smoke' });
      store.addItem(run.id, { assigneeId: 'u-tester', caseSuiteId: 's-root' });
      store.addItem(run.id, { caseSuiteId: 's-child' });
      store.addItem(run.id, { caseSuiteId: 's-root' });

      const detail = await service.detail(AS('viewer'), run.id);
      expect(detail.name).toBe('Smoke');
      expect(detail.counts.total).toBe(3);
      expect(detail.assignee_ids).toEqual(['u-tester']);
      // Distinct, so the repeated s-root is not offered twice in the filter.
      expect(detail.suite_ids).toEqual(['s-root', 's-child']);
    });

    it('reports no suites for a run with no items', async () => {
      const run = store.addRun({ name: 'Empty' });

      const detail = await service.detail(AS('viewer'), run.id);
      expect(detail.suite_ids).toEqual([]);
    });

    it('404s unknown and soft-deleted runs and hides archived from non-Admins', async () => {
      const gone = store.addRun({ name: 'Gone', deleted: true });
      await expectCode(service.detail(AS('admin'), 'nope'), 'NOT_FOUND');
      await expectCode(service.detail(AS('admin'), gone.id), 'NOT_FOUND');

      const archived = store.addRun({ projectId: 'p-arch' });
      await expectCode(service.detail(AS('lead'), archived.id), 'NOT_FOUND');
      await expect(service.detail(AS('admin'), archived.id)).resolves.toMatchObject({
        id: archived.id,
      });
    });
  });

  describe('update', () => {
    it('applies a non-empty subset and detaches a plan with an explicit null', async () => {
      const run = store.addRun({ name: 'Old', planId: 'pl-1' });

      const updated = await service.update(AS('lead'), run.id, {
        name: 'New',
        plan_id: null,
        due_date: '2026-12-01',
      });

      expect(updated).toMatchObject({ name: 'New', plan_id: null, due_date: '2026-12-01' });
    });

    it('400s an empty patch and 400s a foreign plan', async () => {
      const run = store.addRun({});
      await expectCode(service.update(AS('admin'), run.id, {}), 'VALIDATION_ERROR');
      await expectCode(
        service.update(AS('admin'), run.id, { plan_id: 'pl-other' }),
        'VALIDATION_ERROR',
      );
    });

    it('409s writes in an archived project', async () => {
      const run = store.addRun({ projectId: 'p-arch' });
      await expectCode(service.update(AS('admin'), run.id, { name: 'X' }), 'CONFLICT');
    });

    it('sets and clears the start date; null clears both dates', async () => {
      const run = store.addRun({ name: 'Run', dueDate: '2026-11-14' });

      const dated = await service.update(AS('lead'), run.id, { start_date: '2026-11-01' });
      expect(dated).toMatchObject({ start_date: '2026-11-01', due_date: '2026-11-14' });

      const cleared = await service.update(AS('lead'), run.id, {
        start_date: null,
        due_date: null,
      });
      expect(cleared).toMatchObject({ start_date: null, due_date: null });
    });

    it('400s a start date after an existing due date, and a due date before an existing start', async () => {
      const run = store.addRun({ name: 'Run', startDate: '2026-11-01', dueDate: '2026-11-14' });

      await expect(
        service.update(AS('lead'), run.id, { start_date: '2026-11-20' }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [{ field: 'start_date', issue: 'must be on or before due_date' }],
      });
      await expect(
        service.update(AS('lead'), run.id, { due_date: '2026-10-01' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

      // The rejected patches wrote nothing.
      expect(await service.detail(AS('lead'), run.id)).toMatchObject({
        start_date: '2026-11-01',
        due_date: '2026-11-14',
      });
    });

    it('allows moving both dates together, including to an earlier window', async () => {
      const run = store.addRun({ name: 'Run', startDate: '2026-11-01', dueDate: '2026-11-14' });
      const moved = await service.update(AS('lead'), run.id, {
        start_date: '2026-10-01',
        due_date: '2026-10-15',
      });
      expect(moved).toMatchObject({ start_date: '2026-10-01', due_date: '2026-10-15' });
    });
  });

  describe('close and reopen', () => {
    it('closes then reopens, flipping the derived status', async () => {
      const run = store.addRun({ name: 'Smoke' });

      const closed = await service.close(AS('lead'), run.id);
      expect(closed.status).toBe('completed');
      expect(closed.completed_at).not.toBeNull();
      expect(closed.completed_by).toBe('u-lead');

      const reopened = await service.reopen(AS('lead'), run.id);
      expect(reopened.status).toBe('open');
      expect(reopened.completed_at).toBeNull();
      expect(reopened.completed_by).toBeNull();
    });

    it('409s closing a completed run and reopening an open one', async () => {
      const run = store.addRun({});
      await expectCode(service.reopen(AS('admin'), run.id), 'CONFLICT');
      await service.close(AS('admin'), run.id);
      await expectCode(service.close(AS('admin'), run.id), 'CONFLICT');
    });
  });

  describe('remove', () => {
    it('soft deletes the run but keeps its results', async () => {
      const run = store.addRun({ name: 'Gone' });
      const item = store.addItem(run.id, {});
      store.addResult(item.id, { status: 'passed' });

      await service.remove(AS('lead'), run.id);

      expect(store.runById(run.id).deleted_at).not.toBeNull();
      expect(store.results).toHaveLength(1);
      await expectCode(service.detail(AS('lead'), run.id), 'NOT_FOUND');
      await expectCode(service.remove(AS('lead'), run.id), 'NOT_FOUND');
    });
  });

  describe('listItems', () => {
    it('orders by position by default and snapshots the case fields', async () => {
      const run = store.addRun({});
      store.addItem(run.id, { position: 2, caseDisplayId: 'C2', caseTitle: 'Second' });
      store.addItem(run.id, { position: 1, caseDisplayId: 'C1', caseTitle: 'First' });

      const result = await service.listItems(AS('viewer'), run.id, {});
      expect(result.data.map((row) => row.case_display_id)).toEqual(['C1', 'C2']);
      expect(result.data[0]).toMatchObject({ case_title: 'First', case_suite_id: 's-root' });
      expect(result.data[0]).not.toHaveProperty('case_steps');
      expect(result.meta).toEqual({ page: 1, limit: 25, total: 2, total_pages: 1 });
    });

    it('filters by status (untested included), assignee (none sentinel) and suite subtree', async () => {
      const run = store.addRun({});
      const failed = store.addItem(run.id, { caseSuiteId: 's-child', assigneeId: 'u-tester' });
      store.addResult(failed.id, { status: 'failed', comment: 'boom' });
      const untouched = store.addItem(run.id, { caseSuiteId: 's-root' });
      store.addItem(run.id, { caseSuiteId: 's-other', assigneeId: 'u-lead' });

      const byStatus = await service.listItems(AS('admin'), run.id, { status: ['untested'] });
      expect(byStatus.data).toHaveLength(2);

      const byFailed = await service.listItems(AS('admin'), run.id, { status: ['failed'] });
      expect(byFailed.data.map((row) => row.id)).toEqual([failed.id]);

      const unassigned = await service.listItems(AS('admin'), run.id, { assignee_id: 'none' });
      expect(unassigned.data.map((row) => row.id)).toEqual([untouched.id]);

      const bySuite = await service.listItems(AS('admin'), run.id, { suite_id: 's-root' });
      // s-root covers s-root + s-child + s-grand, not s-other.
      expect(bySuite.data.map((row) => row.id).sort()).toEqual([failed.id, untouched.id].sort());
    });

    it('sorts by status severity (worst first) and 404s an unknown run', async () => {
      const run = store.addRun({});
      const passed = store.addItem(run.id, { position: 1 });
      store.addResult(passed.id, { status: 'passed' });
      const failed = store.addItem(run.id, { position: 2 });
      store.addResult(failed.id, { status: 'failed', comment: 'boom' });
      store.addItem(run.id, { position: 3 });

      const byStatus = await service.listItems(AS('admin'), run.id, { sort: 'status' });
      expect(byStatus.data.map((row) => row.status)).toEqual(['failed', 'passed', 'untested']);

      await expectCode(service.listItems(AS('admin'), 'nope', {}), 'NOT_FOUND');
    });
  });

  describe('itemDetail', () => {
    it('returns the snapshot steps and the live preconditions', async () => {
      const run = store.addRun({});
      const item = store.addItem(run.id, {
        caseSteps: [{ position: 1, text: 'Open checkout', expected_result: 'Cart shown' }],
      });

      const detail = await service.itemDetail(AS('viewer'), run.id, item.id);
      expect(detail.case_steps).toEqual([
        { position: 1, text: 'Open checkout', expected_result: 'Cart shown' },
      ]);
      expect(detail).toHaveProperty('case_preconditions');
    });

    it('404s an item that belongs to another run or is unknown', async () => {
      const runA = store.addRun({});
      const runB = store.addRun({});
      const item = store.addItem(runA.id, {});
      await expectCode(service.itemDetail(AS('admin'), runB.id, item.id), 'NOT_FOUND');
      await expectCode(service.itemDetail(AS('admin'), runA.id, 'nope'), 'NOT_FOUND');
    });
  });

  describe('addItems', () => {
    it('adds new live cases, skips already-present and unknown ones', async () => {
      const run = store.addRun({});
      const present = store.addCase({ caseNumber: 1 });
      const fresh = store.addCase({ caseNumber: 2 });
      store.addCase({ caseNumber: 3, deleted: true });
      store.addItem(run.id, { caseId: present.id });

      const result = await service.addItems(AS('lead'), run.id, {
        case_ids: [present.id, fresh.id, 'c-unknown', 'c-deleted'],
      });

      expect(result.added).toBe(1);
      expect(result.skipped).toBe(3);
      expect(result.item_ids).toHaveLength(1);
      expect(store.items.filter((item) => item.run_id === run.id)).toHaveLength(2);
    });

    it('400s when the 2,000-item cap would be exceeded', async () => {
      const run = store.addRun({});
      for (let index = 0; index < 2_000; index += 1) {
        store.items.push({
          id: `bulk-${index}`,
          run_id: run.id,
          case_id: `c-bulk-${index}`,
          case_display_id: `C${index + 1}`,
          case_title: 'Case',
          case_priority: 'low',
          case_suite_id: 's-root',
          assignee_id: null,
          position: index + 1,
          created_at: new Date(),
          updated_at: new Date(),
          case_steps: [],
        });
      }
      const extra = store.addCase({ caseNumber: 9_999 });

      await expectCode(
        service.addItems(AS('admin'), run.id, { case_ids: [extra.id] }),
        'VALIDATION_ERROR',
      );
    });

    it('409s adding to a completed run and 404s an unknown run', async () => {
      const run = store.addRun({ completedAt: new Date() });
      const c = store.addCase({});
      await expectCode(
        service.addItems(AS('admin'), run.id, { case_ids: [c.id] }),
        'CONFLICT',
      );
      await expectCode(
        service.addItems(AS('admin'), 'nope', { case_ids: [c.id] }),
        'NOT_FOUND',
      );
    });
  });

  describe('updateItem', () => {
    it('assigns an active admin/lead/tester and rejects other assignees', async () => {
      const run = store.addRun({});
      const item = store.addItem(run.id, {});

      const assigned = await service.updateItem(AS('lead'), run.id, item.id, {
        assignee_id: 'u-tester',
      });
      expect(assigned.assignee_id).toBe('u-tester');

      for (const bad of ['u-viewer', 'u-inactive', 'u-missing']) {
        await expectCode(
          service.updateItem(AS('lead'), run.id, item.id, { assignee_id: bad }),
          'VALIDATION_ERROR',
        );
      }
    });

    it('clears the assignee with an explicit null', async () => {
      const run = store.addRun({});
      const item = store.addItem(run.id, { assigneeId: 'u-tester' });
      const cleared = await service.updateItem(AS('lead'), run.id, item.id, {
        assignee_id: null,
      });
      expect(cleared.assignee_id).toBeNull();
    });

    it('reorders an item densely and 400s an out-of-range position', async () => {
      const run = store.addRun({});
      const a = store.addItem(run.id, { position: 1, caseDisplayId: 'C1' });
      store.addItem(run.id, { position: 2, caseDisplayId: 'C2' });
      store.addItem(run.id, { position: 3, caseDisplayId: 'C3' });

      await service.updateItem(AS('lead'), run.id, a.id, { position: 3 });
      const ordered = await service.listItems(AS('lead'), run.id, {});
      expect(ordered.data.map((row) => row.case_display_id)).toEqual(['C2', 'C3', 'C1']);

      await expectCode(
        service.updateItem(AS('lead'), run.id, a.id, { position: 9 }),
        'VALIDATION_ERROR',
      );
    });

    it('400s an empty item patch and 409s a completed run', async () => {
      const run = store.addRun({});
      const item = store.addItem(run.id, {});
      await expectCode(service.updateItem(AS('admin'), run.id, item.id, {}), 'VALIDATION_ERROR');

      const closed = store.addRun({ completedAt: new Date() });
      const closedItem = store.addItem(closed.id, {});
      await expectCode(
        service.updateItem(AS('admin'), closed.id, closedItem.id, { assignee_id: null }),
        'CONFLICT',
      );
    });
  });

  describe('assign', () => {
    it('assigns every item when item_ids is omitted and a subset when supplied', async () => {
      const run = store.addRun({});
      store.addItem(run.id, {});
      const b = store.addItem(run.id, {});

      const all = await service.assign(AS('lead'), run.id, { assignee_id: 'u-tester' });
      expect(all.assigned).toBe(2);

      const subset = await service.assign(AS('lead'), run.id, {
        assignee_id: 'u-lead',
        item_ids: [b.id, b.id],
      });
      expect(subset.assigned).toBe(1);
    });

    it('unassigns with null, 400s a missing assignee_id and foreign item ids', async () => {
      const run = store.addRun({});
      const item = store.addItem(run.id, { assigneeId: 'u-tester' });

      const cleared = await service.assign(AS('admin'), run.id, { assignee_id: null });
      expect(cleared.assigned).toBe(1);
      expect(store.itemById(item.id).assignee_id).toBeNull();

      await expectCode(service.assign(AS('admin'), run.id, {} as never), 'VALIDATION_ERROR');
      await expectCode(
        service.assign(AS('admin'), run.id, { assignee_id: 'u-lead', item_ids: ['nope'] }),
        'VALIDATION_ERROR',
      );
    });
  });

  describe('removeItem', () => {
    it('removes an item with no results', async () => {
      const run = store.addRun({});
      const item = store.addItem(run.id, {});
      await service.removeItem(AS('lead'), run.id, item.id);
      expect(store.items).toHaveLength(0);
    });

    it('409s an item that already has a result, keeping the evidence', async () => {
      const run = store.addRun({});
      const item = store.addItem(run.id, {});
      store.addResult(item.id, { status: 'passed' });

      await expectCode(service.removeItem(AS('lead'), run.id, item.id), 'CONFLICT');
      expect(store.items).toHaveLength(1);
    });

    it('404s an unknown run or item', async () => {
      const run = store.addRun({});
      await expectCode(service.removeItem(AS('admin'), run.id, 'nope'), 'NOT_FOUND');
      await expectCode(service.removeItem(AS('admin'), 'nope', 'nope'), 'NOT_FOUND');
    });
  });
});