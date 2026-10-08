"use client";

/**
 * Project detail — placeholder screen hosting suites/runs in later slices.
 * Shows the project per docs/api-projects.md § Resource; Admin gets an inline
 * edit form. 403/404 render as readable states: a non-admin opening an
 * archived project receives the contract's 404 and sees "Project not found",
 * never a crash.
 */
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Project } from "@/lib/api-types";
import { api } from "@/lib/endpoints";
import { ApiError } from "@/lib/api-error";
import { RequireAuth, isSessionDead } from "@/components/require-auth";
import { useSession } from "@/lib/session";
import { canArchiveProject, canEditProject, canRestoreProject } from "@/lib/project-permissions";
import { EditProjectForm } from "@/components/project-forms";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { projectActionError } from "@/components/project-action-error";

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; project: Project }
  | { kind: "not-found" }
  | { kind: "forbidden"; message: string }
  | { kind: "error"; message: string };

function formatDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function ProjectDetailPage() {
  const { user } = useSession();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const id = typeof params?.id === "string" ? params.id : "";

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [editing, setEditing] = useState(searchParams.get("edit") === "1");
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<"archive" | "restore" | null>(null);
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
      <main className="page">
        <p role="status" aria-live="polite">
          Loading project…
        </p>
      </main>
    );
  }

  if (state.kind === "not-found") {
    return (
      <main className="page">
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
      </main>
    );
  }

  if (state.kind === "forbidden") {
    return (
      <main className="page">
        <div className="panel panel-error" role="alert">
          <h1>Forbidden</h1>
          <p>{state.message}</p>
          <p>
            <Link href="/projects">Back to projects</Link>
          </p>
        </div>
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main className="page">
        <div className="panel panel-error" role="alert">
          <h1>Something went wrong</h1>
          <p>{state.message}</p>
          <p>
            <button type="button" onClick={() => void load()}>
              Try again
            </button>
          </p>
        </div>
      </main>
    );
  }

  const { project } = state;
  const canEdit = user ? canEditProject(user.role) : false;
  const canArchive = user ? canArchiveProject(user.role) : false;
  const canRestore = user ? canRestoreProject(user.role) : false;

  return (
    <main className="page">
      <p className="breadcrumb">
        <Link href="/projects">← All projects</Link>
      </p>
      {editing && canEdit ? (
        <EditProjectForm
          project={project}
          onSaved={(updated) => {
            setState({ kind: "loaded", project: updated });
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <div className="project-header">
            <h1>
              {project.name}{" "}
              {project.status === "archived" && (
                <span className="badge badge-muted">Archived</span>
              )}
            </h1>
            <p className="project-key-line">
              Key: <code>{project.key}</code>
            </p>
          </div>

          {actionError && (
            <p className="form-error" role="alert">
              {actionError}
            </p>
          )}

          <div className="panel">
            <h2>Description</h2>
            {project.description ? (
              <p>{project.description}</p>
            ) : (
              <p className="muted">No description.</p>
            )}
            <p className="muted project-meta">
              Created {formatDateTime(project.created_at)} · Last updated{" "}
              {formatDateTime(project.updated_at)}
            </p>
            <p className="muted">
              Test suites, cases, runs and reports for this project arrive in
              later slices.
            </p>
          </div>

          <div className="button-row">
            {canEdit && (
              <button type="button" onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
            {canArchive && project.status === "active" && (
              <button type="button" onClick={() => setConfirmAction("archive")}>
                Archive
              </button>
            )}
            {canRestore && project.status === "archived" && (
              <button type="button" onClick={() => setConfirmAction("restore")}>
                Restore
              </button>
            )}
          </div>
        </>
      )}

      {confirmAction && (
        <ConfirmDialog
          title={confirmAction === "archive" ? "Archive project?" : "Restore project?"}
          body={
            confirmAction === "archive" ? (
              <p>
                <strong>{project.name}</strong> will be archived and disappear from
                the list for everyone except Admins. Existing data is kept; an Admin
                can restore it later.
              </p>
            ) : (
              <p>
                <strong>{project.name}</strong> will be restored to the active list
                for all roles.
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
    </main>
  );
}

export default function ProjectDetailRoute() {
  return (
    <Suspense
      fallback={
        <div className="auth-loading" role="status" aria-live="polite">
          Loading project…
        </div>
      }
    >
      <RequireAuth>
        <ProjectDetailPage />
      </RequireAuth>
    </Suspense>
  );
}
