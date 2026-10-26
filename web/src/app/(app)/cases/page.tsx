"use client";

/**
 * Test cases — the two-pane cases screen (docs/DESIGN.md §4.2, backlog card
 * 3.2). Left: the suite tree (280px). Right: breadcrumb + Add case, filters
 * (or the bulk bar when rows are selected), the cases DataTable, and the
 * case drawer/editor.
 *
 * URL-as-state: ?project, ?suite (`all` = unscoped), ?case, ?query,
 * ?priority, ?type, ?tag, ?sort and ?page. Reading useSearchParams here is
 * safe because the (app) layout's AppShell suspends inside its own boundary.
 *
 * Roles: Admin/Lead write; Tester/Viewer read (the API enforces the same
 * matrix). Archived projects are read-only for everyone, including Admins.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CASE_TYPE_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  type CaseDetail,
  type CaseListItem,
  type Project,
  type SuiteNode,
} from "@/lib/api-types";
import { api } from "@/lib/endpoints";
import { ApiError } from "@/lib/api-error";
import { isSessionDead } from "@/components/require-auth";
import { useSession } from "@/lib/session";
import { canWriteCases, canWriteSuites } from "@/lib/case-permissions";
import {
  DEFAULT_CASE_SORT,
  caseSortParam,
  caseSortState,
  parseCaseListParams,
  patchCaseListParams,
  type CaseListUrlPatch,
} from "@/lib/case-url";
import { describeTimestamp } from "@/lib/dates";
import {
  findSuiteById,
  findSuitePath,
  moveDestinations,
  siblingsOf,
  suiteSearchOptions,
  type SuiteMoveRequest,
} from "@/lib/suites";
import {
  DataTable,
  DisabledHint,
  Drawer,
  PriorityIcon,
  TableSkeleton,
  type DataTableColumn,
  type DataTableSort,
} from "@/components/ui";
import { SuiteTree } from "@/components/suites/SuiteTree";
import { SuiteFormDialog } from "@/components/suites/SuiteFormDialog";
import { MoveDialog } from "@/components/cases/MoveDialog";
import {
  AddToRunDialog,
  addToRunNotice,
} from "@/components/cases/AddToRunDialog";
import { CaseDrawer } from "@/components/cases/CaseDrawer";
import { CaseEditor } from "@/components/cases/CaseEditor";
import { CaseFilters, type CaseFiltersPatch } from "@/components/cases/CaseFilters";
import { ConfirmDialog } from "@/components/confirm-dialog";
import "./cases.css";

const PAGE_SIZE = 25;
const EMPTY_SELECTION: ReadonlySet<string> = new Set();

type ProjectState =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "ready"; project: Project }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

type SuitesState =
  | { kind: "loading" }
  | { kind: "ready"; suites: SuiteNode[] }
  | { kind: "error"; message: string };

type CasesState =
  | { kind: "loading" }
  | {
      kind: "ready";
      rows: CaseListItem[];
      meta: { page: number; total: number; total_pages: number } | null;
    }
  | { kind: "error"; message: string };

type SuiteDialogState =
  | { mode: "create"; parentId: string | null }
  | { mode: "edit"; suite: SuiteNode };

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message || fallback : fallback;
}

function detailIssue(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    return err.details?.[0]?.issue ?? err.message ?? fallback;
  }
  return fallback;
}

export default function CasesPage() {
  const { user } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchKey = searchParams.toString();
  const url = useMemo(
    () => parseCaseListParams(new URLSearchParams(searchKey)),
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

  // No ?project= (direct link): resolve the first visible project and put it
  // in the URL so the shell's project-scoped nav agrees with this screen.
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
        router.replace(`/cases?${params.toString()}`, { scroll: false });
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
    canWriteCases(user!.role) &&
    canWriteSuites(user!.role);

  // ---- suites ----
  const [suitesState, setSuitesState] = useState<SuitesState>({
    kind: "loading",
  });
  const [suitesRetry, setSuitesRetry] = useState(0);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(
    new Set()
  );

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setSuitesState({ kind: "loading" });
      try {
        const suites = await api.listSuites(projectId);
        if (!active) return;
        setSuitesState({ kind: "ready", suites });
        setExpandedIds((current) => {
          if (current.size > 0) return current;
          return new Set(
            suites.filter((suite) => suite.children.length > 0).map((s) => s.id)
          );
        });
      } catch (err) {
        if (!active || isSessionDead(err)) return;
        setSuitesState({
          kind: "error",
          message: errorMessage(
            err,
            "Couldn't load suites. Check your connection and retry."
          ),
        });
      }
    })();
    return () => {
      active = false;
    };
  }, [projectId, suitesRetry]);

  const suites = suitesState.kind === "ready" ? suitesState.suites : [];
  const firstRootId = suites[0]?.id ?? null;

  /**
   * Absent ?suite defaults to the first root suite; `all` keeps the list
   * unscoped. `undefined` means "wait for the tree before fetching".
   */
  const effectiveSuite: string | null | undefined =
    url.suite === "all"
      ? null
      : url.suite
        ? url.suite
        : suitesState.kind === "ready"
          ? firstRootId
          : suitesState.kind === "error"
            ? null
            : undefined;
  const selectedSuiteId = effectiveSuite ?? null;
  const allSelected = url.suite === "all";

  const pushParams = useCallback(
    (patch: CaseListUrlPatch) => {
      const params = patchCaseListParams(
        new URLSearchParams(searchKey),
        patch
      );
      if (projectId && !params.get("project")) params.set("project", projectId);
      const qs = params.toString();
      router.replace(qs ? `/cases?${qs}` : "/cases", { scroll: false });
    },
    [searchKey, router, projectId]
  );

  useEffect(() => {
    if (suitesState.kind !== "ready" || url.suite || !firstRootId) return;
    pushParams({ suite: firstRootId });
  }, [suitesState, url.suite, firstRootId, pushParams]);

  // ---- cases ----
  const [casesState, setCasesState] = useState<CasesState>({
    kind: "loading",
  });
  const [casesRetry, setCasesRetry] = useState(0);

  /**
   * Selection is scoped to the current result set: a new suite/filter/sort/
   * page yields no selection, and the old ids are never carried silently
   * into a bulk action. Derived instead of cleared in an effect.
   */
  const resultKey = [
    effectiveSuite ?? "wait",
    url.query,
    url.priorities.join(","),
    url.types.join(","),
    url.tags.join(","),
    url.sort,
    url.page,
  ].join("|");
  const [selection, setSelection] = useState<{
    key: string;
    ids: ReadonlySet<string>;
  }>({ key: "", ids: EMPTY_SELECTION });
  const selectedIds =
    selection.key === resultKey ? selection.ids : EMPTY_SELECTION;
  const setSelectedIds = useCallback(
    (ids: ReadonlySet<string>) => {
      setSelection({ key: resultKey, ids });
    },
    [resultKey]
  );

  useEffect(() => {
    if (!projectId || effectiveSuite === undefined) return;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setCasesState({ kind: "loading" });
      try {
        const result = await api.listCases(projectId, {
          suite_id: effectiveSuite ?? undefined,
          include_descendants: effectiveSuite ? true : undefined,
          query: url.query || undefined,
          priority: url.priorities.length > 0 ? url.priorities : undefined,
          type: url.types.length > 0 ? url.types : undefined,
          tag: url.tags.length > 0 ? url.tags : undefined,
          sort: url.sort,
          page: url.page,
          limit: PAGE_SIZE,
        });
        if (!active) return;
        setCasesState({
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
        setCasesState({
          kind: "error",
          message: errorMessage(
            err,
            "Couldn't load cases. Check your connection and retry."
          ),
        });
      }
    })();
    return () => {
      active = false;
    };
  }, [
    projectId,
    effectiveSuite,
    url.query,
    url.priorities,
    url.types,
    url.tags,
    url.sort,
    url.page,
    casesRetry,
  ]);

  const rows = casesState.kind === "ready" ? casesState.rows : [];
  const meta = casesState.kind === "ready" ? casesState.meta : null;

  const reloadAll = useCallback(() => {
    setCasesRetry((n) => n + 1);
    setSuitesRetry((n) => n + 1);
  }, []);

  // ---- feedback / dialogs ----
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  /** Set by the New case editor: the form holds input worth confirming over. */
  const [caseFormDirty, setCaseFormDirty] = useState(false);
  const [confirmDiscardCase, setConfirmDiscardCase] = useState(false);
  /** A row the user asked to open while a dirty New case form was up. */
  const [pendingCaseId, setPendingCaseId] = useState<string | null>(null);
  const [suiteDialog, setSuiteDialog] = useState<SuiteDialogState | null>(null);
  const [suiteBusy, setSuiteBusy] = useState(false);
  const [suiteFieldErrors, setSuiteFieldErrors] = useState<{
    name?: string;
    description?: string;
  }>({});
  const [suiteFormError, setSuiteFormError] = useState<string | null>(null);
  const [suiteToDelete, setSuiteToDelete] = useState<SuiteNode | null>(null);
  const [suiteDeleteBusy, setSuiteDeleteBusy] = useState(false);
  const [suiteDeleteError, setSuiteDeleteError] = useState<string | null>(null);
  const [moveSuiteId, setMoveSuiteId] = useState<string | null>(null);
  const [moveSuiteBusy, setMoveSuiteBusy] = useState(false);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [bulkMoveBusy, setBulkMoveBusy] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false);
  const [addToRunOpen, setAddToRunOpen] = useState(false);
  const [addToRunBusy, setAddToRunBusy] = useState(false);
  const [addToRunError, setAddToRunError] = useState<string | null>(null);

  function flash(message: string): void {
    setNotice(message);
    setActionError(null);
  }

  function fail(message: string): void {
    setActionError(message);
    setNotice(null);
  }

  // ---- suite actions ----
  function openCreateSuite(parentId: string | null): void {
    if (!canWrite) return;
    setSuiteFieldErrors({});
    setSuiteFormError(null);
    setSuiteDialog({ mode: "create", parentId });
  }

  function openRenameSuite(suite: SuiteNode): void {
    if (!canWrite) return;
    setSuiteFieldErrors({});
    setSuiteFormError(null);
    setSuiteDialog({ mode: "edit", suite });
  }

  async function submitSuite(values: {
    name: string;
    description: string;
  }): Promise<void> {
    if (!suiteDialog || !projectId) return;
    setSuiteBusy(true);
    setSuiteFieldErrors({});
    setSuiteFormError(null);
    try {
      if (suiteDialog.mode === "edit") {
        const saved = await api.updateSuite(suiteDialog.suite.id, {
          name: values.name,
          description: values.description || null,
        });
        flash(`Suite “${saved.name}” renamed.`);
        setSuiteDialog(null);
      } else {
        const created = await api.createSuite(projectId, {
          name: values.name,
          ...(values.description ? { description: values.description } : {}),
          ...(suiteDialog.parentId
            ? { parent_id: suiteDialog.parentId }
            : {}),
        });
        flash(`Suite “${created.name}” created.`);
        setSuiteDialog(null);
        if (created.parent_id) {
          setExpandedIds((current) =>
            new Set(current).add(created.parent_id as string)
          );
        }
        pushParams({ suite: created.id, caseId: null });
      }
      reloadAll();
    } catch (err) {
      if (isSessionDead(err)) {
        setSuiteDialog(null);
        return;
      }
      const fieldErrors: { name?: string; description?: string } = {};
      let form: string | null = null;
      for (const detail of err instanceof ApiError ? (err.details ?? []) : []) {
        if (detail.field === "name" || detail.field === "description") {
          fieldErrors[detail.field] = detail.issue;
        } else {
          form = detail.issue;
        }
      }
      setSuiteFieldErrors(fieldErrors);
      setSuiteFormError(
        form ??
          (Object.keys(fieldErrors).length === 0
            ? errorMessage(err, "Could not save the suite. Please try again.")
            : null)
      );
    } finally {
      setSuiteBusy(false);
    }
  }

  async function confirmDeleteSuite(): Promise<void> {
    if (!suiteToDelete) return;
    setSuiteDeleteBusy(true);
    setSuiteDeleteError(null);
    try {
      await api.deleteSuite(suiteToDelete.id);
      flash(`Suite “${suiteToDelete.name}” deleted.`);
      setSuiteToDelete(null);
      if (url.suite === suiteToDelete.id) {
        pushParams({ suite: null, caseId: null });
      }
      reloadAll();
    } catch (err) {
      if (isSessionDead(err)) {
        setSuiteToDelete(null);
        return;
      }
      setSuiteDeleteError(
        detailIssue(err, "Could not delete the suite. Please try again.")
      );
    } finally {
      setSuiteDeleteBusy(false);
    }
  }

  async function moveSuite(request: SuiteMoveRequest): Promise<void> {
    setActionError(null);
    try {
      await api.updateSuite(request.id, {
        parent_id: request.parentId,
        position: request.position,
      });
      if (request.parentId) {
        setExpandedIds((current) => new Set(current).add(request.parentId!));
      }
      flash("Suite moved.");
      reloadAll();
    } catch (err) {
      if (isSessionDead(err)) return;
      fail(detailIssue(err, "Could not move the suite. Please try again."));
    }
  }

  async function runMoveSuite(destination: string): Promise<void> {
    if (!moveSuiteId) return;
    const destinationParent = destination === "__root__" ? null : destination;
    const moving = findSuiteById(suites, moveSuiteId);
    setMoveSuiteBusy(true);
    try {
      const siblings = siblingsOf(suites, destinationParent).filter(
        (suite) => suite.id !== moveSuiteId
      );
      await api.updateSuite(moveSuiteId, {
        parent_id: destinationParent,
        position: siblings.length + 1,
      });
      setMoveSuiteId(null);
      if (destinationParent) {
        setExpandedIds((current) => new Set(current).add(destinationParent));
      }
      flash(`Suite “${moving?.name ?? "Suite"}” moved.`);
      reloadAll();
    } catch (err) {
      if (isSessionDead(err)) {
        setMoveSuiteId(null);
        return;
      }
      setMoveSuiteId(null);
      fail(detailIssue(err, "Could not move the suite. Please try again."));
    } finally {
      setMoveSuiteBusy(false);
    }
  }

  // ---- case actions ----
  /** Tear down the New case drawer and every bit of discard-confirm state. */
  function closeCreateCase(): void {
    setCreating(false);
    setCaseFormDirty(false);
    setConfirmDiscardCase(false);
    setPendingCaseId(null);
  }

  /**
   * A dismissal the user asked for (drawer X, Esc, Cancel). A form with
   * unsaved input is not thrown away silently — confirm first.
   */
  function requestCloseCreateCase(): void {
    if (caseFormDirty) {
      setPendingCaseId(null);
      setConfirmDiscardCase(true);
      return;
    }
    closeCreateCase();
  }

  /** "Discard" in the confirm dialog: drop the form, then honour the intent. */
  function confirmDiscardCreateCase(): void {
    const next = pendingCaseId;
    closeCreateCase();
    if (next) pushParams({ caseId: next });
  }

  function openCase(id: string): void {
    // The case drawer and the New case drawer share the one right-hand slot
    // (docs/DESIGN.md §5 "Drawer"), so opening a case must close a New case
    // form that is already open — otherwise the two panels overlap. A form
    // with input is not discarded silently: confirm, then open the case.
    if (creating && caseFormDirty) {
      setPendingCaseId(id);
      setConfirmDiscardCase(true);
      return;
    }
    closeCreateCase();
    pushParams({ caseId: id });
  }

  function closeCase(): void {
    pushParams({ caseId: null });
  }

  const createDefaultSuiteId = effectiveSuite ?? firstRootId ?? "";

  function openCreateCase(): void {
    if (!canWrite || !createDefaultSuiteId) return;
    // Same slot: close the open case drawer before showing the New case form.
    if (url.caseId) pushParams({ caseId: null });
    closeCreateCase();
    setCreating(true);
    setActionError(null);
    setNotice(null);
  }

  function onCaseSaved(detail: CaseDetail, mode: "create" | "edit"): void {
    if (mode === "create") closeCreateCase();
    flash(
      mode === "create"
        ? `Case ${detail.display_id} added.`
        : `Case ${detail.display_id} saved.`
    );
    reloadAll();
  }

  function onCaseDeleted(detail: CaseDetail): void {
    flash(`Case ${detail.display_id} deleted.`);
    reloadAll();
  }

  function applyFilters(patch: CaseFiltersPatch): void {
    pushParams({
      query: patch.query ?? url.query,
      priorities: patch.priorities ?? url.priorities,
      types: patch.types ?? url.types,
      tags: patch.tags ?? url.tags,
      page: 1,
    });
  }

  const sortState = caseSortState(url.sort);
  const dataSort: DataTableSort = {
    key: sortState.key,
    dir: sortState.dir,
  };

  function onSortChange(next: DataTableSort | null): void {
    pushParams({
      sort: next ? caseSortParam(next.key, next.dir) : DEFAULT_CASE_SORT,
      page: 1,
    });
  }

  const columns: DataTableColumn<CaseListItem>[] = [
    {
      key: "case_number",
      header: "ID",
      sortable: true,
      sortValue: (row) => row.case_number,
      render: (row) => <code className="case-id">{row.display_id}</code>,
    },
    {
      key: "title",
      header: "Title",
      sortable: true,
      sortValue: (row) => row.title,
      render: (row) => (
        <button
          type="button"
          className="case-title-link"
          aria-label={`Open ${row.display_id}: ${row.title}`}
          onClick={() => openCase(row.id)}
        >
          {row.title}
        </button>
      ),
    },
    {
      key: "priority",
      header: "Priority",
      sortable: true,
      // Severity order happens server-side (sort=priority), so pagination
      // never reorders a single page. This value only matters if the table
      // ever sorts client-side.
      sortValue: (row) => PRIORITIES.indexOf(row.priority),
      render: (row) => (
        <span className="case-priority">
          <PriorityIcon priority={row.priority} />{" "}
          {PRIORITY_LABELS[row.priority]}
        </span>
      ),
    },
    {
      key: "type",
      header: "Type",
      className: "case-col-type",
      render: (row) => CASE_TYPE_LABELS[row.type],
    },
    {
      key: "step_count",
      header: "Steps",
      align: "number",
      render: (row) => row.step_count,
    },
    {
      key: "updated_at",
      header: "Updated",
      className: "case-col-updated",
      sortable: true,
      sortValue: (row) => row.updated_at,
      render: (row) => {
        const updated = describeTimestamp(row.updated_at);
        return (
          <time dateTime={row.updated_at} title={updated.title}>
            {updated.label}
          </time>
        );
      },
    },
  ];

  const path = findSuitePath(suites, selectedSuiteId);
  const availableTags = Array.from(
    new Set(rows.flatMap((row) => row.tags))
  ).sort((a, b) => a.localeCompare(b));
  const allCaseCount = suites.reduce(
    (total, suite) => total + suite.case_count,
    0
  );
  const hasFilters =
    Boolean(url.query) ||
    url.priorities.length > 0 ||
    url.types.length > 0 ||
    url.tags.length > 0;

  async function runBulkMove(suiteId: string): Promise<void> {
    if (!projectId || selectedIds.size === 0) return;
    setBulkMoveBusy(true);
    const ids = Array.from(selectedIds);
    try {
      const result = await api.bulkMoveCases(projectId, {
        case_ids: ids,
        suite_id: suiteId,
      });
      setBulkMoveOpen(false);
      setSelectedIds(new Set());
      flash(
        `${result.moved} case${result.moved === 1 ? "" : "s"} moved.`
      );
      reloadAll();
    } catch (err) {
      if (isSessionDead(err)) {
        setBulkMoveOpen(false);
        return;
      }
      setBulkMoveOpen(false);
      fail(detailIssue(err, "Could not move the selected cases."));
    } finally {
      setBulkMoveBusy(false);
    }
  }

  async function runAddToRun(runId: string, runName: string): Promise<void> {
    if (selectedIds.size === 0) return;
    setAddToRunBusy(true);
    setAddToRunError(null);
    try {
      const result = await api.addRunItems(runId, {
        case_ids: Array.from(selectedIds),
      });
      setAddToRunOpen(false);
      setSelectedIds(new Set());
      flash(addToRunNotice(result, runName));
    } catch (err) {
      if (isSessionDead(err)) {
        setAddToRunOpen(false);
        return;
      }
      setAddToRunError(
        detailIssue(err, "Could not add the selected cases to the run.")
      );
    } finally {
      setAddToRunBusy(false);
    }
  }

  async function runBulkDelete(): Promise<void> {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkDeleteBusy(true);
    let deleted = 0;
    let failure: unknown = null;
    for (const id of ids) {
      try {
        await api.deleteCase(id);
        deleted += 1;
      } catch (err) {
        failure = err;
        break;
      }
    }
    setBulkDeleteBusy(false);
    setBulkDeleteOpen(false);
    setSelectedIds(new Set());
    reloadAll();
    if (failure) {
      if (isSessionDead(failure)) return;
      fail(
        `${deleted} of ${ids.length} cases deleted. ${detailIssue(
          failure,
          "Please try again."
        )}`
      );
    } else {
      flash(`${deleted} case${deleted === 1 ? "" : "s"} deleted.`);
    }
  }

  const movingSuite = findSuiteById(suites, moveSuiteId);
  const moveSuiteOptions = moveSuiteId
    ? moveDestinations(suites, moveSuiteId).map((destination) => ({
        value: destination.parentId ?? "__root__",
        label: destination.label,
      }))
    : [];
  const bulkSuiteOptions = suiteSearchOptions(suites).map((option) => ({
    value: option.id,
    label: option.label,
    depth: option.depth,
    path: option.path,
  }));
  const bulkInitialSuite =
    selectedSuiteId && findSuiteById(suites, selectedSuiteId)
      ? selectedSuiteId
      : firstRootId ?? "";

  const selectedCount = selectedIds.size;
  const suiteLabel =
    effectiveSuite === null
      ? "All suites"
      : (findSuiteById(suites, selectedSuiteId)?.name ?? "Suite");

  // ---- project-level states ----
  if (projectState.kind === "loading") {
    return <CasesSkeleton />;
  }

  if (projectState.kind === "none") {
    return (
      <div className="page">
        <h1>Test cases</h1>
        <div className="panel">
          <p>
            <strong>No projects yet.</strong> Create a project to start
            organising test cases.
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
    ? "This project is archived. Cases and suites are read-only."
    : !canWrite
      ? "Read-only: adding or editing cases needs the Admin or Lead role."
      : null;

  let emptyTitle: ReactNode = `No cases in ${suiteLabel}.`;
  let emptyBody: ReactNode = null;
  let emptyAction: ReactNode = null;
  if (hasFilters) {
    emptyTitle = "No cases match your filters.";
    emptyBody = "Try a different search, or clear the filters.";
    emptyAction = (
      <button
        type="button"
        onClick={() =>
          pushParams({
            query: "",
            priorities: [],
            types: [],
            tags: [],
            page: 1,
          })
        }
      >
        Clear filters
      </button>
    );
  } else if (canWrite) {
    emptyBody = "Add a case to this suite, or choose another suite.";
    emptyAction = createDefaultSuiteId ? (
      <button type="button" className="primary" onClick={openCreateCase}>
        Add case
      </button>
    ) : (
      <button type="button" onClick={() => openCreateSuite(null)}>
        Add suite
      </button>
    );
  }

  return (
    <div className="cases-layout">
      <SuiteTree
        nodes={suites}
        selectedId={selectedSuiteId}
        expandedIds={expandedIds}
        onSelect={(id) =>
          pushParams({ suite: id, caseId: null, page: 1 })
        }
        onToggle={(id) => {
          setExpandedIds((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          });
        }}
        onMove={canWrite ? (request) => void moveSuite(request) : undefined}
        onRequestMove={
          canWrite
            ? (id) => {
                setActionError(null);
                setMoveSuiteId(id);
              }
            : undefined
        }
        onAddSuite={canWrite ? openCreateSuite : undefined}
        onRenameSuite={canWrite ? openRenameSuite : undefined}
        onDeleteSuite={
          canWrite
            ? (suite) => {
                setSuiteDeleteError(null);
                setSuiteToDelete(suite);
              }
            : undefined
        }
        onSelectAll={() =>
          pushParams({ suite: "all", caseId: null, page: 1 })
        }
        allSelected={allSelected}
        totalCount={allCaseCount}
        loading={suitesState.kind === "loading"}
        error={suitesState.kind === "error" ? suitesState.message : null}
        onRetry={() => setSuitesRetry((n) => n + 1)}
      />

      <section className="cases-main" aria-label="Cases">
        <header className="cases-header">
          <div className="cases-heading">
            <h1>Test cases</h1>
            <p className="cases-breadcrumb">
              <span>{project?.name ?? "Project"}</span>
              {effectiveSuite === null ? (
                <>
                  <span aria-hidden="true"> › </span>
                  <span>All suites</span>
                </>
              ) : (
                path.map((entry) => (
                  <span key={entry.id}>
                    <span aria-hidden="true"> › </span>
                    <span>{entry.name}</span>
                  </span>
                ))
              )}
            </p>
            {readOnlyReason && (
              <p className="cases-readonly">{readOnlyReason}</p>
            )}
          </div>
          {canWrite && (
            <DisabledHint
              hint={
                createDefaultSuiteId
                  ? "Add a case to the selected suite"
                  : "Add a suite first, then you can add cases to it"
              }
            >
              <button
                type="button"
                className="primary"
                onClick={openCreateCase}
                disabled={!createDefaultSuiteId}
              >
                Add case
              </button>
            </DisabledHint>
          )}
        </header>

        {(notice || actionError) && (
          <div className="cases-feedback">
            {notice && (
              <p className="form-notice" role="status">
                <span className="feedback-text">{notice}</span>
                <button
                  type="button"
                  className="feedback-dismiss"
                  aria-label="Dismiss notification"
                  title="Dismiss"
                  onClick={() => setNotice(null)}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </p>
            )}
            {actionError && (
              <p className="form-error" role="alert">
                <span className="feedback-text">{actionError}</span>
                <button
                  type="button"
                  className="feedback-dismiss"
                  aria-label="Dismiss error"
                  title="Dismiss"
                  onClick={() => setActionError(null)}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </p>
            )}
          </div>
        )}

        {selectedCount > 0 ? (
          <div className="bulk-bar" role="region" aria-label="Selected cases">
            <span>
              <strong className="t-nums">{selectedCount}</strong> selected
            </span>
            <DisabledHint
              hint={
                !canWrite
                  ? "You need the Admin or Lead role to move cases"
                  : bulkSuiteOptions.length === 0
                    ? "Nowhere to move them yet — add another suite first"
                    : "Move the selected cases to another suite"
              }
            >
              <button
                type="button"
                onClick={() => setBulkMoveOpen(true)}
                disabled={!canWrite || bulkSuiteOptions.length === 0}
              >
                Move…
              </button>
            </DisabledHint>
            <DisabledHint
              hint={
                canWrite
                  ? "Add the selected cases to an open run"
                  : "You need the Admin or Lead role to add cases to a run"
              }
            >
              <button
                type="button"
                onClick={() => {
                  setAddToRunError(null);
                  setAddToRunOpen(true);
                }}
                disabled={!canWrite}
              >
                Add to run…
              </button>
            </DisabledHint>
            <DisabledHint
              hint={
                canWrite
                  ? "Delete the selected cases"
                  : "You need the Admin or Lead role to delete cases"
              }
            >
              <button
                type="button"
                className="danger"
                onClick={() => setBulkDeleteOpen(true)}
                disabled={!canWrite}
              >
                Delete…
              </button>
            </DisabledHint>
            <button
              type="button"
              className="linklike"
              onClick={() => setSelectedIds(new Set())}
            >
              Clear selection
            </button>
          </div>
        ) : (
          <CaseFilters
            query={url.query}
            priorities={url.priorities}
            types={url.types}
            tags={url.tags}
            availableTags={availableTags}
            resultCount={meta?.total ?? (casesState.kind === "ready" ? rows.length : null)}
            onChange={applyFilters}
          />
        )}

        <div className="cases-table-scroll">
          <DataTable
            columns={columns}
            rows={rows}
            getRowId={(row) => row.id}
            caption={`Test cases in ${suiteLabel}`}
            ariaLabel="Test cases"
            loading={casesState.kind === "loading"}
            error={casesState.kind === "error" ? casesState.message : null}
            onRetry={() => setCasesRetry((n) => n + 1)}
            emptyTitle={emptyTitle}
            emptyBody={emptyBody}
            emptyAction={emptyAction}
            selectable
            selectedIds={selectedIds}
            onSelectedIdsChange={setSelectedIds}
            sort={dataSort}
            onSortChange={onSortChange}
            rowHeight="default"
          />
        </div>

        {meta && meta.total_pages > 1 && (
          <nav className="pagination cases-pagination" aria-label="Case pages">
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
              Page {meta.page} of {meta.total_pages} ({meta.total} cases)
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
      </section>

      {url.caseId && (
        <CaseDrawer
          key={url.caseId}
          projectId={projectId}
          caseId={url.caseId}
          suites={suites}
          canWrite={canWrite}
          onClose={closeCase}
          onChanged={(detail) => {
            setCasesState((current) =>
              current.kind === "ready"
                ? {
                    ...current,
                    rows: current.rows.map((row) =>
                      row.id === detail.id
                        ? {
                            ...row,
                            title: detail.title,
                            priority: detail.priority,
                            type: detail.type,
                            tags: detail.tags,
                            estimate_minutes: detail.estimate_minutes,
                            updated_at: detail.updated_at,
                          }
                        : row
                    ),
                  }
                : current
            );
            reloadAll();
          }}
          onDeleted={onCaseDeleted}
        />
      )}

      {creating && (
        <Drawer title="New case" onClose={requestCloseCreateCase}>
          <CaseEditor
            projectId={projectId}
            suites={suites}
            defaultSuiteId={createDefaultSuiteId}
            onSaved={onCaseSaved}
            onCancel={requestCloseCreateCase}
            onDirtyChange={setCaseFormDirty}
          />
        </Drawer>
      )}

      {confirmDiscardCase && (
        <ConfirmDialog
          title="Discard this new case?"
          body="This new case has unsaved changes. Closing it will discard them."
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          danger
          onConfirm={confirmDiscardCreateCase}
          onCancel={() => {
            setConfirmDiscardCase(false);
            setPendingCaseId(null);
          }}
        />
      )}

      {suiteDialog && (
        <SuiteFormDialog
          mode={suiteDialog.mode}
          suite={suiteDialog.mode === "edit" ? suiteDialog.suite : null}
          parentName={
            suiteDialog.mode === "create" && suiteDialog.parentId
              ? (findSuiteById(suites, suiteDialog.parentId)?.name ?? null)
              : null
          }
          busy={suiteBusy}
          serverFieldErrors={suiteFieldErrors}
          formError={suiteFormError}
          onSubmit={(values) => void submitSuite(values)}
          onCancel={() => setSuiteDialog(null)}
        />
      )}

      {suiteToDelete && (
        <ConfirmDialog
          title="Delete suite?"
          body={
            <>
              <p>
                <strong>{suiteToDelete.name}</strong> is empty, so no cases or
                child suites are affected. This cannot be undone.
              </p>
              {suiteDeleteError && (
                <p className="form-error" role="alert">
                  {suiteDeleteError}
                </p>
              )}
            </>
          }
          confirmLabel="Delete suite"
          danger
          busy={suiteDeleteBusy}
          onConfirm={() => void confirmDeleteSuite()}
          onCancel={() => {
            setSuiteDeleteError(null);
            setSuiteToDelete(null);
          }}
        />
      )}

      {movingSuite && moveSuiteOptions.length > 0 && (
        <MoveDialog
          title="Move suite"
          description={
            <p className="field-hint">
              Moving <strong>{movingSuite.name}</strong> keeps its cases and
              child suites. Choose a new parent.
            </p>
          }
          label="Destination"
          options={moveSuiteOptions}
          initialValue={movingSuite.parent_id ?? "__root__"}
          confirmLabel="Move suite"
          busy={moveSuiteBusy}
          onConfirm={(value) => void runMoveSuite(value)}
          onCancel={() => setMoveSuiteId(null)}
        />
      )}

      {bulkMoveOpen && bulkSuiteOptions.length > 0 && (
        <MoveDialog
          title="Move cases"
          description={
            <p className="field-hint">
              Move <strong>{selectedCount}</strong> selected case
              {selectedCount === 1 ? "" : "s"} to another suite.
            </p>
          }
          label="Destination suite"
          options={bulkSuiteOptions}
          initialValue={bulkInitialSuite}
          confirmLabel="Move cases"
          busy={bulkMoveBusy}
          searchable
          onConfirm={(value) => void runBulkMove(value)}
          onCancel={() => setBulkMoveOpen(false)}
        />
      )}

      {addToRunOpen && (
        <AddToRunDialog
          projectId={projectId}
          caseCount={selectedCount}
          busy={addToRunBusy}
          error={addToRunError}
          onSubmit={(runId, runName) => void runAddToRun(runId, runName)}
          onCancel={() => setAddToRunOpen(false)}
        />
      )}

      {bulkDeleteOpen && (
        <ConfirmDialog
          title={`Delete ${selectedCount} case${selectedCount === 1 ? "" : "s"}?`}
          body={
            <p>
              The selected case{selectedCount === 1 ? "" : "s"} will be removed
              from lists, filters and reports. Case numbers stay reserved and
              their history is kept.
            </p>
          }
          confirmLabel={
            selectedCount === 1 ? "Delete case" : `Delete ${selectedCount} cases`
          }
          danger
          busy={bulkDeleteBusy}
          onConfirm={() => void runBulkDelete()}
          onCancel={() => setBulkDeleteOpen(false)}
        />
      )}
    </div>
  );
}

function CasesSkeleton() {
  return (
    <div className="cases-layout" aria-busy="true">
      <aside className="suite-pane cases-tree-skeleton" aria-label="Suites">
        <div className="suite-pane-header">
          <h2>Suites</h2>
        </div>
        <div className="suite-tree-state" role="status" aria-live="polite">
          <span className="suite-skeleton" />
          <span className="suite-skeleton" />
          <span className="suite-skeleton" />
          <span className="sr-only">Loading suites…</span>
        </div>
      </aside>
      <section className="cases-main" aria-label="Cases">
        <header className="cases-header">
          <div className="cases-heading">
            <h1>Test cases</h1>
            <p className="cases-breadcrumb">Loading project…</p>
          </div>
        </header>
        <div className="cases-table-scroll">
          <TableSkeleton rows={6} columns={6} label="Loading test cases" />
        </div>
      </section>
    </div>
  );
}
