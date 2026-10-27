"use client";

/**
 * Run detail — the project-scoped run screen with the result drawer
 * (docs/DESIGN.md §4.4, backlog card 3.2). This is the most-used screen: a
 * header with the rollup, a filter bar, the run-items table and the 480px
 * result drawer.
 *
 * URL-as-state (lib/run-detail-url.ts): ?item opens the drawer; ?status,
 * ?assignee, ?suite, ?query, ?sort and ?page drive the items list. The drawer
 * parameter is parsed separately from the *list* key so opening or closing the
 * drawer never re-fetches (and flashes skeletons over) the table.
 *
 * Roles (docs/api-runs.md role matrix): closing/reopening, assigning and adding
 * or removing items need Admin/Lead; recording needs Admin/Lead, or the Tester
 * the item is assigned to. The drawer applies the per-item Tester rule itself
 * once the item loads, so a deep link to an item outside the loaded page still
 * gates correctly.
 *
 * Two data gaps, flagged in the handoff, not papered over:
 * - `GET /users` is Admin-only, so assignee names resolve only for Admins;
 *   everyone else sees short ids and can only pick people already on the run.
 * - The page has no "add cases to this run" control — that is the Cases
 *   screen's bulk "Add to run" (card 3.4); the empty state links there.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ITEM_STATUSES,
  RUN_STATUS_LABELS,
  type ItemStatus,
  type Plan,
  type Project,
  type Run,
  type RunItem,
  type SuiteNode,
  type User,
} from "@/lib/api-types";
import { api } from "@/lib/endpoints";
import { ApiError } from "@/lib/api-error";
import { isSessionDead } from "@/components/require-auth";
import { useSession } from "@/lib/session";
import {
  canAssignItems,
  canRecordResults,
  canWriteRuns,
} from "@/lib/run-permissions";
import {
  DEFAULT_RUN_ITEM_SORT,
  UNASSIGNED,
  parseRunDetailParams,
  patchRunDetailParams,
  runItemSortParam,
  runItemSortState,
  type RunDetailUrlPatch,
} from "@/lib/run-detail-url";
import { describeTimestamp, formatDateOnly } from "@/lib/dates";
import { suitesInRun } from "@/lib/suites";
import { shortActorId } from "@/lib/case-history";
import {
  DataTable,
  DisabledHint,
  STATUS_LABELS,
  StatusBadge,
  StatusPie,
  StatusSummary,
  TableSkeleton,
  type DataTableColumn,
  type DataTableSort,
} from "@/components/ui";
import {
  AssignItemsDialog,
  existingAssigneeOptions,
  type AssigneeOption,
} from "@/components/runs/AssignItemsDialog";
import { RunResultDrawer } from "@/components/runs/RunResultDrawer";
import "./run-detail.css";

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

/** Stable empty array so the not-ready render does not retrigger memos. */
const EMPTY_ROWS: RunItem[] = [];
/** Stable empty selection, same reason. */
const EMPTY_SELECTION: ReadonlySet<string> = new Set<string>();

type ProjectState =
  | { kind: "loading" }
  | { kind: "ready"; project: Project }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

type RunState =
  | { kind: "loading" }
  | { kind: "ready"; run: Run }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

type ItemsState =
  | { kind: "loading" }
  | {
      kind: "ready";
      rows: RunItem[];
      meta: { page: number; total: number; total_pages: number } | null;
    }
  | { kind: "error"; message: string };

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message || fallback : fallback;
}

export default function RunDetailPage() {
  const { user } = useSession();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const runId = typeof params?.id === "string" ? params.id : "";
  const searchParams = useSearchParams();
  const searchKey = searchParams.toString();
  const urlProject = searchParams.get("project");
  const itemId = searchParams.get("item") || null;
  const role = user?.role ?? "viewer";
  const userId = user?.id ?? "";

  // The list key excludes ?item, so opening/closing the drawer does not
  // re-fetch the table; the drawer id is read straight from searchParams.
  const listKey = useMemo(() => {
    const next = new URLSearchParams(searchKey);
    next.delete("item");
    return next.toString();
  }, [searchKey]);
  const url = useMemo(
    () => parseRunDetailParams(new URLSearchParams(listKey)),
    [listKey]
  );

  const [dataRetry, setDataRetry] = useState(0);

  // ---- run ----
  const [runState, setRunState] = useState<RunState>({ kind: "loading" });
  useEffect(() => {
    if (!runId) return;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setRunState({ kind: "loading" });
      try {
        const run = await api.getRun(runId);
        if (active) setRunState({ kind: "ready", run });
      } catch (err) {
        if (!active || isSessionDead(err)) return;
        if (err instanceof ApiError && err.status === 404) {
          setRunState({ kind: "not-found" });
        } else {
          setRunState({
            kind: "error",
            message: errorMessage(
              err,
              "Couldn't load the run. Check your connection and retry."
            ),
          });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [runId, dataRetry]);

  const run = runState.kind === "ready" ? runState.run : null;
  const runProjectId = run?.project_id ?? "";

  // The run's own project_id is authoritative once it loads; ?project only
  // seeds the first paint (and keeps the shell's project-scoped nav honest).
  const projectId = runProjectId || urlProject || "";

  // ---- project ----
  const [projectState, setProjectState] = useState<ProjectState>({
    kind: "loading",
  });
  const [projectRetry, setProjectRetry] = useState(0);

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setProjectState({ kind: "loading" });
      try {
        const project = await api.getProject(projectId);
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
  }, [projectId, projectRetry]);

  // A deep link without ?project: adopt the run's project so the shell agrees.
  useEffect(() => {
    if (!runProjectId || !runId) return;
    if (urlProject === runProjectId) return;
    const next = new URLSearchParams(searchKey);
    next.set("project", runProjectId);
    router.replace(`/runs/${runId}?${next.toString()}`, { scroll: false });
  }, [runProjectId, urlProject, searchKey, router, runId]);

  const project = projectState.kind === "ready" ? projectState.project : null;
  const archived = project?.status === "archived";

  // ---- plans (subtitle plan name, best effort) ----
  const [plans, setPlans] = useState<Plan[]>([]);
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
        if (isSessionDead(err)) return;
        if (active) setPlans([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [projectId]);

  // ---- suites (the Section filter, best effort) ----
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

  // ---- users (assignee names + the Assign dialog; Admin only) ----
  const isAdmin = role === "admin";
  const [users, setUsers] = useState<User[]>([]);
  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      try {
        const result = await api.listUsers({ limit: 100 });
        if (active) setUsers(result.data);
      } catch (err) {
        if (isSessionDead(err)) return;
        if (active) setUsers([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [isAdmin, dataRetry]);

  const userNames = useMemo(
    () => new Map(users.map((entry) => [entry.id, entry.name])),
    [users]
  );

  const planName = run?.plan_id ? plans.find((p) => p.id === run.plan_id)?.name ?? null : null;

  // ---- run items ----
  const [itemsState, setItemsState] = useState<ItemsState>({ kind: "loading" });

  useEffect(() => {
    if (!runId) return;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setItemsState({ kind: "loading" });
      try {
        const result = await api.listRunItems(runId, {
          status: url.statuses.length > 0 ? url.statuses : undefined,
          assignee_id: url.assignee ?? undefined,
          suite_id: url.suite ?? undefined,
          query: url.query || undefined,
          sort: url.sort,
          page: url.page,
          limit: PAGE_SIZE,
        });
        if (!active) return;
        setItemsState({
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
        setItemsState({
          kind: "error",
          message: errorMessage(
            err,
            "Couldn't load the run's items. Check your connection and retry."
          ),
        });
      }
    })();
    return () => {
      active = false;
    };
  }, [
    runId,
    url.statuses,
    url.assignee,
    url.suite,
    url.query,
    url.sort,
    url.page,
    dataRetry,
  ]);

  const rows = itemsState.kind === "ready" ? itemsState.rows : EMPTY_ROWS;
  const meta = itemsState.kind === "ready" ? itemsState.meta : null;

  /**
   * Assign is per item (PRD decision 2), so the table carries a scoped
   * selection. Selection is keyed to the current result set: a different
   * filter, sort or page starts with nothing selected, and the old ids are
   * never carried silently into a bulk assign (QA card 3.17). It is derived,
   * not cleared in an effect, mirroring the cases screen.
   */
  const itemsKey = [
    url.statuses.join(","),
    url.assignee,
    url.suite,
    url.query,
    url.sort,
    url.page,
  ].join("|");
  const [selection, setSelection] = useState<{
    key: string;
    ids: ReadonlySet<string>;
  }>({ key: "", ids: EMPTY_SELECTION });
  const selectedIds = selection.key === itemsKey ? selection.ids : EMPTY_SELECTION;
  const setSelectedIds = useCallback(
    (ids: ReadonlySet<string>) => setSelection({ key: itemsKey, ids }),
    [itemsKey]
  );
  const clearSelection = useCallback(
    () => setSelection({ key: "", ids: EMPTY_SELECTION }),
    []
  );

  // Cache Components hides this route with <Activity> instead of unmounting
  // it, so a selection left behind would greet the user on their return. Drop
  // it as the page is hidden (the documented Activity pattern, card 3.12).
  useLayoutEffect(() => {
    return () => {
      setSelection({ key: "", ids: EMPTY_SELECTION });
    };
  }, []);

  const pushParams = useCallback(
    (patch: RunDetailUrlPatch) => {
      const next = patchRunDetailParams(
        new URLSearchParams(searchKey),
        patch
      );
      if (projectId && !next.get("project")) next.set("project", projectId);
      const qs = next.toString();
      router.replace(qs ? `/runs/${runId}?${qs}` : `/runs/${runId}`, {
        scroll: false,
      });
    },
    [searchKey, router, projectId, runId]
  );

  // ---- search input (mirrors the runs list) ----
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
      pushParams({ query: value.trim() });
    }, SEARCH_DEBOUNCE_MS);
  }

  // ---- permissions ----
  const runOpen = run?.status === "open";
  const canManage = Boolean(project) && !archived && runOpen && canAssignItems(role);
  const canWriteRun = Boolean(project) && !archived && canWriteRuns(role);
  const canRecordBase =
    Boolean(project) && !archived && runOpen && canRecordResults(role);

  let recordBlockedReason: string | null = null;
  if (archived) {
    recordBlockedReason = "This project is archived — results are read-only.";
  } else if (!runOpen) {
    recordBlockedReason =
      "This run is completed. Reopen it to record results.";
  } else if (!canRecordResults(role)) {
    recordBlockedReason =
      "Viewers can't record results. Ask an Admin for the Tester role.";
  }

  // ---- assign dialog ----
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const assigneeOptions = useMemo<AssigneeOption[]>(() => {
    if (isAdmin) {
      return users
        .filter((entry) => entry.is_active && entry.role !== "viewer")
        .map((entry) => ({ id: entry.id, label: `${entry.name} (${entry.role})` }));
    }
    return existingAssigneeOptions(run?.assignee_ids ?? []);
  }, [isAdmin, users, run]);

  // The filter select must be able to show the id in the URL even when it is
  // not one we can name (or is no longer on the run).
  const assigneeSelectOptions = useMemo<AssigneeOption[]>(() => {
    const base = [...assigneeOptions];
    if (
      url.assignee &&
      url.assignee !== UNASSIGNED &&
      !base.some((option) => option.id === url.assignee)
    ) {
      base.unshift({ id: url.assignee, label: shortActorId(url.assignee) });
    }
    return base;
  }, [assigneeOptions, url.assignee]);

  async function submitAssign(assigneeId: string | null): Promise<void> {
    setAssignBusy(true);
    setAssignError(null);
    try {
      // No selection = the whole run (the documented default); otherwise only
      // the rows the Lead ticked (card 3.17).
      await api.assignRunItems(runId, {
        assignee_id: assigneeId,
        item_ids: selectedIds.size > 0 ? Array.from(selectedIds) : undefined,
      });
      setAssignOpen(false);
      clearSelection();
      setDataRetry((n) => n + 1);
    } catch (err) {
      if (isSessionDead(err)) {
        setAssignOpen(false);
        return;
      }
      if (err instanceof ApiError && err.status === 409) {
        setAssignError(
          "This run is completed, or the project is archived — items can no longer be assigned."
        );
      } else {
        setAssignError(
          errorMessage(err, "Couldn't assign the items. Please try again.")
        );
      }
    } finally {
      setAssignBusy(false);
    }
  }

  // ---- close / reopen ----
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  async function toggleRunStatus(): Promise<void> {
    if (!run) return;
    setStatusBusy(true);
    setStatusError(null);
    try {
      const updated =
        run.status === "open"
          ? await api.closeRun(runId)
          : await api.reopenRun(runId);
      setRunState({ kind: "ready", run: updated });
      setDataRetry((n) => n + 1);
    } catch (err) {
      if (isSessionDead(err)) return;
      if (err instanceof ApiError && err.status === 409) {
        setStatusError(
          `This run is already ${run.status === "open" ? "completed" : "open"}.`
        );
      } else {
        setStatusError(
          errorMessage(err, "Couldn't change the run status. Please try again.")
        );
      }
    } finally {
      setStatusBusy(false);
    }
  }

  // ---- drawer wiring ----
  const nextUntestedId = useMemo(() => {
    if (!itemId) return null;
    const index = rows.findIndex((row) => row.id === itemId);
    if (index < 0) return null;
    for (let i = index + 1; i < rows.length; i += 1) {
      const row = rows[i];
      if (row && row.status === "untested") return row.id;
    }
    return null;
  }, [rows, itemId]);

  const sortState = runItemSortState(url.sort);
  const dataSort: DataTableSort = { key: sortState.key, dir: sortState.dir };
  function onSortChange(next: DataTableSort | null): void {
    pushParams({
      sort: next ? runItemSortParam(next.key, next.dir) : DEFAULT_RUN_ITEM_SORT,
    });
  }

  // The Section filter offers only the suites this run actually has items
  // from (Run.suite_ids), in tree order. A suite with no items in the run
  // cannot filter anything but to zero rows, so it is not offered.
  const sectionOptions = useMemo(
    () => suitesInRun(suites, run?.suite_ids ?? []),
    [suites, run?.suite_ids]
  );
  const sectionMissing =
    Boolean(url.suite) &&
    !sectionOptions.some((entry) => entry.node.id === url.suite);

  const columns: DataTableColumn<RunItem>[] = [
    {
      key: "case_display_id",
      header: "ID",
      sortable: true,
      sortValue: (row) => row.case_display_id,
      className: "rd-col-id",
      render: (row) => <span className="t-nums">{row.case_display_id}</span>,
    },
    {
      key: "title",
      header: "Title",
      render: (row) => (
        <button
          type="button"
          className="rd-item-title"
          aria-label={`Open ${row.case_display_id} · ${row.case_title}`}
          onClick={() => pushParams({ item: row.id })}
        >
          {row.case_title}
        </button>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      sortValue: (row) => row.status,
      className: "rd-col-status",
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "assignee",
      header: "Assignee",
      className: "rd-col-assignee",
      render: (row) => {
        if (!row.assignee_id) return <span className="muted">—</span>;
        const name = userNames.get(row.assignee_id);
        if (name) return name;
        return (
          <span className="t-nums" title={row.assignee_id}>
            {shortActorId(row.assignee_id)}
          </span>
        );
      },
    },
    {
      key: "updated_at",
      header: "Updated",
      sortable: true,
      sortValue: (row) => row.updated_at,
      className: "rd-col-updated",
      render: (row) => {
        const stamp = describeTimestamp(row.updated_at);
        return (
          <time dateTime={row.updated_at} title={stamp.title}>
            {stamp.label}
          </time>
        );
      },
    },
  ];

  // ---- page-level states ----
  if (!runId || runState.kind === "loading" || projectState.kind === "loading") {
    return <RunDetailSkeleton />;
  }

  if (runState.kind === "not-found") {
    return (
      <div className="page">
        <div className="panel panel-error" role="alert">
          <h1>Run not found</h1>
          <p>This run does not exist, or it was deleted.</p>
          <p>
            <Link href="/runs">Back to runs</Link>
          </p>
        </div>
      </div>
    );
  }

  if (runState.kind === "error") {
    return (
      <div className="page">
        <div className="panel panel-error" role="alert">
          <h1>Couldn&apos;t load the run</h1>
          <p>{runState.message}</p>
          <p>
            <button type="button" onClick={() => setDataRetry((n) => n + 1)}>
              Retry
            </button>
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
            <button type="button" onClick={() => setProjectRetry((n) => n + 1)}>
              Retry
            </button>
          </p>
        </div>
      </div>
    );
  }

  // Both run and project are ready from here on.
  if (runState.kind !== "ready" || !run || !project) {
    return <RunDetailSkeleton />;
  }

  let readOnlyReason: string | null = null;
  if (archived) {
    readOnlyReason = "This project is archived — this run is read-only.";
  } else if (role === "viewer") {
    readOnlyReason =
      "Viewers can read this run but can't record results or assign items.";
  }

  const hasFilters =
    url.statuses.length > 0 ||
    Boolean(url.assignee) ||
    Boolean(url.suite) ||
    Boolean(url.query);

  let emptyTitle: ReactNode = "This run has no items yet.";
  let emptyBody: ReactNode = null;
  let emptyAction: ReactNode = null;
  if (hasFilters) {
    emptyTitle = "No items match your filters.";
    emptyBody = "Try a different search or filter, or clear them.";
    emptyAction = (
      <button
        type="button"
        onClick={() =>
          pushParams({
            statuses: [],
            assignee: null,
            suite: null,
            query: "",
            page: 1,
          })
        }
      >
        Clear filters
      </button>
    );
  } else if (canManage) {
    emptyBody = "Add cases to this run from the Cases screen.";
    emptyAction = (
      <Link href={`/cases?project=${projectId}`} className="button-link">
        Go to cases
      </Link>
    );
  } else {
    emptyBody = "A Lead or Admin adds cases to a run.";
  }

  const subtitleParts: ReactNode[] = [project.name];
  if (planName) subtitleParts.push(planName);
  if (run.milestone_id && run.milestone_name) {
    subtitleParts.push(
      <Link
        key="milestone"
        href={`/milestones/${run.milestone_id}?project=${projectId}`}
      >
        {run.milestone_name}
      </Link>
    );
  }
  if (run.start_date) subtitleParts.push(`Starts ${formatDateOnly(run.start_date)}`);
  if (run.due_date) subtitleParts.push(`Due ${formatDateOnly(run.due_date)}`);

  return (
    <div className="page run-detail-page">
      <p className="rd-back">
        <Link href={`/runs?project=${projectId}`}>← All runs</Link>
      </p>

      <div className="rd-heading">
        <div className="rd-heading-main">
          <h1 className="rd-title">{run.name}</h1>
          <span className={`rd-run-status rd-run-${run.status}`}>
            {RUN_STATUS_LABELS[run.status]}
          </span>
        </div>
        <div className="rd-heading-actions">
          <DisabledHint
            hint={
              !canManage
                ? archived
                  ? "This project is archived"
                  : !runOpen
                    ? "This run is completed"
                    : "Assigning needs the Admin or Lead role"
                : null
            }
          >
            <button
              type="button"
              className="secondary"
              disabled={!canManage}
              onClick={() => {
                setAssignError(null);
                setAssignOpen(true);
              }}
            >
              Assign
            </button>
          </DisabledHint>
          {canWriteRun && (
            <DisabledHint
              hint={statusBusy ? "Working — please wait" : null}
            >
              <button
                type="button"
                disabled={statusBusy}
                onClick={() => void toggleRunStatus()}
              >
                {run.status === "open" ? "Close run" : "Reopen"}
              </button>
            </DisabledHint>
          )}
        </div>
      </div>

      <p className="rd-subtitle">
        {subtitleParts.map((part, index) => (
          <span key={index}>
            {index > 0 && " · "}
            {part}
          </span>
        ))}
      </p>
      {readOnlyReason && <p className="rd-readonly">{readOnlyReason}</p>}

      <div className="rd-summary">
        <StatusPie counts={run.counts} label={run.name} />
        <StatusSummary counts={run.counts} />
      </div>

      {statusError && (
        <p className="form-error" role="alert">
          {statusError}
        </p>
      )}

      <div className="toolbar rd-toolbar">
        <div className="field">
          <label htmlFor="rd-status-filter">Status</label>
          <select
            id="rd-status-filter"
            value={url.statuses[0] ?? ""}
            onChange={(event) =>
              pushParams({
                statuses: event.target.value
                  ? [event.target.value as ItemStatus]
                  : [],
              })
            }
          >
            <option value="">All statuses</option>
            {ITEM_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="rd-assignee-filter">Assignee</label>
          <select
            id="rd-assignee-filter"
            value={url.assignee ?? ""}
            onChange={(event) =>
              pushParams({ assignee: event.target.value || null })
            }
          >
            <option value="">Anyone</option>
            <option value={UNASSIGNED}>Unassigned</option>
            {assigneeSelectOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="rd-section-filter">Section</label>
          <select
            id="rd-section-filter"
            value={url.suite ?? ""}
            onChange={(event) =>
              pushParams({ suite: event.target.value || null })
            }
          >
            <option value="">All sections</option>
            {sectionMissing && (
              <option value={url.suite ?? ""}>Selected section</option>
            )}
            {sectionOptions.map((entry) => (
              <option key={entry.node.id} value={entry.node.id}>
                {`${"— ".repeat(entry.level - 1)}${entry.node.name}`}
              </option>
            ))}
          </select>
        </div>
        <div className="field rd-field-grow">
          <label htmlFor="rd-search">Search by title</label>
          <input
            id="rd-search"
            type="search"
            placeholder="Search items"
            value={queryInput}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        caption={`Items in ${run.name}`}
        ariaLabel="Run items"
        selectable={canManage}
        selectedIds={selectedIds}
        onSelectedIdsChange={setSelectedIds}
        loading={itemsState.kind === "loading"}
        error={itemsState.kind === "error" ? itemsState.message : null}
        onRetry={() => setDataRetry((n) => n + 1)}
        emptyTitle={emptyTitle}
        emptyBody={emptyBody}
        emptyAction={emptyAction}
        sort={dataSort}
        onSortChange={onSortChange}
        rowHeight="default"
      />

      {meta && meta.total_pages > 1 && (
        <nav className="pagination" aria-label="Run item pages">
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
            Page {meta.page} of {meta.total_pages} ({meta.total} items)
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

      {assignOpen && (
        <AssignItemsDialog
          scopeLabel={
            selectedIds.size > 0
              ? `${selectedIds.size} selected item${
                  selectedIds.size === 1 ? "" : "s"
                }`
              : `All ${run.counts.total} item${
                  run.counts.total === 1 ? "" : "s"
                }`
          }
          options={assigneeOptions}
          limited={!isAdmin}
          busy={assignBusy}
          error={assignError}
          onSubmit={(assigneeId) => void submitAssign(assigneeId)}
          onCancel={() => setAssignOpen(false)}
        />
      )}

      {itemId && (
        <RunResultDrawer
          key={itemId}
          runId={runId}
          itemId={itemId}
          canRecord={canRecordBase}
          recordHint={recordBlockedReason}
          canManage={canManage}
          role={role}
          userId={userId}
          nextUntestedId={nextUntestedId}
          onClose={() => pushParams({ item: null })}
          onChanged={() => setDataRetry((n) => n + 1)}
          onSaveAndNext={() => pushParams({ item: nextUntestedId })}
          onRemoved={() => {
            setDataRetry((n) => n + 1);
            pushParams({ item: null });
          }}
        />
      )}
    </div>
  );
}

function RunDetailSkeleton() {
  return (
    <div className="page run-detail-page" aria-busy="true">
      <div className="rd-heading">
        <div className="rd-heading-main">
          <h1 className="rd-title">Run</h1>
        </div>
      </div>
      <p className="rd-subtitle">Loading run…</p>
      <TableSkeleton rows={8} columns={5} label="Loading run items" />
    </div>
  );
}