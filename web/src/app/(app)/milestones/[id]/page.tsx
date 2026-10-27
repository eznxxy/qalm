"use client";

/**
 * Milestone detail (docs/DESIGN.md §4.5, docs/backlog-slice4-milestones.md card
 * 3.1). A milestone is a project-scoped, dated checkpoint over runs, so this
 * screen is the milestone's own fields plus a derived rollup and the runs it
 * tracks.
 *
 * The rollup is read, never written: `counts`, `run_count` and `status` come
 * from the API (docs/api-milestones.md § Resource: Milestone) and change only
 * when runs are attached, detached or completed. There is no Close action —
 * completion is derived. Days left is the one number the web owns: it comes
 * from `due_date` through @/lib/dates, so a plain calendar date never shifts.
 *
 * The Runs table is the runs list's table with the Plan column kept and the
 * Milestone column dropped (every row would repeat the page title). It also
 * adds the per-row "Remove from milestone" action. Columns come from
 * @/components/runs/runTable, so a column added on the runs screen cannot leave
 * this copy behind.
 *
 * Runs are fetched from the runs list with `milestone_id=<id>` as the contract
 * prescribes (runs are not embedded). Add runs fetches `milestone_id=none`, so
 * it can never offer a run that belongs to another milestone.
 *
 * Roles: edit, delete, add runs and remove from milestone need Admin or Lead;
 * archived projects are read-only for everyone. The milestone resource carries
 * no project status, hence the extra `GET /projects/:id`.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  MILESTONE_STATUS_LABELS,
  type Milestone,
  type Plan,
  type Project,
  type Run,
} from "@/lib/api-types";
import { api } from "@/lib/endpoints";
import { ApiError } from "@/lib/api-error";
import { isSessionDead } from "@/components/require-auth";
import { useSession } from "@/lib/session";
import { canWriteMilestones } from "@/lib/milestone-permissions";
import { formatDateOnly, formatDaysLeft } from "@/lib/dates";
import {
  DataTable,
  StatusBar,
  TableSkeleton,
  formatCounts,
} from "@/components/ui";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  MilestoneFormDialog,
  type MilestoneFormValues,
} from "@/components/milestones/MilestoneFormDialog";
import { AddRunsDialog } from "@/components/milestones/AddRunsDialog";
import {
  RUN_TABLE_MILESTONE_CLASS,
  runTableColumns,
} from "@/components/runs/runTable";
import "./milestone-detail.css";

/** One page of runs is enough for a milestone in the MVP; the API's max. */
const RUNS_LIMIT = 100;

type MilestoneState =
  | { kind: "loading" }
  | { kind: "ready"; milestone: Milestone }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

type RunsState =
  | { kind: "loading" }
  | { kind: "ready"; rows: Run[]; total: number }
  | { kind: "error"; message: string };

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message || fallback : fallback;
}

/** API field errors keyed exactly as the contract sends them. */
function sortFieldErrors(err: unknown): {
  fields: Record<string, string>;
  form: string | null;
} {
  const fields: Record<string, string> = {};
  let form: string | null = null;
  for (const detail of err instanceof ApiError ? (err.details ?? []) : []) {
    if (detail.field) fields[detail.field] = detail.issue;
    else form = detail.issue;
  }
  return { fields, form };
}

export default function MilestoneDetailPage() {
  const { user } = useSession();
  const router = useRouter();
  const routeParams = useParams();
  const rawId = routeParams.id;
  const milestoneId = Array.isArray(rawId) ? (rawId[0] ?? "") : (rawId ?? "");
  const searchParams = useSearchParams();
  const urlProject = searchParams.get("project");

  /** Bumped after any write so the milestone and its runs are refetched. */
  const [version, setVersion] = useState(0);
  function refresh(): void {
    setVersion((current) => current + 1);
  }

  const [milestoneState, setMilestoneState] = useState<MilestoneState>({
    kind: "loading",
  });
  useEffect(() => {
    if (!milestoneId) return;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setMilestoneState({ kind: "loading" });
      try {
        const milestone = await api.getMilestone(milestoneId);
        if (active) setMilestoneState({ kind: "ready", milestone });
      } catch (err) {
        if (!active || isSessionDead(err)) return;
        if (err instanceof ApiError && err.status === 404) {
          setMilestoneState({ kind: "not-found" });
        } else {
          setMilestoneState({
            kind: "error",
            message: errorMessage(
              err,
              "Couldn't load the milestone. Check your connection and retry."
            ),
          });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [milestoneId, version]);

  const milestone =
    milestoneState.kind === "ready" ? milestoneState.milestone : null;
  const projectId = milestone?.project_id ?? urlProject ?? "";

  // ---- runs in this milestone ----
  const [runsState, setRunsState] = useState<RunsState>({ kind: "loading" });
  useEffect(() => {
    if (!milestone) return;
    const id = milestone.id;
    const project = milestone.project_id;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setRunsState({ kind: "loading" });
      try {
        const result = await api.listRuns(project, {
          milestone_id: id,
          limit: RUNS_LIMIT,
          sort: "-created_at",
        });
        if (!active) return;
        setRunsState({
          kind: "ready",
          rows: result.data,
          total: result.meta?.total ?? result.data.length,
        });
      } catch (err) {
        if (!active || isSessionDead(err)) return;
        setRunsState({
          kind: "error",
          message: errorMessage(
            err,
            "Couldn't load this milestone's runs. Check your connection and retry."
          ),
        });
      }
    })();
    return () => {
      active = false;
    };
  }, [milestone, version]);

  // ---- project (archived → read-only) ----
  const [project, setProject] = useState<Project | null>(null);
  const loadedProjectId = milestone?.project_id ?? "";
  useEffect(() => {
    if (!loadedProjectId) return;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      try {
        const loaded = await api.getProject(loadedProjectId);
        if (active) setProject(loaded);
      } catch (err) {
        if (isSessionDead(err)) return;
        // Only the write controls depend on this; the milestone still renders.
        if (active) setProject(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [loadedProjectId]);

  // ---- plan names (the Plan column) ----
  // Non-essential: a failed load leaves a run's plan cell as "—", and the page
  // still works.
  const [plans, setPlans] = useState<Plan[]>([]);
  useEffect(() => {
    if (!loadedProjectId) return;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      try {
        const result = await api.listPlans(loadedProjectId, { limit: 100 });
        if (active) setPlans(result.data);
      } catch (err) {
        if (isSessionDead(err)) return;
        if (active) setPlans([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [loadedProjectId]);

  const planNames = useMemo(
    () => new Map(plans.map((plan) => [plan.id, plan.name])),
    [plans]
  );

  const archived = project?.status === "archived";
  const role = user?.role;
  const canWrite =
    Boolean(project) &&
    !archived &&
    Boolean(role) &&
    canWriteMilestones(role!);

  // ---- edit dialog ----
  const [editOpen, setEditOpen] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editFieldErrors, setEditFieldErrors] = useState<{
    name?: string;
    description?: string;
    due_date?: string;
  }>({});
  const [editError, setEditError] = useState<string | null>(null);

  function openEdit(): void {
    setEditFieldErrors({});
    setEditError(null);
    setEditOpen(true);
  }

  async function submitEdit(values: MilestoneFormValues): Promise<void> {
    if (!milestone) return;
    setEditBusy(true);
    setEditFieldErrors({});
    setEditError(null);
    // Always sends all three fields: an emptied input clears the value on the
    // server (`null`) rather than leaving it unchanged.
    try {
      await api.updateMilestone(milestone.id, {
        name: values.name,
        description: values.description || null,
        due_date: values.dueDate || null,
      });
      setEditOpen(false);
      refresh();
    } catch (err) {
      if (isSessionDead(err)) {
        setEditOpen(false);
        return;
      }
      const { fields, form } = sortFieldErrors(err);
      const fieldErrors: typeof editFieldErrors = {};
      for (const key of ["name", "description", "due_date"] as const) {
        if (fields[key]) fieldErrors[key] = fields[key];
      }
      setEditFieldErrors(fieldErrors);
      setEditError(
        form ??
          (Object.keys(fieldErrors).length === 0
            ? errorMessage(err, "Could not save the milestone. Please try again.")
            : null)
      );
    } finally {
      setEditBusy(false);
    }
  }

  // ---- delete dialog ----
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const milestonesHref = projectId
    ? `/milestones?project=${encodeURIComponent(projectId)}`
    : "/milestones";

  async function confirmDelete(): Promise<void> {
    if (!milestone) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await api.deleteMilestone(milestone.id);
      setDeleteOpen(false);
      // The runs survive (docs/api-milestones.md § DELETE /milestones/:id) —
      // only the checkpoint is gone — so the milestones list is the honest
      // place to land.
      router.push(milestonesHref);
    } catch (err) {
      if (isSessionDead(err)) {
        setDeleteOpen(false);
        return;
      }
      setDeleteError(
        errorMessage(err, "Could not delete the milestone. Please try again.")
      );
    } finally {
      setDeleteBusy(false);
    }
  }

  // ---- add runs ----
  const [addOpen, setAddOpen] = useState(false);
  const [candidates, setCandidates] = useState<Run[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [candidatesRetry, setCandidatesRetry] = useState(0);
  const [addBusy, setAddBusy] = useState(false);
  const [addFieldErrors, setAddFieldErrors] = useState<Record<string, string>>(
    {}
  );
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    if (!addOpen || !loadedProjectId) return;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setCandidatesLoading(true);
      setCandidatesError(null);
      try {
        const result = await api.listRuns(loadedProjectId, {
          milestone_id: "none",
          limit: RUNS_LIMIT,
          sort: "name",
        });
        if (active) setCandidates(result.data);
      } catch (err) {
        if (!active || isSessionDead(err)) return;
        setCandidates([]);
        setCandidatesError(
          errorMessage(
            err,
            "Couldn't load the runs to add. Check your connection and retry."
          )
        );
      } finally {
        if (active) setCandidatesLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [addOpen, loadedProjectId, candidatesRetry]);

  function openAddRuns(): void {
    setCandidates([]);
    setCandidatesError(null);
    setAddFieldErrors({});
    setAddError(null);
    setAddOpen(true);
  }

  async function submitAddRuns(runIds: string[]): Promise<void> {
    if (!milestone) return;
    setAddBusy(true);
    setAddFieldErrors({});
    setAddError(null);
    try {
      await api.attachMilestoneRuns(milestone.id, { run_ids: runIds });
      setAddOpen(false);
      refresh();
    } catch (err) {
      if (isSessionDead(err)) {
        setAddOpen(false);
        return;
      }
      const { fields, form } = sortFieldErrors(err);
      const fieldErrors: Record<string, string> = {};
      for (const [field, issue] of Object.entries(fields)) {
        if (field === "run_ids" || field.startsWith("run_ids[")) {
          fieldErrors[field] = issue;
        }
      }
      setAddFieldErrors(fieldErrors);
      setAddError(
        form ??
          (Object.keys(fieldErrors).length === 0
            ? errorMessage(err, "Could not add the runs. Please try again.")
            : null)
      );
    } finally {
      setAddBusy(false);
    }
  }

  // ---- remove a run from this milestone ----
  const [detaching, setDetaching] = useState<Run | null>(null);
  const [detachBusy, setDetachBusy] = useState(false);
  const [detachError, setDetachError] = useState<string | null>(null);

  async function confirmDetach(): Promise<void> {
    if (!milestone || !detaching) return;
    setDetachBusy(true);
    setDetachError(null);
    try {
      await api.detachMilestoneRun(milestone.id, detaching.id);
      setDetaching(null);
      refresh();
    } catch (err) {
      if (isSessionDead(err)) {
        setDetaching(null);
        return;
      }
      setDetachError(
        errorMessage(
          err,
          "Could not remove the run from this milestone. Please try again."
        )
      );
    } finally {
      setDetachBusy(false);
    }
  }

  // ---- project-level states ----
  if (milestoneState.kind === "loading") {
    return (
      <div className="page milestone-detail-page" aria-busy="true">
        <p className="md-back">
          <Link href={milestonesHref}>← Milestones</Link>
        </p>
        <p className="md-subtitle">Loading milestone…</p>
        <TableSkeleton rows={5} columns={7} label="Loading milestone runs" />
      </div>
    );
  }

  if (milestoneState.kind === "not-found") {
    return (
      <div className="page milestone-detail-page">
        <div className="panel panel-error" role="alert">
          <h1>Milestone not found</h1>
          <p>This milestone does not exist, or it was deleted.</p>
          <p>
            <Link href={milestonesHref}>Back to milestones</Link>
          </p>
        </div>
      </div>
    );
  }

  if (milestoneState.kind === "error") {
    return (
      <div className="page milestone-detail-page">
        <div className="panel panel-error" role="alert">
          <h1>Couldn&apos;t load the milestone</h1>
          <p>{milestoneState.message}</p>
          <p>
            <button type="button" onClick={refresh}>
              Retry
            </button>
          </p>
        </div>
      </div>
    );
  }

  const theMilestone = milestoneState.milestone;
  const rows = runsState.kind === "ready" ? runsState.rows : [];
  const runTotal = runsState.kind === "ready" ? runsState.total : 0;
  const daysLeft = formatDaysLeft(theMilestone.due_date);

  const columns = runTableColumns({
    onOpenRun: (run) =>
      router.push(
        projectId
          ? `/runs/${run.id}?project=${encodeURIComponent(projectId)}`
          : `/runs/${run.id}`
      ),
    planNames,
    onOpenPlan: (planId) =>
      router.push(
        projectId
          ? `/plans/${planId}?project=${encodeURIComponent(projectId)}`
          : `/plans/${planId}`
      ),
    rowAction: canWrite
      ? {
          label: "Remove",
          ariaLabel: (run) => `Remove ${run.name} from this milestone`,
          danger: true,
          onClick: (run) => {
            setDetachError(null);
            setDetaching(run);
          },
        }
      : undefined,
  });

  const countsLine = formatCounts(theMilestone.counts);
  const readOnlyReason = archived
    ? "This project is archived — this milestone is read-only."
    : !canWrite
      ? "Read-only: editing a milestone needs the Admin or Lead role."
      : null;

  let emptyBody: string;
  let emptyAction: ReactNode = null;
  if (canWrite) {
    emptyBody =
      "Add runs that have no milestone yet, and they count toward this milestone's progress.";
    emptyAction = (
      <button type="button" className="primary" onClick={openAddRuns}>
        Add runs
      </button>
    );
  } else {
    emptyBody = "A Lead or Admin adds runs to a milestone.";
  }

  return (
    <div className="page milestone-detail-page">
      <p className="md-back">
        <Link href={milestonesHref}>← Milestones</Link>
      </p>

      <div className="md-heading">
        <div className="md-heading-main">
          <h1 className="md-title">{theMilestone.name}</h1>
          <span className={`md-status md-status-${theMilestone.status}`}>
            {MILESTONE_STATUS_LABELS[theMilestone.status]}
          </span>
        </div>
        <div className="md-heading-side">
          {theMilestone.due_date && (
            <p className="md-due">
              Due{" "}
              <time dateTime={theMilestone.due_date}>
                {formatDateOnly(theMilestone.due_date)}
              </time>
              {daysLeft && (
                <>
                  {" · "}
                  <span
                    className={
                      daysLeft.endsWith("late") ? "md-days-late" : undefined
                    }
                  >
                    {daysLeft}
                  </span>
                </>
              )}
            </p>
          )}
          {canWrite && (
            <div className="md-actions">
              <button type="button" className="secondary" onClick={openEdit}>
                Edit milestone
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  setDeleteError(null);
                  setDeleteOpen(true);
                }}
              >
                Delete milestone
              </button>
            </div>
          )}
        </div>
      </div>

      {readOnlyReason && <p className="md-readonly">{readOnlyReason}</p>}

      {theMilestone.description && (
        <p className="md-description">{theMilestone.description}</p>
      )}

      <div className="md-summary">
        {theMilestone.counts.total > 0 ? (
          <StatusBar counts={theMilestone.counts} label={theMilestone.name} />
        ) : null}
        <p className="md-headline">
          {theMilestone.counts.percent_complete}% complete ·{" "}
          {theMilestone.counts.total} item
          {theMilestone.counts.total === 1 ? "" : "s"} ·{" "}
          {theMilestone.run_count} run
          {theMilestone.run_count === 1 ? "" : "s"}
        </p>
      </div>
      <p className="md-counts">
        {countsLine || "No items in this milestone's runs yet."}
      </p>

      <section className="md-section" aria-labelledby="md-runs-heading">
        <div className="md-section-heading">
          <h2 id="md-runs-heading">Runs</h2>
          {canWrite && rows.length > 0 && (
            <button type="button" className="secondary" onClick={openAddRuns}>
              Add runs
            </button>
          )}
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          className={RUN_TABLE_MILESTONE_CLASS}
          caption={`Runs in ${theMilestone.name}`}
          ariaLabel="Milestone runs"
          loading={runsState.kind === "loading"}
          error={runsState.kind === "error" ? runsState.message : null}
          onRetry={refresh}
          emptyTitle="No runs in this milestone yet."
          emptyBody={emptyBody}
          emptyAction={emptyAction}
          rowHeight="default"
        />
        {runTotal > rows.length && (
          <p className="md-hint">
            Showing the newest {rows.length} of {runTotal} runs.{" "}
            <Link
              href={
                projectId
                  ? `/runs?project=${encodeURIComponent(projectId)}`
                  : "/runs"
              }
            >
              See all runs
            </Link>
            .
          </p>
        )}
      </section>

      {editOpen && (
        <MilestoneFormDialog
          mode="edit"
          initial={theMilestone}
          busy={editBusy}
          serverFieldErrors={editFieldErrors}
          formError={editError}
          onSubmit={(values) => void submitEdit(values)}
          onCancel={() => setEditOpen(false)}
        />
      )}

      {deleteOpen && (
        <ConfirmDialog
          title={`Delete “${theMilestone.name}”?`}
          body={
            <>
              <p>
                {theMilestone.run_count === 0
                  ? "This milestone has no runs."
                  : `Its ${theMilestone.run_count} run${
                      theMilestone.run_count === 1 ? "" : "s"
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
            setDeleteOpen(false);
          }}
        />
      )}

      {addOpen && (
        <AddRunsDialog
          runs={candidates}
          loading={candidatesLoading}
          error={candidatesError}
          onRetry={() => setCandidatesRetry((current) => current + 1)}
          busy={addBusy}
          serverFieldErrors={addFieldErrors}
          formError={addError}
          onSubmit={(runIds) => void submitAddRuns(runIds)}
          onCancel={() => setAddOpen(false)}
        />
      )}

      {detaching && (
        <ConfirmDialog
          title={`Remove “${detaching.name}” from this milestone?`}
          body={
            <>
              <p>
                The run is kept: it stays in the project with its cases,
                results and attachments. It only stops counting toward this
                milestone.
              </p>
              {detachError && (
                <p className="form-error" role="alert">
                  {detachError}
                </p>
              )}
            </>
          }
          confirmLabel="Remove from milestone"
          danger
          busy={detachBusy}
          onConfirm={() => void confirmDetach()}
          onCancel={() => {
            setDetachError(null);
            setDetaching(null);
          }}
        />
      )}
    </div>
  );
}