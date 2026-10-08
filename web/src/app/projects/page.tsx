"use client";

/**
 * Projects list — the default landing page after login (docs/PRD-projects.md).
 * - Active projects for everyone; name search and pagination.
 * - Admin-only status filter (active/archived): non-admins never see the
 *   control, and the UI never sends status=archived for them (contract 403).
 * - Role-aware write controls per the api-projects.md role matrix.
 * - Search/filter/page state lives in the URL query string so views are
 *   shareable and back/forward works.
 */
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Project, ProjectStatus } from "@/lib/api-types";
import { api } from "@/lib/endpoints";
import { ApiError } from "@/lib/api-error";
import { RequireAuth, isSessionDead } from "@/components/require-auth";
import { useSession } from "@/lib/session";
import {
  canArchiveProject,
  canCreateProject,
  canEditProject,
  canRestoreProject,
} from "@/lib/project-permissions";
import { CreateProjectForm } from "@/components/project-forms";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { projectActionError } from "@/components/project-action-error";

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

type StatusFilter = "active" | "archived";

function readStatusFilter(raw: string | null, isAdmin: boolean): StatusFilter {
  return isAdmin && raw === "archived" ? "archived" : "active";
}

function readPage(raw: string | null): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

function isProjectStatus(value: unknown): value is ProjectStatus {
  return value === "active" || value === "archived";
}

function ProjectsListPage() {
  const { user } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isAdmin = user?.role === "admin";

  // URL is the source of truth for query/status/page.
  const urlQuery = searchParams.get("query") ?? "";
  const urlStatus = readStatusFilter(searchParams.get("status"), isAdmin);
  const urlPage = readPage(searchParams.get("page"));

  const [queryInput, setQueryInput] = useState(urlQuery);
  const [projects, setProjects] = useState<Project[]>([]);
  const [meta, setMeta] = useState<{ page: number; total_pages: number; total: number } | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createdNotice, setCreatedNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    project: Project;
    kind: "archive" | "restore";
  } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pushParams = useCallback(
    (next: { query?: string; status?: StatusFilter; page?: number }) => {
      const params = new URLSearchParams(searchParams.toString());
      const query = next.query ?? urlQuery;
      const status = next.status ?? urlStatus;
      const page = next.page ?? urlPage;
      if (query) params.set("query", query);
      else params.delete("query");
      if (isAdmin && status === "archived") params.set("status", "archived");
      else params.delete("status");
      if (page > 1) params.set("page", String(page));
      else params.delete("page");
      const qs = params.toString();
      router.replace(qs ? `/projects?${qs}` : "/projects", { scroll: false });
    },
    [router, searchParams, urlQuery, urlStatus, urlPage, isAdmin]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const result = await api.listProjects({
        query: urlQuery || undefined,
        status: urlStatus,
        page: urlPage,
        limit: PAGE_SIZE,
      });
      setProjects(result.data);
      setMeta(
        result.meta
          ? {
              page: result.meta.page,
              total_pages: result.meta.total_pages,
              total: result.meta.total,
            }
          : null
      );
    } catch (err) {
      if (isSessionDead(err)) return;
      if (err instanceof ApiError && err.status === 403) {
        // Contract: status=archived is Admin-only; any other 403 is likewise
        // a permission problem, so keep it readable instead of crashing.
        setListError(
          err.message || "You do not have permission to view this project list."
        );
      } else {
        setListError("Could not load projects. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }, [urlQuery, urlStatus, urlPage]);

  useEffect(() => {
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (active) await load();
    })();
    return () => {
      active = false;
    };
  }, [load, urlQuery]);

  // Keep the visible input in sync with back/forward navigation: the
  // "adjust state during render" pattern (React docs) — an effect would
  // trigger a cascading render.
  const [renderedQuery, setRenderedQuery] = useState(urlQuery);
  if (renderedQuery !== urlQuery) {
    setRenderedQuery(urlQuery);
    setQueryInput(urlQuery);
  }

  function onSearchChange(value: string) {
    setQueryInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      pushParams({ query: value.trim(), page: 1 });
    }, SEARCH_DEBOUNCE_MS);
  }

  function onStatusChange(value: StatusFilter) {
    pushParams({ status: value, page: 1 });
  }

  async function runConfirmedAction() {
    if (!confirmAction) return;
    const { project, kind } = confirmAction;
    setBusyProjectId(project.id);
    setActionError(null);
    try {
      const updated =
        kind === "archive"
          ? await api.archiveProject(project.id)
          : await api.restoreProject(project.id);
      setConfirmAction(null);
      if (isProjectStatus(updated.status) && updated.status !== urlStatus) {
        // The row left the current filtered view (e.g. archived out of the
        // active list) — reload; it reappears under the matching filter.
        await load();
      } else {
        setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      }
    } catch (err) {
      if (isSessionDead(err)) {
        setConfirmAction(null);
        return;
      }
      setActionError(projectActionError(err, kind));
    } finally {
      setBusyProjectId(null);
    }
  }

  const canCreate = user ? canCreateProject(user.role) : false;
  const canEdit = user ? canEditProject(user.role) : false;
  const canArchive = user ? canArchiveProject(user.role) : false;
  const canRestore = user ? canRestoreProject(user.role) : false;

  return (
    <main className="page">
      <h1>Projects</h1>

      <div className="toolbar">
        <div className="field">
          <label htmlFor="project-search">Search by name</label>
          <input
            id="project-search"
            type="search"
            placeholder="Search projects"
            value={queryInput}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        {isAdmin && (
          <div className="field">
            <label htmlFor="project-status-filter">Status</label>
            <select
              id="project-status-filter"
              value={urlStatus}
              onChange={(e) => onStatusChange(e.target.value as StatusFilter)}
            >
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </div>
        )}
        {canCreate && (
          <button
            type="button"
            className="primary"
            onClick={() => {
              setShowCreate((v) => !v);
              setCreatedNotice(null);
            }}
            aria-expanded={showCreate}
          >
            {showCreate ? "Close form" : "New project"}
          </button>
        )}
      </div>

      {createdNotice && (
        <p className="form-notice" role="status">
          {createdNotice}
        </p>
      )}
      {actionError && (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      )}
      {listError && (
        <p className="form-error" role="alert">
          {listError}
        </p>
      )}

      {showCreate && canCreate && (
        <CreateProjectForm
          onCreated={(project) => {
            setShowCreate(false);
            setCreatedNotice(`Project “${project.name}” created.`);
            // A new project is active; make sure the list view shows it.
            if (urlStatus !== "active" || urlQuery || urlPage !== 1) {
              router.replace("/projects");
            } else {
              void load();
            }
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {loading ? (
        <p role="status" aria-live="polite">
          Loading projects…
        </p>
      ) : (
        <table className="users-table projects-table">
          <caption className="sr-only">
            Projects
            {meta ? `, page ${meta.page} of ${meta.total_pages}` : ""}
            {urlStatus === "archived" ? " (archived)" : ""}
          </caption>
          <thead>
            <tr>
              <th scope="col">Key</th>
              <th scope="col">Name</th>
              <th scope="col">Description</th>
              {urlStatus === "archived" && <th scope="col">Status</th>}
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {projects.length === 0 && (
              <tr>
                <td colSpan={urlStatus === "archived" ? 5 : 4} className="muted">
                  {urlQuery
                    ? "No projects match your search."
                    : urlStatus === "archived"
                      ? "No archived projects."
                      : "No projects yet."}
                </td>
              </tr>
            )}
            {projects.map((project) => (
              <tr key={project.id}>
                <td>
                  <code>{project.key}</code>
                </td>
                <td>
                  <Link href={`/projects/${project.id}`}>{project.name}</Link>
                </td>
                <td className="cell-description">{project.description ?? ""}</td>
                {urlStatus === "archived" && (
                  <td>
                    <span className="badge badge-muted">Archived</span>
                  </td>
                )}
                <td>
                  <div className="button-row">
                    {canEdit && (
                      <Link
                        href={`/projects/${project.id}?edit=1`}
                        className="button-link"
                        aria-label={`Edit ${project.name}`}
                      >
                        Edit
                      </Link>
                    )}
                    {canArchive && project.status === "active" && (
                      <button
                        type="button"
                        disabled={busyProjectId === project.id}
                        onClick={() => setConfirmAction({ project, kind: "archive" })}
                      >
                        Archive
                      </button>
                    )}
                    {canRestore && project.status === "archived" && (
                      <button
                        type="button"
                        disabled={busyProjectId === project.id}
                        onClick={() => setConfirmAction({ project, kind: "restore" })}
                      >
                        Restore
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {meta && meta.total_pages > 1 && (
        <nav className="pagination" aria-label="Project list pages">
          <button
            type="button"
            disabled={urlPage <= 1}
            onClick={() => pushParams({ page: Math.max(1, urlPage - 1) })}
          >
            Previous
          </button>
          <span className="t-nums">
            Page {meta.page} of {meta.total_pages} ({meta.total} projects)
          </span>
          <button
            type="button"
            disabled={urlPage >= meta.total_pages}
            onClick={() => pushParams({ page: urlPage + 1 })}
          >
            Next
          </button>
        </nav>
      )}

      {confirmAction && (
        <ConfirmDialog
          title={confirmAction.kind === "archive" ? "Archive project?" : "Restore project?"}
          body={
            confirmAction.kind === "archive" ? (
              <p>
                <strong>{confirmAction.project.name}</strong> will be archived and
                disappear from the list for everyone except Admins. Existing data is
                kept; an Admin can restore it later.
              </p>
            ) : (
              <p>
                <strong>{confirmAction.project.name}</strong> will be restored to the
                active list for all roles.
              </p>
            )
          }
          confirmLabel={confirmAction.kind === "archive" ? "Archive" : "Restore"}
          danger={confirmAction.kind === "archive"}
          busy={busyProjectId === confirmAction.project.id}
          onConfirm={() => void runConfirmedAction()}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </main>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense
      fallback={
        <div className="auth-loading" role="status" aria-live="polite">
          Loading projects…
        </div>
      }
    >
      <RequireAuth>
        <ProjectsListPage />
      </RequireAuth>
    </Suspense>
  );
}
