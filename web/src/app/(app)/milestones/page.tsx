"use client";

/**
 * Milestones — the project-scoped "what is coming up" list
 * (docs/DESIGN.md §4.5, docs/backlog-slice4-milestones.md card 3.1).
 *
 * One pane: toolbar (search + All/Open/Completed filter + New milestone), the
 * milestones DataTable and pagination. A milestone's status and `% complete`
 * are derived by the API from its runs, so this screen never writes either; the
 * only state it changes is the milestone's own fields.
 *
 * URL-as-state: ?project, ?query, ?status, ?sort and ?page, parsed by
 * @/lib/milestone-url. The default sort is `due_date` so the soonest deadline
 * leads; undated milestones sort last in both directions (server-side).
 *
 * Roles: creating, editing and deleting need Admin or Lead
 * (docs/api-milestones.md role matrix). Archived projects are read-only for
 * everyone, including Admins.
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
  MILESTONE_STATUSES,
  MILESTONE_STATUS_LABELS,
  type Milestone,
  type MilestoneStatus,
  type Project,
} from "@/lib/api-types";
import { api } from "@/lib/endpoints";
import { ApiError } from "@/lib/api-error";
import { isSessionDead } from "@/components/require-auth";
import { useSession } from "@/lib/session";
import { canWriteMilestones } from "@/lib/milestone-permissions";
import {
  DEFAULT_MILESTONE_SORT,
  milestoneSortParam,
  milestoneSortState,
  parseMilestoneListParams,
  patchMilestoneListParams,
  type MilestoneListUrlPatch,
} from "@/lib/milestone-url";
import {
  DataTable,
  DisabledHint,
  TableSkeleton,
  type DataTableSort,
} from "@/components/ui";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  MilestoneFormDialog,
  type MilestoneFormValues,
} from "@/components/milestones/MilestoneFormDialog";
import {
  MILESTONE_TABLE_CLASS,
  milestoneTableColumns,
} from "@/components/milestones/milestoneTable";
import "./milestones.css";

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

type ProjectState =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "ready"; project: Project }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

type MilestonesState =
  | { kind: "loading" }
  | {
      kind: "ready";
      rows: Milestone[];
      meta: { page: number; total: number; total_pages: number } | null;
    }
  | { kind: "error"; message: string };

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message || fallback : fallback;
}

export default function MilestonesPage() {
  const { user } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchKey = searchParams.toString();
  const url = useMemo(
    () => parseMilestoneListParams(new URLSearchParams(searchKey)),
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
        router.replace(`/milestones?${params.toString()}`, { scroll: false });
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
    Boolean(project) &&
    !archived &&
    Boolean(user) &&
    canWriteMilestones(user!.role);

  // ---- milestones ----
  const [milestonesState, setMilestonesState] = useState<MilestonesState>({
    kind: "loading",
  });
  const [milestonesRetry, setMilestonesRetry] = useState(0);

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setMilestonesState({ kind: "loading" });
      try {
        const result = await api.listMilestones(projectId, {
          status: url.status ?? undefined,
          query: url.query || undefined,
          sort: url.sort,
          page: url.page,
          limit: PAGE_SIZE,
        });
        if (!active) return;
        setMilestonesState({
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
        setMilestonesState({
          kind: "error",
          message: errorMessage(
            err,
            "Couldn't load milestones. Check your connection and retry."
          ),
        });
      }
    })();
    return () => {
      active = false;
    };
  }, [
    projectId,
    url.status,
    url.query,
    url.sort,
    url.page,
    milestonesRetry,
  ]);

  const rows = milestonesState.kind === "ready" ? milestonesState.rows : [];
  const meta = milestonesState.kind === "ready" ? milestonesState.meta : null;

  const pushParams = useCallback(
    (patch: MilestoneListUrlPatch) => {
      const params = patchMilestoneListParams(
        new URLSearchParams(searchKey),
        patch
      );
      if (projectId && !params.get("project")) params.set("project", projectId);
      const qs = params.toString();
      router.replace(qs ? `/milestones?${qs}` : "/milestones", {
        scroll: false,
      });
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
  function onSearchChange(value: string) {
    setQueryInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      pushParams({ query: value.trim(), page: 1 });
    }, SEARCH_DEBOUNCE_MS);
  }

  // ---- create / edit dialog ----
  type DialogState =
    | { mode: "create" }
    | { mode: "edit"; milestone: Milestone }
    | null;
  const [dialog, setDialog] = useState<DialogState>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveFieldErrors, setSaveFieldErrors] = useState<{
    name?: string;
    description?: string;
    due_date?: string;
  }>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  function openCreate(): void {
    setSaveFieldErrors({});
    setSaveError(null);
    setDialog({ mode: "create" });
  }

  function openEdit(milestone: Milestone): void {
    setSaveFieldErrors({});
    setSaveError(null);
    setDialog({ mode: "edit", milestone });
  }

  async function submitDialog(values: MilestoneFormValues): Promise<void> {
    if (!projectId || !dialog) return;
    setSaveBusy(true);
    setSaveFieldErrors({});
    setSaveError(null);
    // Always sends all three fields: an emptied input clears the value on the
    // server (`null`) rather than leaving it unchanged.
    const input = {
      name: values.name,
      description: values.description || null,
      due_date: values.dueDate || null,
    };
    try {
      if (dialog.mode === "create") {
        await api.createMilestone(projectId, input);
      } else {
        await api.updateMilestone(dialog.milestone.id, input);
      }
      setDialog(null);
      setMilestonesRetry((n) => n + 1);
    } catch (err) {
      if (isSessionDead(err)) {
        setDialog(null);
        return;
      }
      const fieldErrors: typeof saveFieldErrors = {};
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
      setSaveFieldErrors(fieldErrors);
      setSaveError(
        form ??
          (Object.keys(fieldErrors).length === 0
            ? errorMessage(
                err,
                dialog.mode === "create"
                  ? "Could not create the milestone. Please try again."
                  : "Could not save the milestone. Please try again."
              )
            : null)
      );
    } finally {
      setSaveBusy(false);
    }
  }

  // ---- delete ----
  const [deleting, setDeleting] = useState<Milestone | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await api.deleteMilestone(deleting.id);
      setDeleting(null);
      setMilestonesRetry((n) => n + 1);
    } catch (err) {
      if (isSessionDead(err)) {
        setDeleting(null);
        return;
      }
      setDeleteError(
        errorMessage(err, "Could not delete the milestone. Please try again.")
      );
    } finally {
      setDeleteBusy(false);
    }
  }

  const sortState = milestoneSortState(url.sort);
  const dataSort: DataTableSort = { key: sortState.key, dir: sortState.dir };
  function onSortChange(next: DataTableSort | null): void {
    pushParams({
      sort: next ? milestoneSortParam(next.key, next.dir) : DEFAULT_MILESTONE_SORT,
      page: 1,
    });
  }

  const columns = milestoneTableColumns({
    onOpenMilestone: (milestone) =>
      router.push(`/milestones/${milestone.id}?project=${projectId}`),
    canWrite,
    onEdit: (milestone) => openEdit(milestone),
    onDelete: (milestone) => {
      setDeleteError(null);
      setDeleting(milestone);
    },
    sortable: true,
  });

  // ---- project-level states ----
  if (projectState.kind === "loading") {
    return <MilestonesSkeleton />;
  }

  if (projectState.kind === "none") {
    return (
      <div className="page">
        <h1>Milestones</h1>
        <div className="panel">
          <p>
            <strong>No projects yet.</strong> Create a project to start
            planning milestones.
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
    ? "This project is archived. Milestones are read-only."
    : !canWrite
      ? "Read-only: creating or editing milestones needs the Admin or Lead role."
      : null;

  const hasFilters = Boolean(url.query) || url.status !== null;

  let emptyTitle: ReactNode = `No milestones in ${project?.name ?? "this project"}.`;
  let emptyBody: ReactNode = null;
  let emptyAction: ReactNode = null;
  if (hasFilters) {
    emptyTitle = "No milestones match your filters.";
    emptyBody = "Try a different search or filter, or clear them.";
    emptyAction = (
      <button
        type="button"
        onClick={() => pushParams({ query: "", status: null, page: 1 })}
      >
        Clear filters
      </button>
    );
  } else if (canWrite) {
    emptyBody =
      "A milestone is a dated checkpoint over runs. Create it first, then add its runs.";
    emptyAction = (
      <button type="button" className="primary" onClick={openCreate}>
        New milestone
      </button>
    );
  }

  return (
    <div className="page milestones-page">
      <div className="milestones-heading">
        <h1>Milestones</h1>
        {readOnlyReason && (
          <p className="milestones-readonly">{readOnlyReason}</p>
        )}
      </div>

      <div className="toolbar">
        <div className="field">
          <label htmlFor="milestone-search">Search by name</label>
          <input
            id="milestone-search"
            type="search"
            placeholder="Search milestones"
            value={queryInput}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="milestone-status-filter">Status</label>
          <select
            id="milestone-status-filter"
            value={url.status ?? ""}
            onChange={(event) =>
              pushParams({
                status: (event.target.value || null) as MilestoneStatus | null,
                page: 1,
              })
            }
          >
            <option value="">All</option>
            {MILESTONE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {MILESTONE_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>
        {canWrite && (
          <DisabledHint hint="Create a milestone and add its runs next">
            <button type="button" className="primary" onClick={openCreate}>
              New milestone
            </button>
          </DisabledHint>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        className={MILESTONE_TABLE_CLASS}
        caption={`Milestones in ${project?.name ?? "project"}`}
        ariaLabel="Milestones"
        loading={milestonesState.kind === "loading"}
        error={
          milestonesState.kind === "error" ? milestonesState.message : null
        }
        onRetry={() => setMilestonesRetry((n) => n + 1)}
        emptyTitle={emptyTitle}
        emptyBody={emptyBody}
        emptyAction={emptyAction}
        sort={dataSort}
        onSortChange={onSortChange}
        rowHeight="default"
      />

      {meta && meta.total_pages > 1 && (
        <nav className="pagination" aria-label="Milestone list pages">
          <DisabledHint
            hint={
              url.page <= 1
                ? "You are on the first page"
                : "Go to the previous page"
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
            Page {meta.page} of {meta.total_pages} ({meta.total} milestones)
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

      {dialog && (
        <MilestoneFormDialog
          mode={dialog.mode}
          initial={dialog.mode === "edit" ? dialog.milestone : null}
          busy={saveBusy}
          serverFieldErrors={saveFieldErrors}
          formError={saveError}
          onSubmit={(values) => void submitDialog(values)}
          onCancel={() => setDialog(null)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete “${deleting.name}”?`}
          body={
            <>
              <p>
                {deleting.run_count === 0
                  ? "This milestone has no runs."
                  : `Its ${deleting.run_count} run${
                      deleting.run_count === 1 ? "" : "s"
                    } will be kept, without a milestone.`}
              </p>
              <p>No run, result or attachment is deleted.</p>
              {deleteError && (
                <p className="form-error" role="alert">
                  {deleteError}
                </p>
              )}
            </>
          }
          confirmLabel="Delete milestone"
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

function MilestonesSkeleton() {
  return (
    <div className="page milestones-page" aria-busy="true">
      <div className="milestones-heading">
        <h1>Milestones</h1>
      </div>
      <TableSkeleton rows={6} columns={7} label="Loading milestones" />
    </div>
  );
}