"use client";

/**
 * Test runs — the project-scoped runs list (docs/DESIGN.md §4.3, backlog cards
 * 3.1 and 3.6). One pane: toolbar (search + Open/Completed filter + New plan +
 * New run), the runs DataTable, and pagination.
 *
 * Plans are created here, not on a separate screen: a plan has no use without
 * runs, so New plan opens one dialog that collects the plan and at least one
 * run and posts them together (docs/api-plans.md § POST /plans). The plan's own
 * detail route /plans/[id] still exists for its rollup, and its list endpoint
 * is still read here for the Plan column and the New run dialog's plan picker.
 *
 * URL-as-state: ?project, ?query, ?status, ?sort and ?page. Reading
 * useSearchParams here is safe because the (app) layout's AppShell suspends
 * inside its own boundary.
 *
 * Roles: creating/editing runs or plans needs Admin or Lead (docs/api-runs.md,
 * docs/api-plans.md role matrices). Archived projects are read-only for
 * everyone, including Admins.
 *
 * The table's columns live in @/components/runs/runTable, shared with a plan's
 * Runs section. The `planId → name` map the Plan column needs is still built
 * here (best effort, from `GET /plans`; a missing name falls back to "—").
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  RUN_STATUSES,
  RUN_STATUS_LABELS,
  type Plan,
  type Project,
  type Run,
  type RunSelection,
  type RunStatus,
  type SuiteNode,
} from "@/lib/api-types";
import { api } from "@/lib/endpoints";
import { ApiError } from "@/lib/api-error";
import { isSessionDead } from "@/components/require-auth";
import { useSession } from "@/lib/session";
import { canWriteRuns } from "@/lib/run-permissions";
import { canWritePlans } from "@/lib/plan-permissions";
import {
  DEFAULT_RUN_SORT,
  parseRunListParams,
  patchRunListParams,
  runSortParam,
  runSortState,
  type RunListUrlPatch,
} from "@/lib/run-url";
import {
  DataTable,
  DisabledHint,
  TableSkeleton,
  type DataTableSort,
} from "@/components/ui";
import { RunFormDialog, type RunFormValues } from "@/components/runs/RunFormDialog";
import {
  PlanWithRunsDialog,
  type PlanWithRunsValues,
} from "@/components/plans/PlanWithRunsDialog";
import {
  RUN_TABLE_CLASS,
  runTableColumns,
} from "@/components/runs/runTable";
import "./runs.css";

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

/**
 * `error.details[].field` values the New plan dialog can show inline. The API
 * flattens nested validation as `runs[i].<field>` (docs/api-plans.md §
 * Validation), so anything else — a conflict without a field, say — goes to the
 * dialog's form-level error instead.
 */
const PLAN_FIELD_PATTERN =
  /^(name|description|due_date|runs|run_ids|runs\[\d+\]\.(name|description|start_date|due_date)|run_ids\[\d+\])$/;

type ProjectState =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "ready"; project: Project }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

type RunsState =
  | { kind: "loading" }
  | {
      kind: "ready";
      rows: Run[];
      meta: { page: number; total: number; total_pages: number } | null;
    }
  | { kind: "error"; message: string };

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message || fallback : fallback;
}

export default function RunsPage() {
  const { user } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchKey = searchParams.toString();
  const url = useMemo(
    () => parseRunListParams(new URLSearchParams(searchKey)),
    [searchKey]
  );
  const urlProject = searchParams.get("project");

  // ---- project ----
  const [projectState, setProjectState] = useState<ProjectState>({
    kind: "loading",
  });
  const [projectRetry, setProjectRetry] = useState(0);

  useEffect(() => {
    if (!urlProject) return;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setProjectState({ kind: "loading" });
      try {
        const project = await api.getProject(urlProject);
        if (active) setProjectState({ kind: "ready", project });
      } catch (err) {
        if (!active || isSessionDead(err)) return;
        if (err instanceof ApiError && err.status === 404) {
          setProjectState({ kind: "not-found" });
        } else {
          setProjectState({
            kind: "error",
            message: errorMessage(
              err,
              "Couldn't load the project. Check your connection and retry."
            ),
          });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [urlProject, projectRetry]);

  // No ?project= (direct link): resolve the first visible project and put it in
  // the URL so the shell's project-scoped nav agrees with this screen.
  useEffect(() => {
    if (urlProject) return;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setProjectState({ kind: "loading" });
      try {
        const result = await api.listProjects({ page: 1, limit: 1 });
        if (!active) return;
        const first = result.data[0];
        if (!first) {
          setProjectState({ kind: "none" });
          return;
        }
        setProjectState({ kind: "ready", project: first });
        const params = new URLSearchParams(searchKey);
        params.set("project", first.id);
        router.replace(`/runs?${params.toString()}`, { scroll: false });
      } catch (err) {
        if (!active || isSessionDead(err)) return;
        setProjectState({
          kind: "error",
          message: errorMessage(
            err,
            "Couldn't load projects. Check your connection and retry."
          ),
        });
      }
    })();
    return () => {
      active = false;
    };
  }, [urlProject, projectRetry, searchKey, router]);

  const project = projectState.kind === "ready" ? projectState.project : null;
  const projectId = project?.id ?? "";
  const archived = project?.status === "archived";
  const canWrite =
    Boolean(project) && !archived && Boolean(user) && canWriteRuns(user!.role);
  // Same Admin/Lead gate as runs today, but read from the plans helper so this
  // button follows the plans role matrix if the two ever diverge.
  const canWritePlan =
    Boolean(project) && !archived && Boolean(user) && canWritePlans(user!.role);

  // ---- plans (plan column + the New run dialog's plan select) ----
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansRetry, setPlansRetry] = useState(0);
  useEffect(() => {
    if (!projectId) return;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      try {
        const result = await api.listPlans(projectId, { limit: 100 });
        if (active) setPlans(result.data);
      } catch (err) {
        // Non-essential: the list falls back to "—" and the dialog hides the
        // plan select. A session death is already handled by RequireAuth.
        if (isSessionDead(err)) return;
        if (active) setPlans([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [projectId, plansRetry]);

  // ---- suites (the New run dialog's suite picker) ----
  const [suites, setSuites] = useState<SuiteNode[]>([]);
  useEffect(() => {
    if (!projectId) return;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      try {
        const tree = await api.listSuites(projectId);
        if (active) setSuites(tree);
      } catch (err) {
        if (isSessionDead(err)) return;
        if (active) setSuites([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [projectId]);

  const planNames = useMemo(
    () => new Map(plans.map((plan) => [plan.id, plan.name])),
    [plans]
  );

  // ---- runs ----
  const [runsState, setRunsState] = useState<RunsState>({ kind: "loading" });
  const [runsRetry, setRunsRetry] = useState(0);

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setRunsState({ kind: "loading" });
      try {
        const result = await api.listRuns(projectId, {
          status: url.status,
          query: url.query || undefined,
          sort: url.sort,
          page: url.page,
          limit: PAGE_SIZE,
        });
        if (!active) return;
        setRunsState({
          kind: "ready",
          rows: result.data,
          meta: result.meta
            ? {
                page: result.meta.page,
                total: result.meta.total,
                total_pages: result.meta.total_pages,
              }
            : null,
        });
      } catch (err) {
        if (!active || isSessionDead(err)) return;
        setRunsState({
          kind: "error",
          message: errorMessage(
            err,
            "Couldn't load runs. Check your connection and retry."
          ),
        });
      }
    })();
    return () => {
      active = false;
    };
  }, [projectId, url.status, url.query, url.sort, url.page, runsRetry]);

  const rows = runsState.kind === "ready" ? runsState.rows : [];
  const meta = runsState.kind === "ready" ? runsState.meta : null;

  const pushParams = useCallback(
    (patch: RunListUrlPatch) => {
      const params = patchRunListParams(new URLSearchParams(searchKey), patch);
      if (projectId && !params.get("project")) params.set("project", projectId);
      const qs = params.toString();
      router.replace(qs ? `/runs?${qs}` : "/runs", { scroll: false });
    },
    [searchKey, router, projectId]
  );

  // ---- search input (mirrors the projects screen) ----
  const [queryInput, setQueryInput] = useState(url.query);
  const [renderedQuery, setRenderedQuery] = useState(url.query);
  if (renderedQuery !== url.query) {
    setRenderedQuery(url.query);
    setQueryInput(url.query);
  }
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onSearchChange(value: string) {
    setQueryInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      pushParams({ query: value.trim(), page: 1 });
    }, SEARCH_DEBOUNCE_MS);
  }

  // ---- create dialog ----
  const [creating, setCreating] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createFieldErrors, setCreateFieldErrors] = useState<{
    name?: string;
    description?: string;
    start_date?: string;
    due_date?: string;
    plan_id?: string;
    selection?: string;
  }>({});
  const [createFormError, setCreateFormError] = useState<string | null>(null);

  async function submitRun(
    values: RunFormValues,
    selection: RunSelection | undefined
  ): Promise<void> {
    if (!projectId) return;
    setCreateBusy(true);
    setCreateFieldErrors({});
    setCreateFormError(null);
    try {
      const created = await api.createRun(projectId, {
        name: values.name,
        ...(values.description ? { description: values.description } : {}),
        ...(values.planId ? { plan_id: values.planId } : {}),
        ...(values.startDate ? { start_date: values.startDate } : {}),
        ...(values.dueDate ? { due_date: values.dueDate } : {}),
        ...(selection ? { selection } : {}),
      });
      setCreating(false);
      // The run detail screen is card 3.2; open the run we just made.
      router.push(`/runs/${created.id}?project=${projectId}`);
    } catch (err) {
      if (isSessionDead(err)) {
        setCreating(false);
        return;
      }
      const fieldErrors: typeof createFieldErrors = {};
      let form: string | null = null;
      for (const detail of err instanceof ApiError ? (err.details ?? []) : []) {
        if (
          detail.field === "name" ||
          detail.field === "description" ||
          detail.field === "start_date" ||
          detail.field === "due_date" ||
          detail.field === "plan_id" ||
          detail.field === "selection"
        ) {
          fieldErrors[detail.field] = detail.issue;
        } else {
          form = detail.issue;
        }
      }
      setCreateFieldErrors(fieldErrors);
      setCreateFormError(
        form ??
          (Object.keys(fieldErrors).length === 0
            ? errorMessage(err, "Could not create the run. Please try again.")
            : null)
      );
    } finally {
      setCreateBusy(false);
    }
  }

  // ---- create plan dialog (the plan and its runs, one request) ----
  const [creatingPlan, setCreatingPlan] = useState(false);
  const [planCreateBusy, setPlanCreateBusy] = useState(false);
  const [planFieldErrors, setPlanFieldErrors] = useState<
    Record<string, string>
  >({});
  const [planFormError, setPlanFormError] = useState<string | null>(null);

  // ---- unplanned runs: the New plan dialog's attach picker (card 3.10) ----
  // Only fetched when the dialog opens, and only `plan_id=none`, so the picker
  // can never offer a run that already belongs to another plan.
  const [unplannedRuns, setUnplannedRuns] = useState<Run[]>([]);
  const [unplannedRunsLoading, setUnplannedRunsLoading] = useState(false);
  const [unplannedRunsError, setUnplannedRunsError] = useState<string | null>(
    null
  );
  const [unplannedRunsRetry, setUnplannedRunsRetry] = useState(0);
  useEffect(() => {
    if (!creatingPlan || !projectId) return;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setUnplannedRunsLoading(true);
      setUnplannedRunsError(null);
      try {
        const result = await api.listRuns(projectId, {
          plan_id: "none",
          limit: 100,
        });
        if (active) setUnplannedRuns(result.data);
      } catch (err) {
        if (!active || isSessionDead(err)) return;
        setUnplannedRuns([]);
        setUnplannedRunsError(
          errorMessage(
            err,
            "Couldn't load the runs to attach. Check your connection and retry."
          )
        );
      } finally {
        if (active) setUnplannedRunsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [creatingPlan, projectId, unplannedRunsRetry]);

  /** Open the dialog; the effect above loads the unplanned runs on demand. */
  function openPlanDialog(): void {
    // Loading starts here, not in the effect's first tick, so the picker never
    // flashes "No unplanned runs" before the request goes out.
    setUnplannedRunsLoading(true);
    setUnplannedRunsError(null);
    setCreatingPlan(true);
  }

  async function submitPlanWithRuns(values: PlanWithRunsValues): Promise<void> {
    if (!projectId) return;
    setPlanCreateBusy(true);
    setPlanFieldErrors({});
    setPlanFormError(null);
    try {
      await api.createPlan(projectId, {
        name: values.name,
        description: values.description || null,
        due_date: values.dueDate || null,
        runs: values.runs.map((run) => ({
          name: run.name,
          ...(run.description ? { description: run.description } : {}),
          ...(run.startDate ? { start_date: run.startDate } : {}),
          ...(run.dueDate ? { due_date: run.dueDate } : {}),
        })),
        ...(values.runIds.length > 0 ? { run_ids: values.runIds } : {}),
      });
      setCreatingPlan(false);
      // The new plan feeds the Plan column and the New run picker; the new runs
      // belong in this list. Stay on the screen: a plan's detail page is a
      // second step, not the point of creating it.
      setPlansRetry((n) => n + 1);
      setRunsRetry((n) => n + 1);
    } catch (err) {
      if (isSessionDead(err)) {
        setCreatingPlan(false);
        return;
      }
      const fieldErrors: Record<string, string> = {};
      let form: string | null = null;
      for (const detail of err instanceof ApiError ? (err.details ?? []) : []) {
        const field = detail.field;
        // A detail without a field (or with an unexpected one) cannot be shown
        // next to an input, so it becomes the dialog's form-level error.
        if (field && PLAN_FIELD_PATTERN.test(field)) {
          fieldErrors[field] = detail.issue;
        } else {
          form = detail.issue;
        }
      }
      setPlanFieldErrors(fieldErrors);
      setPlanFormError(
        form ??
          (Object.keys(fieldErrors).length === 0
            ? errorMessage(err, "Could not create the plan. Please try again.")
            : null)
      );
    } finally {
      setPlanCreateBusy(false);
    }
  }

  const sortState = runSortState(url.sort);
  const dataSort: DataTableSort = { key: sortState.key, dir: sortState.dir };
  function onSortChange(next: DataTableSort | null): void {
    pushParams({
      sort: next ? runSortParam(next.key, next.dir) : DEFAULT_RUN_SORT,
      page: 1,
    });
  }

  const columns = runTableColumns({
    onOpenRun: (run) => router.push(`/runs/${run.id}?project=${projectId}`),
    onOpenPlan: (planId) =>
      router.push(`/plans/${planId}?project=${projectId}`),
    planNames,
    sortable: true,
  });

  // ---- project-level states ----
  if (projectState.kind === "loading") {
    return <RunsSkeleton />;
  }

  if (projectState.kind === "none") {
    return (
      <div className="page">
        <h1>Test runs</h1>
        <div className="panel">
          <p>
            <strong>No projects yet.</strong> Create a project to start
            planning test runs.
          </p>
          <p>
            <Link href="/projects" className="button-link">
              Go to projects
            </Link>
          </p>
        </div>
      </div>
    );
  }

  if (projectState.kind === "not-found") {
    return (
      <div className="page">
        <div className="panel panel-error" role="alert">
          <h1>Project not found</h1>
          <p>
            This project does not exist, or it is archived — archived projects
            are only visible to Admins.
          </p>
          <p>
            <Link href="/projects">Back to projects</Link>
          </p>
        </div>
      </div>
    );
  }

  if (projectState.kind === "error") {
    return (
      <div className="page">
        <div className="panel panel-error" role="alert">
          <h1>Couldn&apos;t load the project</h1>
          <p>{projectState.message}</p>
          <p>
            <button
              type="button"
              onClick={() => setProjectRetry((n) => n + 1)}
            >
              Retry
            </button>
          </p>
        </div>
      </div>
    );
  }

  const readOnlyReason = archived
    ? "This project is archived. Test runs are read-only."
    : !canWrite
      ? "Read-only: creating or editing runs needs the Admin or Lead role."
      : null;

  const hasFilters = Boolean(url.query) || url.status !== "open";

  let emptyTitle: ReactNode = `No ${url.status} runs in ${project?.name ?? "this project"}.`;
  let emptyBody: ReactNode = null;
  let emptyAction: ReactNode = null;
  if (hasFilters) {
    emptyTitle = "No runs match your filters.";
    emptyBody = "Try a different search or filter, or clear them.";
    emptyAction = (
      <button
        type="button"
        onClick={() => pushParams({ query: "", status: "open", page: 1 })}
      >
        Clear filters
      </button>
    );
  } else if (canWrite) {
    emptyBody =
      "Create a run to pick the cases you want to test, or start from a plan and its runs.";
    emptyAction = (
      <div className="runs-empty-actions">
        {canWritePlan && (
          <button type="button" onClick={openPlanDialog}>
            New plan
          </button>
        )}
        <button
          type="button"
          className="primary"
          onClick={() => setCreating(true)}
        >
          New run
        </button>
      </div>
    );
  }

  return (
    <div className="page runs-page">
      <div className="runs-heading">
        <h1>Test runs</h1>
        {readOnlyReason && <p className="runs-readonly">{readOnlyReason}</p>}
      </div>

      <div className="toolbar">
        <div className="field">
          <label htmlFor="run-search">Search by name</label>
          <input
            id="run-search"
            type="search"
            placeholder="Search runs"
            value={queryInput}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="run-status-filter">Status</label>
          <select
            id="run-status-filter"
            value={url.status}
            onChange={(event) =>
              pushParams({ status: event.target.value as RunStatus, page: 1 })
            }
          >
            {RUN_STATUSES.map((status) => (
              <option key={status} value={status}>
                {RUN_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>
        {canWritePlan && (
          <DisabledHint hint="Create a plan together with its runs">
            <button
              type="button"
              onClick={openPlanDialog}
            >
              New plan
            </button>
          </DisabledHint>
        )}
        {canWrite && (
          <DisabledHint hint="Create a run and pick its cases">
            <button
              type="button"
              className="primary"
              onClick={() => setCreating(true)}
            >
              New run
            </button>
          </DisabledHint>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        className={RUN_TABLE_CLASS}
        caption={`Test runs in ${project?.name ?? "project"}`}
        ariaLabel="Test runs"
        loading={runsState.kind === "loading"}
        error={runsState.kind === "error" ? runsState.message : null}
        onRetry={() => setRunsRetry((n) => n + 1)}
        emptyTitle={emptyTitle}
        emptyBody={emptyBody}
        emptyAction={emptyAction}
        sort={dataSort}
        onSortChange={onSortChange}
        rowHeight="default"
      />

      {meta && meta.total_pages > 1 && (
        <nav className="pagination" aria-label="Run list pages">
          <DisabledHint
            hint={
              url.page <= 1 ? "You are on the first page" : "Go to the previous page"
            }
          >
            <button
              type="button"
              disabled={url.page <= 1}
              onClick={() => pushParams({ page: Math.max(1, url.page - 1) })}
            >
              Previous
            </button>
          </DisabledHint>
          <span>
            Page {meta.page} of {meta.total_pages} ({meta.total} runs)
          </span>
          <DisabledHint
            hint={
              url.page >= meta.total_pages
                ? "You are on the last page"
                : "Go to the next page"
            }
          >
            <button
              type="button"
              disabled={url.page >= meta.total_pages}
              onClick={() => pushParams({ page: url.page + 1 })}
            >
              Next
            </button>
          </DisabledHint>
        </nav>
      )}

      {creating && (
        <RunFormDialog
          projectId={projectId}
          suites={suites}
          plans={plans}
          busy={createBusy}
          serverFieldErrors={createFieldErrors}
          formError={createFormError}
          onSubmit={(values, selection) => void submitRun(values, selection)}
          onCancel={() => setCreating(false)}
        />
      )}

      {creatingPlan && (
        <PlanWithRunsDialog
          busy={planCreateBusy}
          unplannedRuns={unplannedRuns}
          unplannedRunsLoading={unplannedRunsLoading}
          unplannedRunsError={unplannedRunsError}
          onRetryUnplannedRuns={() =>
            setUnplannedRunsRetry((count) => count + 1)
          }
          serverFieldErrors={planFieldErrors}
          formError={planFormError}
          onSubmit={(values) => void submitPlanWithRuns(values)}
          onCancel={() => setCreatingPlan(false)}
        />
      )}
    </div>
  );
}

function RunsSkeleton() {
  return (
    <div className="page runs-page" aria-busy="true">
      <div className="runs-heading">
        <h1>Test runs</h1>
      </div>
      <TableSkeleton rows={6} columns={7} label="Loading test runs" />
    </div>
  );
}