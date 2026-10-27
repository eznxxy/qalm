"use client";

/**
 * Project overview (docs/DESIGN.md §4.8, docs/PRD-project-overview.md).
 *
 * The project header (title, key, status badge, Edit/Archive) is unchanged from
 * slice 1; the tab strip below it reaches the project's other screens, and the
 * Overview tab holds the description plus three independently-loaded cards: the
 * results trend over a 1/7/14/30-day window, the nearest milestones and the
 * newest runs.
 *
 * The window lives in the URL (`?days=30`) so reloads and shared links keep it;
 * only the trend card refetches when it changes. 403/404 render as readable
 * states: a non-admin opening an archived project receives the contract's 404
 * and sees "Project not found", never a crash.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Project } from "@/lib/api-types";
import { api } from "@/lib/endpoints";
import { ApiError } from "@/lib/api-error";
import { isSessionDead } from "@/components/require-auth";
import { useSession } from "@/lib/session";
import {
  canArchiveProject,
  canEditProject,
  canRestoreProject,
} from "@/lib/project-permissions";
import { canWriteMilestones } from "@/lib/milestone-permissions";
import { canWriteRuns } from "@/lib/run-permissions";
import { EditProjectForm } from "@/components/project-forms";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { StatusBadge } from "@/components/ui";
import { projectActionError } from "@/components/project-action-error";
import { describeTimestamp } from "@/lib/dates";
import { parseTrendDays, type TrendWindow } from "@/lib/trend-window";
import { ProjectTabs } from "@/components/projects/ProjectTabs";
import { ResultsTrend } from "@/components/projects/ResultsTrend";
import { MilestonesCard } from "@/components/projects/MilestonesCard";
import { RunsCard } from "@/components/projects/RunsCard";
import "./overview.css";

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; project: Project }
  | { kind: "not-found" }
  | { kind: "forbidden"; message: string }
  | { kind: "error"; message: string };

export default function ProjectDetailPage() {
  const { user } = useSession();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchKey = searchParams.toString();
  const id = typeof params?.id === "string" ? params.id : "";
  const days = useMemo(
    () => parseTrendDays(new URLSearchParams(searchKey).get("days")),
    [searchKey]
  );

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [editing, setEditing] = useState(searchParams.get("edit") === "1");
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<"archive" | "restore" | null>(
    null
  );
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const project = await api.getProject(id);
      setState({ kind: "loaded", project });
    } catch (err) {
      if (isSessionDead(err)) return;
      if (err instanceof ApiError && err.status === 404) {
        setState({ kind: "not-found" });
      } else if (err instanceof ApiError && err.status === 403) {
        setState({
          kind: "forbidden",
          message:
            err.message || "You do not have permission to view this project.",
        });
      } else {
        setState({
          kind: "error",
          message:
            err instanceof ApiError
              ? err.message
              : "Could not load the project. Please try again.",
        });
      }
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (active) await load();
    })();
    return () => {
      active = false;
    };
  }, [id, load]);

  const onDaysChange = useCallback(
    (next: TrendWindow) => {
      const nextParams = new URLSearchParams(searchKey);
      nextParams.set("days", String(next));
      router.replace(
        `/projects/${encodeURIComponent(id)}?${nextParams.toString()}`,
        { scroll: false }
      );
    },
    [id, router, searchKey]
  );

  async function runAction(kind: "archive" | "restore") {
    if (state.kind !== "loaded") return;
    setBusy(true);
    setActionError(null);
    try {
      const updated =
        kind === "archive"
          ? await api.archiveProject(state.project.id)
          : await api.restoreProject(state.project.id);
      setState({ kind: "loaded", project: updated });
      setConfirmAction(null);
    } catch (err) {
      if (isSessionDead(err)) {
        setConfirmAction(null);
        return;
      }
      setActionError(projectActionError(err, kind));
    } finally {
      setBusy(false);
    }
  }

  if (state.kind === "loading") {
    return (
      <div className="page">
        <p role="status" aria-live="polite">
          Loading project…
        </p>
      </div>
    );
  }

  if (state.kind === "not-found") {
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

  if (state.kind === "forbidden") {
    return (
      <div className="page">
        <div className="panel panel-error" role="alert">
          <h1>Forbidden</h1>
          <p>{state.message}</p>
          <p>
            <Link href="/projects">Back to projects</Link>
          </p>
        </div>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="page">
        <div className="panel panel-error" role="alert">
          <h1>Something went wrong</h1>
          <p>{state.message}</p>
          <p>
            <button type="button" onClick={() => void load()}>
              Try again
            </button>
          </p>
        </div>
      </div>
    );
  }

  const { project } = state;
  const created = describeTimestamp(project.created_at);
  const updated = describeTimestamp(project.updated_at);
  const canEdit = user ? canEditProject(user.role) : false;
  const canArchive = user ? canArchiveProject(user.role) : false;
  const canRestore = user ? canRestoreProject(user.role) : false;
  const activeProject = project.status === "active";
  const canCreateMilestone =
    activeProject && Boolean(user) && canWriteMilestones(user!.role);
  const canCreateRun =
    activeProject && Boolean(user) && canWriteRuns(user!.role);

  return (
    <div className="page">
      <p className="breadcrumb">
        <Link href="/projects">← All projects</Link>
      </p>
      {editing && canEdit ? (
        <EditProjectForm
          project={project}
          onSaved={(saved) => {
            setState({ kind: "loaded", project: saved });
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <div className="project-header ov-project-header">
            <div>
              <h1>
                {project.name}{" "}
                {project.status === "archived" && (
                  <StatusBadge status="skipped">Archived</StatusBadge>
                )}
              </h1>
              <p className="project-key-line">
                Key: <code>{project.key}</code>
              </p>
            </div>
            <div className="button-row ov-header-actions">
              {canEdit && (
                <button type="button" onClick={() => setEditing(true)}>
                  Edit
                </button>
              )}
              {canArchive && activeProject && (
                <button
                  type="button"
                  onClick={() => setConfirmAction("archive")}
                >
                  Archive
                </button>
              )}
              {canRestore && project.status === "archived" && (
                <button
                  type="button"
                  onClick={() => setConfirmAction("restore")}
                >
                  Restore
                </button>
              )}
            </div>
          </div>

          {actionError && (
            <p className="form-error" role="alert">
              {actionError}
            </p>
          )}

          <ProjectTabs projectId={project.id} />

          <div className="ov-grid">
            <section className="panel ov-description">
              <h2>Description</h2>
              {project.description ? (
                <p>{project.description}</p>
              ) : (
                <p className="muted">No description.</p>
              )}
              <p className="muted project-meta">
                Created{" "}
                <time dateTime={project.created_at} title={created.title}>
                  {created.label}
                </time>{" "}
                · Last updated{" "}
                <time dateTime={project.updated_at} title={updated.title}>
                  {updated.label}
                </time>
              </p>
            </section>

            <ResultsTrend
              projectId={project.id}
              days={days}
              onDaysChange={onDaysChange}
            />

            <MilestonesCard
              projectId={project.id}
              canCreate={canCreateMilestone}
            />

            <RunsCard projectId={project.id} canCreate={canCreateRun} />
          </div>
        </>
      )}

      {confirmAction && (
        <ConfirmDialog
          title={
            confirmAction === "archive" ? "Archive project?" : "Restore project?"
          }
          body={
            confirmAction === "archive" ? (
              <p>
                <strong>{project.name}</strong> will be archived and disappear
                from the list for everyone except Admins. Existing data is kept;
                an Admin can restore it later.
              </p>
            ) : (
              <p>
                <strong>{project.name}</strong> will be restored to the active
                list for all roles.
              </p>
            )
          }
          confirmLabel={confirmAction === "archive" ? "Archive" : "Restore"}
          danger={confirmAction === "archive"}
          busy={busy}
          onConfirm={() => void runAction(confirmAction)}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </div>
  );
}