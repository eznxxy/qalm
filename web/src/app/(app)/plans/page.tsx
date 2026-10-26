"use client";

/**
 * Test plans — the project-scoped plans list (docs/DESIGN.md §4.3, backlog card
 * 3.3, contract docs/api-plans.md). One pane: toolbar (search + New plan), the
 * plans DataTable and pagination.
 *
 * URL-as-state: ?project, ?query, ?sort and ?page. There is no status filter —
 * a plan is a container, so its column set is a rollup over its runs (`counts`,
 * `run_count`) rather than a state of its own.
 *
 * Roles: create/edit/delete needs Admin or Lead (docs/api-plans.md role
 * matrix). Archived projects are read-only for everyone, including Admins.
 *
 * Delete is the one destructive action here, and the contract promises the runs
 * survive (PRD decision 7). The confirm dialog says so explicitly rather than
 * leaving the user to discover it.
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
import type { Plan, Project } from "@/lib/api-types";
import { api } from "@/lib/endpoints";
import { ApiError } from "@/lib/api-error";
import { isSessionDead } from "@/components/require-auth";
import { useSession } from "@/lib/session";
import { canWritePlans } from "@/lib/plan-permissions";
import {
  DEFAULT_PLAN_SORT,
  parsePlanListParams,
  patchPlanListParams,
  planSortParam,
  planSortState,
  type PlanListUrlPatch,
} from "@/lib/plan-url";
import { formatDateOnly } from "@/lib/dates";
import {
  DataTable,
  DisabledHint,
  StatusBar,
  TableSkeleton,
  type DataTableColumn,
  type DataTableSort,
} from "@/components/ui";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  PlanFormDialog,
  type PlanFormValues,
} from "@/components/plans/PlanFormDialog";
import "./plans.css";

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

type ProjectState =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "ready"; project: Project }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

type PlansState =
  | { kind: "loading" }
  | {
      kind: "ready";
      rows: Plan[];
      meta: { page: number; total: number; total_pages: number } | null;
    }
  | { kind: "error"; message: string };

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message || fallback : fallback;
}

export default function PlansPage() {
  const { user } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchKey = searchParams.toString();
  const url = useMemo(
    () => parsePlanListParams(new URLSearchParams(searchKey)),
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
        router.replace(`/plans?${params.toString()}`, { scroll: false });
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
    Boolean(project) && !archived && Boolean(user) && canWritePlans(user!.role);

  // ---- plans ----
  const [plansState, setPlansState] = useState<PlansState>({ kind: "loading" });
  const [plansRetry, setPlansRetry] = useState(0);

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setPlansState({ kind: "loading" });
      try {
        const result = await api.listPlans(projectId, {
          query: url.query || undefined,
          sort: url.sort,
          page: url.page,
          limit: PAGE_SIZE,
        });
        if (!active) return;
        setPlansState({
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
        setPlansState({
          kind: "error",
          message: errorMessage(
            err,
            "Couldn't load plans. Check your connection and retry."
          ),
        });
      }
    })();
    return () => {
      active = false;
    };
  }, [projectId, url.query, url.sort, url.page, plansRetry]);

  const rows = plansState.kind === "ready" ? plansState.rows : [];
  const meta = plansState.kind === "ready" ? plansState.meta : null;

  const pushParams = useCallback(
    (patch: PlanListUrlPatch) => {
      const params = patchPlanListParams(new URLSearchParams(searchKey), patch);
      if (projectId && !params.get("project")) params.set("project", projectId);
      const qs = params.toString();
      router.replace(qs ? `/plans?${qs}` : "/plans", { scroll: false });
    },
    [searchKey, router, projectId]
  );

  // ---- search input (mirrors the runs screen) ----
  const [queryInput, setQueryInput] = useState(url.query);
  const [renderedQuery, setRenderedQuery] = useState(url.query);
  if (renderedQuery !== url.query) {
    setRenderedQuery(url.query);
    setQueryInput(url.query);
  }
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onSearchChange(value: string): void {
    setQueryInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      pushParams({ query: value.trim(), page: 1 });
    }, SEARCH_DEBOUNCE_MS);
  }

  // ---- create / edit dialog ----
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [formBusy, setFormBusy] = useState(false);
  const [formFieldErrors, setFormFieldErrors] = useState<{
    name?: string;
    description?: string;
    due_date?: string;
  }>({});
  const [formError, setFormError] = useState<string | null>(null);

  function openCreate(): void {
    setEditing(null);
    setFormMode("create");
    setFormFieldErrors({});
    setFormError(null);
  }

  function openEdit(plan: Plan): void {
    setEditing(plan);
    setFormMode("edit");
    setFormFieldErrors({});
    setFormError(null);
  }

  function closeForm(): void {
    setFormMode(null);
    setEditing(null);
  }

  async function submitPlan(values: PlanFormValues): Promise<void> {
    if (!projectId || !formMode) return;
    setFormBusy(true);
    setFormFieldErrors({});
    setFormError(null);
    // Always sends all three fields: on edit, an emptied input clears the value
    // (`null`) rather than leaving it unchanged.
    const payload = {
      name: values.name,
      description: values.description || null,
      due_date: values.dueDate || null,
    };
    try {
      if (formMode === "edit" && editing) {
        await api.updatePlan(editing.id, payload);
      } else {
        await api.createPlan(projectId, payload);
      }
      closeForm();
      setPlansRetry((n) => n + 1);
    } catch (err) {
      if (isSessionDead(err)) {
        closeForm();
        return;
      }
      const fieldErrors: typeof formFieldErrors = {};
      let form: string | null = null;
      for (const detail of err instanceof ApiError ? (err.details ?? []) : []) {
        if (
          detail.field === "name" ||
          detail.field === "description" ||
          detail.field === "due_date"
        ) {
          fieldErrors[detail.field] = detail.issue;
        } else {
          form = detail.issue;
        }
      }
      setFormFieldErrors(fieldErrors);
      setFormError(
        form ??
          (Object.keys(fieldErrors).length === 0
            ? errorMessage(
                err,
                `Could not ${formMode === "edit" ? "save" : "create"} the plan. Please try again.`
              )
            : null)
      );
    } finally {
      setFormBusy(false);
    }
  }

  // ---- delete dialog ----
  const [deleting, setDeleting] = useState<Plan | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await api.deletePlan(deleting.id);
      const wasLastRowOnPage = rows.length === 1 && url.page > 1;
      setDeleting(null);
      if (wasLastRowOnPage) pushParams({ page: url.page - 1 });
      else setPlansRetry((n) => n + 1);
    } catch (err) {
      if (isSessionDead(err)) {
        setDeleting(null);
        return;
      }
      setDeleteError(
        errorMessage(err, "Could not delete the plan. Please try again.")
      );
    } finally {
      setDeleteBusy(false);
    }
  }

  const sortState = planSortState(url.sort);
  const dataSort: DataTableSort = { key: sortState.key, dir: sortState.dir };
  function onSortChange(next: DataTableSort | null): void {
    pushParams({
      sort: next ? planSortParam(next.key, next.dir) : DEFAULT_PLAN_SORT,
      page: 1,
    });
  }

  const columns: DataTableColumn<Plan>[] = [
    {
      key: "name",
      header: "Name",
      sortable: true,
      sortValue: (row) => row.name,
      render: (row) => (
        <button
          type="button"
          className="plan-title-link"
          aria-label={`Open plan ${row.name}`}
          onClick={() => router.push(`/plans/${row.id}?project=${projectId}`)}
        >
          {row.name}
        </button>
      ),
    },
    {
      key: "run_count",
      header: "Runs",
      align: "number",
      className: "plan-col-runs",
      render: (row) => row.run_count,
    },
    {
      key: "status_bar",
      header: "Status",
      className: "plan-col-status",
      render: (row) =>
        row.counts.total > 0 ? (
          <StatusBar counts={row.counts} label={row.name} />
        ) : (
          <span className="muted">No runs</span>
        ),
    },
    {
      key: "percent_complete",
      header: "% complete",
      align: "number",
      className: "plan-col-percent",
      render: (row) => `${row.counts.percent_complete}%`,
    },
    {
      key: "due_date",
      header: "Due date",
      sortable: true,
      className: "plan-col-due",
      sortValue: (row) => row.due_date,
      render: (row) =>
        row.due_date ? (
          <time dateTime={row.due_date}>{formatDateOnly(row.due_date)}</time>
        ) : (
          <span className="muted">—</span>
        ),
    },
  ];

  if (canWrite) {
    columns.push({
      key: "actions",
      header: "Actions",
      className: "plan-col-actions",
      render: (row) => (
        <span className="plan-row-actions">
          <button
            type="button"
            aria-label={`Edit plan ${row.name}`}
            onClick={() => openEdit(row)}
          >
            Edit
          </button>
          <button
            type="button"
            aria-label={`Delete plan ${row.name}`}
            onClick={() => {
              setDeleteError(null);
              setDeleting(row);
            }}
          >
            Delete
          </button>
        </span>
      ),
    });
  }

  // ---- project-level states ----
  if (projectState.kind === "loading") {
    return <PlansSkeleton />;
  }

  if (projectState.kind === "none") {
    return (
      <div className="page">
        <h1>Test plans</h1>
        <div className="panel">
          <p>
            <strong>No projects yet.</strong> Create a project to start planning
            test runs.
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
    ? "This project is archived. Test plans are read-only."
    : !canWrite
      ? "Read-only: creating or editing plans needs the Admin or Lead role."
      : null;

  const hasFilters = Boolean(url.query);

  let emptyTitle: ReactNode = `No plans in ${project?.name ?? "this project"} yet.`;
  let emptyBody: ReactNode = null;
  let emptyAction: ReactNode = null;
  if (hasFilters) {
    emptyTitle = "No plans match your search.";
    emptyBody = "Try a different name, or clear the search.";
    emptyAction = (
      <button type="button" onClick={() => pushParams({ query: "", page: 1 })}>
        Clear search
      </button>
    );
  } else if (canWrite) {
    emptyBody =
      "A plan groups runs for a release or a milestone, with one rollup over all of them.";
    emptyAction = (
      <button type="button" className="primary" onClick={openCreate}>
        New plan
      </button>
    );
  }

  return (
    <div className="page plans-page">
      <div className="plans-heading">
        <h1>Test plans</h1>
        <p className="plans-subtitle">{project?.name ?? "Project"}</p>
        {readOnlyReason && <p className="plans-readonly">{readOnlyReason}</p>}
      </div>

      <div className="toolbar">
        <div className="field">
          <label htmlFor="plan-search">Search by name</label>
          <input
            id="plan-search"
            type="search"
            placeholder="Search plans"
            value={queryInput}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
        {canWrite && (
          <DisabledHint hint="Group runs for a release or a milestone">
            <button type="button" className="primary" onClick={openCreate}>
              New plan
            </button>
          </DisabledHint>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        caption={`Test plans in ${project?.name ?? "project"}`}
        ariaLabel="Test plans"
        loading={plansState.kind === "loading"}
        error={plansState.kind === "error" ? plansState.message : null}
        onRetry={() => setPlansRetry((n) => n + 1)}
        emptyTitle={emptyTitle}
        emptyBody={emptyBody}
        emptyAction={emptyAction}
        sort={dataSort}
        onSortChange={onSortChange}
        rowHeight="default"
      />

      {meta && meta.total_pages > 1 && (
        <nav className="pagination" aria-label="Plan list pages">
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
            Page {meta.page} of {meta.total_pages} ({meta.total} plans)
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

      {formMode && (
        <PlanFormDialog
          mode={formMode}
          initial={formMode === "edit" ? editing : null}
          busy={formBusy}
          serverFieldErrors={formFieldErrors}
          formError={formError}
          onSubmit={(values) => void submitPlan(values)}
          onCancel={closeForm}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete “${deleting.name}”?`}
          body={
            <>
              <p>
                Its runs are kept: they stay in the project and simply stop being
                part of this plan.
              </p>
              {deleteError && (
                <p className="form-error" role="alert">
                  {deleteError}
                </p>
              )}
            </>
          }
          confirmLabel="Delete plan"
          danger
          busy={deleteBusy}
          onConfirm={() => void confirmDelete()}
          onCancel={() => {
            setDeleteError(null);
            setDeleting(null);
          }}
        />
      )}
    </div>
  );
}

function PlansSkeleton() {
  return (
    <div className="page plans-page" aria-busy="true">
      <div className="plans-heading">
        <h1>Test plans</h1>
        <p className="plans-subtitle">Loading project…</p>
      </div>
      <TableSkeleton rows={6} columns={5} label="Loading test plans" />
    </div>
  );
}