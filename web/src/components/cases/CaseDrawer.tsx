"use client";

/**
 * CaseDrawer — the 480px case detail surface (DESIGN §4.2, §5 "Drawer"):
 * tabs for Details, History and Linked runs, with the editor opening in the
 * same surface.
 *
 * - Details: the contract's Case detail, rendered as readable metadata, a
 *   numbered step list and preconditions.
 * - History: GET /cases/:id/history, paginated, one line per changed field
 *   (no raw JSON).
 * - Linked runs: GET /cases/:id/runs, paginated — every run that contains the
 *   case, with the case's status inside it and a link to the run.
 * - §6 states for every load; destructive delete asks first and names the
 *   case. Esc/focus return live in the shared Drawer primitive.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import {
  PRIORITY_LABELS,
  CASE_TYPE_LABELS,
  RUN_STATUS_LABELS,
  type CaseDetail,
  type CaseHistoryEntry,
  type LinkedRun,
  type SuiteNode,
} from "@/lib/api-types";
import { api } from "@/lib/endpoints";
import { ApiError } from "@/lib/api-error";
import { isSessionDead } from "@/components/require-auth";
import { Drawer } from "@/components/ui";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PriorityIcon, StatusBadge } from "@/components/ui";
import { formatEstimateInput } from "@/lib/case-form";
import {
  CASE_ACTION_LABELS,
  describeCaseChanges,
  shortActorId,
} from "@/lib/case-history";
import { describeTimestamp } from "@/lib/dates";
import { findSuiteById } from "@/lib/suites";
import { CaseEditor } from "./CaseEditor";
import "./CaseDrawer.css";

type TabId = "details" | "history" | "linked";

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: "details", label: "Details" },
  { id: "history", label: "History" },
  { id: "linked", label: "Linked runs" },
];

type DetailState =
  | { kind: "loading" }
  | { kind: "ready"; detail: CaseDetail }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

interface HistoryState {
  entries: CaseHistoryEntry[];
  page: number;
  totalPages: number;
  total: number;
}

interface LinkedRunsState {
  entries: LinkedRun[];
  page: number;
  totalPages: number;
  total: number;
}

export interface CaseDrawerProps {
  projectId: string;
  caseId: string;
  suites: readonly SuiteNode[];
  canWrite: boolean;
  onClose: () => void;
  /** Lists and suite counts need refreshing after an edit/move. */
  onChanged: (detail: CaseDetail) => void;
  onDeleted: (detail: CaseDetail) => void;
}

export function CaseDrawer({
  projectId,
  caseId,
  suites,
  canWrite,
  onClose,
  onChanged,
  onDeleted,
}: CaseDrawerProps) {
  const [state, setState] = useState<DetailState>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  const [tab, setTab] = useState<TabId>("details");
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const tabRefs = useRef(new Map<TabId, HTMLButtonElement>());

  const [historyPage, setHistoryPage] = useState(1);
  const [history, setHistory] = useState<HistoryState | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyRetry, setHistoryRetry] = useState(0);

  const [linkedPage, setLinkedPage] = useState(1);
  const [linked, setLinked] = useState<LinkedRunsState | null>(null);
  const [linkedLoading, setLinkedLoading] = useState(false);
  const [linkedError, setLinkedError] = useState<string | null>(null);
  const [linkedRetry, setLinkedRetry] = useState(0);

  // The drawer is keyed by caseId, so a different case remounts this
  // component and every block starts fresh (no reset-in-effect needed).
  useEffect(() => {
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setState({ kind: "loading" });
      setActionError(null);
      try {
        const detail = await api.getCase(caseId);
        if (active) setState({ kind: "ready", detail });
      } catch (err) {
        if (!active || isSessionDead(err)) return;
        if (err instanceof ApiError && err.status === 404) {
          setState({ kind: "not-found" });
        } else {
          setState({
            kind: "error",
            message:
              err instanceof ApiError
                ? err.message
                : "Could not load the case. Please try again.",
          });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [caseId, retry]);

  useEffect(() => {
    if (tab !== "history") return;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setHistoryLoading(true);
      setHistoryError(null);
      try {
        const result = await api.listCaseHistory(caseId, {
          page: historyPage,
          limit: 25,
        });
        if (!active) return;
        setHistory({
          entries: result.data,
          page: result.meta?.page ?? historyPage,
          totalPages: result.meta?.total_pages ?? 1,
          total: result.meta?.total ?? result.data.length,
        });
      } catch (err) {
        if (!active || isSessionDead(err)) return;
        setHistoryError(
          err instanceof ApiError
            ? err.message
            : "Could not load history. Check your connection and retry."
        );
      } finally {
        if (active) setHistoryLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [tab, caseId, historyPage, historyRetry]);

  useEffect(() => {
    if (tab !== "linked") return;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setLinkedLoading(true);
      setLinkedError(null);
      try {
        const result = await api.listCaseRuns(caseId, {
          page: linkedPage,
          limit: 25,
        });
        if (!active) return;
        setLinked({
          entries: result.data,
          page: result.meta?.page ?? linkedPage,
          totalPages: result.meta?.total_pages ?? 1,
          total: result.meta?.total ?? result.data.length,
        });
      } catch (err) {
        if (!active || isSessionDead(err)) return;
        setLinkedError(
          err instanceof ApiError
            ? err.message
            : "Could not load linked runs. Check your connection and retry."
        );
      } finally {
        if (active) setLinkedLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [tab, caseId, linkedPage, linkedRetry]);

  const detail = state.kind === "ready" ? state.detail : null;
  const title = editing && detail
    ? `Edit ${detail.display_id}`
    : detail
      ? `${detail.display_id} · ${detail.title}`
      : "Case";

  function onTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number
  ): void {
    const last = TABS.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = index === last ? 0 : index + 1;
    else if (event.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    if (next === null) return;
    event.preventDefault();
    const target = TABS[next];
    if (!target) return;
    setTab(target.id);
    tabRefs.current.get(target.id)?.focus();
  }

  async function confirmDeleteCase(): Promise<void> {
    if (!detail) return;
    setDeleting(true);
    setActionError(null);
    try {
      await api.deleteCase(detail.id);
      setConfirmDelete(false);
      onDeleted(detail);
      onClose();
    } catch (err) {
      if (isSessionDead(err)) {
        setConfirmDelete(false);
        return;
      }
      setActionError(
        err instanceof ApiError && err.status === 409
          ? err.message || "This project is archived. Editing is disabled."
          : "Could not delete the case. Please try again."
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Drawer title={title} onClose={onClose}>
        {state.kind === "loading" && (
          <div className="drawer-state" role="status" aria-live="polite">
            <span className="drawer-skeleton" />
            <span className="drawer-skeleton" />
            <span className="drawer-skeleton" />
            <span className="sr-only">Loading case…</span>
          </div>
        )}

        {state.kind === "not-found" && (
          <div className="drawer-state" role="alert">
            <p>
              <strong>Case not found.</strong>
            </p>
            <p>It may have been deleted.</p>
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        )}

        {state.kind === "error" && (
          <div className="drawer-state" role="alert">
            <p>{state.message}</p>
            <button type="button" onClick={() => setRetry((n) => n + 1)}>
              Retry
            </button>
          </div>
        )}

        {state.kind === "ready" && editing && (
          <CaseEditor
            projectId={projectId}
            suites={suites}
            detail={state.detail}
            defaultSuiteId={state.detail.suite_id ?? ""}
            onSaved={(saved) => {
              setState({ kind: "ready", detail: saved });
              setEditing(false);
              onChanged(saved);
            }}
            onCancel={() => setEditing(false)}
          />
        )}

        {state.kind === "ready" && !editing && (
          <>
            <div className="case-tabs" role="tablist" aria-label="Case detail">
              {TABS.map((item, index) => (
                <button
                  key={item.id}
                  ref={(element) => {
                    if (element) tabRefs.current.set(item.id, element);
                    else tabRefs.current.delete(item.id);
                  }}
                  type="button"
                  role="tab"
                  id={`case-tab-${item.id}`}
                  aria-selected={tab === item.id}
                  aria-controls={`case-panel-${item.id}`}
                  tabIndex={tab === item.id ? 0 : -1}
                  className={tab === item.id ? "case-tab is-active" : "case-tab"}
                  onClick={() => setTab(item.id)}
                  onKeyDown={(event) => onTabKeyDown(event, index)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {actionError && (
              <p className="form-error" role="alert">
                {actionError}
              </p>
            )}

            {tab === "details" && (
              <div
                role="tabpanel"
                id="case-panel-details"
                aria-labelledby="case-tab-details"
              >
                <CaseDetails
                  detail={state.detail}
                  suites={suites}
                  canWrite={canWrite}
                  onEdit={() => {
                    setActionError(null);
                    setEditing(true);
                  }}
                  onDelete={() => {
                    setActionError(null);
                    setConfirmDelete(true);
                  }}
                />
              </div>
            )}

            {tab === "history" && (
              <div
                role="tabpanel"
                id="case-panel-history"
                aria-labelledby="case-tab-history"
              >
                {historyError ? (
                  <div className="drawer-state" role="alert">
                    <p>{historyError}</p>
                    <button
                      type="button"
                      onClick={() => setHistoryRetry((n) => n + 1)}
                    >
                      Retry
                    </button>
                  </div>
                ) : historyLoading ? (
                  <div className="drawer-state" role="status" aria-live="polite">
                    <span className="drawer-skeleton" />
                    <span className="drawer-skeleton" />
                    <span className="sr-only">Loading history…</span>
                  </div>
                ) : !history || history.entries.length === 0 ? (
                  <div className="drawer-state">
                    <p>No history yet.</p>
                  </div>
                ) : (
                  <>
                    <ol className="history-list">
                      {history.entries.map((entry) => (
                        <HistoryRow key={entry.id} entry={entry} />
                      ))}
                    </ol>
                    {history.totalPages > 1 && (
                      <div className="history-pagination">
                        <button
                          type="button"
                          disabled={history.page <= 1}
                          onClick={() =>
                            setHistoryPage((page) => Math.max(1, page - 1))
                          }
                        >
                          Previous
                        </button>
                        <span className="t-nums">
                          Page {history.page} of {history.totalPages}
                        </span>
                        <button
                          type="button"
                          disabled={history.page >= history.totalPages}
                          onClick={() => setHistoryPage((page) => page + 1)}
                        >
                          Next
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {tab === "linked" && (
              <div
                role="tabpanel"
                id="case-panel-linked"
                aria-labelledby="case-tab-linked"
              >
                {linkedError ? (
                  <div className="drawer-state" role="alert">
                    <p>{linkedError}</p>
                    <button
                      type="button"
                      onClick={() => setLinkedRetry((n) => n + 1)}
                    >
                      Retry
                    </button>
                  </div>
                ) : linkedLoading ? (
                  <div className="drawer-state" role="status" aria-live="polite">
                    <span className="drawer-skeleton" />
                    <span className="drawer-skeleton" />
                    <span className="sr-only">Loading linked runs…</span>
                  </div>
                ) : !linked || linked.entries.length === 0 ? (
                  <div className="drawer-state">
                    <p>
                      <strong>Not in any run yet.</strong>
                    </p>
                    <p>
                      Select this case on the cases screen and choose Add to
                      run… to include it.
                    </p>
                  </div>
                ) : (
                  <>
                    <ol className="history-list">
                      {linked.entries.map((run) => (
                        <LinkedRunRow
                          key={run.item_id}
                          run={run}
                          projectId={projectId}
                        />
                      ))}
                    </ol>
                    {linked.totalPages > 1 && (
                      <div className="history-pagination">
                        <button
                          type="button"
                          disabled={linked.page <= 1}
                          onClick={() =>
                            setLinkedPage((page) => Math.max(1, page - 1))
                          }
                        >
                          Previous
                        </button>
                        <span className="t-nums">
                          Page {linked.page} of {linked.totalPages}
                        </span>
                        <button
                          type="button"
                          disabled={linked.page >= linked.totalPages}
                          onClick={() => setLinkedPage((page) => page + 1)}
                        >
                          Next
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </Drawer>

      {confirmDelete && detail && (
        <ConfirmDialog
          title="Delete case?"
          body={
            <p>
              <strong>
                {detail.display_id} · {detail.title}
              </strong>{" "}
              will be removed from lists, filters and reports. Its number stays
              reserved and its history is kept.
            </p>
          }
          confirmLabel="Delete case"
          danger
          busy={deleting}
          onConfirm={() => void confirmDeleteCase()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}

function CaseDetails({
  detail,
  suites,
  canWrite,
  onEdit,
  onDelete,
}: {
  detail: CaseDetail;
  suites: readonly SuiteNode[];
  canWrite: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const suite = findSuiteById(suites, detail.suite_id);
  const created = describeTimestamp(detail.created_at);
  const updated = describeTimestamp(detail.updated_at);

  return (
    <div className="case-detail">
      <h3 className="case-detail-title">{detail.title}</h3>

      <dl className="case-meta">
        <div>
          <dt>Priority</dt>
          <dd>
            <PriorityIcon priority={detail.priority} />{" "}
            {PRIORITY_LABELS[detail.priority]}
          </dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>{CASE_TYPE_LABELS[detail.type]}</dd>
        </div>
        <div>
          <dt>Estimate</dt>
          <dd>
            {detail.estimate_minutes === null
              ? "None"
              : formatEstimateInput(detail.estimate_minutes)}
          </dd>
        </div>
        <div>
          <dt>Suite</dt>
          <dd>{suite?.name ?? "No suite"}</dd>
        </div>
      </dl>

      <section className="case-section" aria-labelledby="case-preconditions">
        <h4 id="case-preconditions">Preconditions</h4>
        {detail.preconditions ? (
          <p className="case-preconditions">{detail.preconditions}</p>
        ) : (
          <p className="muted">No preconditions.</p>
        )}
      </section>

      <section className="case-section" aria-labelledby="case-steps">
        <h4 id="case-steps">
          Steps <span className="muted t-nums">({detail.steps.length})</span>
        </h4>
        {detail.steps.length === 0 ? (
          <p className="muted">No steps recorded.</p>
        ) : (
          <ol className="case-steps">
            {detail.steps.map((step) => (
              <li key={step.position}>
                <span className="case-step-number t-nums" aria-hidden="true">
                  {step.position}.
                </span>
                <div>
                  <p>{step.text}</p>
                  {step.expected_result && (
                    <p className="case-step-expected">
                      Expected: {step.expected_result}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="case-section" aria-labelledby="case-tags">
        <h4 id="case-tags">Tags</h4>
        {detail.tags.length === 0 ? (
          <p className="muted">No tags.</p>
        ) : (
          <ul className="case-tag-list">
            {detail.tags.map((tag) => (
              <li key={tag} className="case-tag">
                {tag}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="case-timestamps muted">
        Created{" "}
        <time dateTime={detail.created_at} title={created.title}>
          {created.label}
        </time>{" "}
        · Updated{" "}
        <time dateTime={detail.updated_at} title={updated.title}>
          {updated.label}
        </time>
      </p>

      {canWrite && (
        <div className="button-row case-actions">
          <button type="button" className="primary" onClick={onEdit}>
            Edit case
          </button>
          <button type="button" className="danger" onClick={onDelete}>
            Delete case
          </button>
        </div>
      )}
    </div>
  );
}

function LinkedRunRow({
  run,
  projectId,
}: {
  run: LinkedRun;
  projectId: string;
}) {
  const at = describeTimestamp(run.updated_at);

  return (
    <li className="history-row linked-run-row">
      <div className="history-head">
        <Link
          className="linked-run-name"
          href={`/runs/${run.run_id}?project=${encodeURIComponent(projectId)}`}
        >
          {run.run_name}
        </Link>
        <StatusBadge status={run.status} />
      </div>
      <p className="history-actor">
        {RUN_STATUS_LABELS[run.run_status]} run · updated{" "}
        <time dateTime={run.updated_at} title={at.title}>
          {at.label}
        </time>
      </p>
    </li>
  );
}

function HistoryRow({ entry }: { entry: CaseHistoryEntry }) {
  const changes = describeCaseChanges(entry.changes);
  const at = describeTimestamp(entry.created_at);

  return (
    <li className="history-row">
      <div className="history-head">
        <span className={`history-action history-${entry.action}`}>
          {CASE_ACTION_LABELS[entry.action]}
        </span>
        <time dateTime={entry.created_at} title={at.title}>
          {at.label}
        </time>
      </div>
      <p className="history-actor">
        by <span title={entry.actor_id}>{shortActorId(entry.actor_id)}</span>
      </p>
      {changes.length > 0 ? (
        <ul className="history-changes">
          {changes.map((change) => (
            <li key={change.field}>
              <span className="history-field">{change.label}:</span>{" "}
              {change.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="history-empty">
          {entry.action === "deleted"
            ? "Case deleted."
            : entry.action === "created"
              ? "Case created."
              : "No field details recorded."}
        </p>
      )}
    </li>
  );
}
