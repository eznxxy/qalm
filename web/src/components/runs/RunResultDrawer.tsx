"use client";

/**
 * RunResultDrawer — the run detail's 480px result surface (docs/DESIGN.md §4.4,
 * backlog card 3.2). Opened by clicking an item row (`?item=<itemId>`); it shows
 * the case's snapshotted steps and live preconditions, the [Add result] form and
 * the item's result history.
 *
 * - Status is a segmented button group with the P F B R S shortcuts and
 *   `Ctrl+Enter` for "Save and next" (DESIGN §4.4, §7). The shortcuts are scoped
 *   with `data-shortcut-scope="run-result-form"`, so the shell's `?`/`/`/`g …`
 *   keys stay out of the way while focus is in the drawer, and a plain-letter
 *   status key never fires from inside the comment box (keymap.ts).
 * - `failed` requires a comment; the reason is shown **inline** on the field, not
 *   in a toast (PRD acceptance criterion 4).
 * - Attachments: files staged on a new result are uploaded one-per-request once
 *   the result exists (the contract takes one file per call); the latest result
 *   can also gain an attachment. Add/remove are allowed for the author or an
 *   Admin/Lead (PRD Q4, docs/api-runs.md role matrix).
 * - The caller keys this component by `itemId`, so switching items remounts it
 *   and every block starts fresh (no reset-in-effect).
 */
import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  PRIORITY_LABELS,
  RESULT_STATUSES,
  RESULT_STATUS_SHORTCUTS,
  type Result,
  type ResultAttachment,
  type ResultStatus,
  type Role,
  type RunItemDetail,
} from "@/lib/api-types";
import { api } from "@/lib/endpoints";
import { ApiError } from "@/lib/api-error";
import { isSessionDead } from "@/components/require-auth";
import {
  DisabledHint,
  Drawer,
  STATUS_LABELS,
  StatusBadge,
} from "@/components/ui";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useGlobalShortcuts, type ShortcutDefinition } from "@/lib/keymap";
import { canEditResult, canRecordOnItem } from "@/lib/run-permissions";
import { describeTimestamp } from "@/lib/dates";
import { shortActorId } from "@/lib/case-history";
import { MarkdownLite } from "./MarkdownLite";

/** Mirrors server/src/runs/runs.constants.ts (PRD decision 5). */
const ATTACHMENT_MAX_PER_RESULT = 5;
const ATTACHMENT_MAX_BYTES = 10 * 1_048_576;
const ATTACHMENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/zip",
] as const;

const HISTORY_LIMIT = 25;

type ItemState =
  | { kind: "loading" }
  | { kind: "ready"; item: RunItemDetail }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

type HistoryState =
  | { kind: "loading" }
  | { kind: "ready"; rows: Result[] }
  | { kind: "error"; message: string };

interface FieldErrors {
  status?: string;
  comment?: string;
  elapsed?: string;
  defect?: string;
  file?: string;
}

export interface RunResultDrawerProps {
  runId: string;
  itemId: string;
  /**
   * Whether this user may record *at all* here: the run is open, the project is
   * not archived, and the role is Admin/Lead/Tester. The per-item Tester rule
   * (assigned only) is applied once the item loads, so it also holds for a deep
   * link that opens an item outside the currently loaded page.
   */
  canRecord: boolean;
  /** Why recording is unavailable at the run level, when it is. */
  recordHint?: string | null;
  /** Whether this user may assign items / remove an item from the run. */
  canManage: boolean;
  role: Role;
  userId: string;
  /** The next untested item after this one, or null (the drawer then closes). */
  nextUntestedId: string | null;
  onClose: () => void;
  /** The item changed — refresh the run counts and the items table. */
  onChanged: () => void;
  /** "Save and next" — advance to `nextUntestedId` (or close). */
  onSaveAndNext: () => void;
  /** The item was removed from the run; close the drawer and refresh. */
  onRemoved: () => void;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message || fallback : fallback;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A 10px "×" glyph for the icon-only remove buttons. Decorative: the button
 * carries the accessible name ("Remove <filename>") and a native title.
 */
function RemoveIcon() {
  return (
    <svg
      viewBox="0 0 10 10"
      width="10"
      height="10"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M1.5 1.5l7 7M8.5 1.5l-7 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function RunResultDrawer({
  runId,
  itemId,
  canRecord,
  recordHint,
  canManage,
  role,
  userId,
  nextUntestedId,
  onClose,
  onChanged,
  onSaveAndNext,
  onRemoved,
}: RunResultDrawerProps) {
  const [state, setState] = useState<ItemState>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  const [history, setHistory] = useState<HistoryState>({ kind: "loading" });
  const [historyRetry, setHistoryRetry] = useState(0);

  // ---- add-result form ----
  const [status, setStatus] = useState<ResultStatus | null>(null);
  const [comment, setComment] = useState("");
  const [elapsed, setElapsed] = useState("");
  const [defect, setDefect] = useState("");
  const [staged, setStaged] = useState<File[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [attachmentBusy, setAttachmentBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  // The drawer is keyed by itemId by the caller; a different item remounts it.
  useEffect(() => {
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setState({ kind: "loading" });
      try {
        const item = await api.getRunItem(runId, itemId);
        if (active) setState({ kind: "ready", item });
      } catch (err) {
        if (!active || isSessionDead(err)) return;
        if (err instanceof ApiError && err.status === 404) {
          setState({ kind: "not-found" });
        } else {
          setState({
            kind: "error",
            message: errorMessage(
              err,
              "Could not load the item. Check your connection and retry."
            ),
          });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [runId, itemId, retry]);

  useEffect(() => {
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setHistory({ kind: "loading" });
      try {
        const result = await api.listItemResults(runId, itemId, {
          page: 1,
          limit: HISTORY_LIMIT,
        });
        if (active) setHistory({ kind: "ready", rows: result.data });
      } catch (err) {
        if (!active || isSessionDead(err)) return;
        setHistory({
          kind: "error",
          message: errorMessage(
            err,
            "Could not load the result history. Check your connection and retry."
          ),
        });
      }
    })();
    return () => {
      active = false;
    };
  }, [runId, itemId, historyRetry]);

  const item = state.kind === "ready" ? state.item : null;
  const historyRows = history.kind === "ready" ? history.rows : [];
  const latest = historyRows[0] ?? null;
  const canEditLatest = Boolean(
    latest && canEditResult(role, userId, latest.created_by)
  );
  // PRD acceptance criterion 5: a Tester may record only on an item assigned to
  // them. The drawer learns the assignee from the item it loads, so this holds
  // even when the row is not on the page the table is currently showing.
  const canRecordHere =
    canRecord && canRecordOnItem(role, userId, item?.assignee_id ?? null);

  function resetForm(): void {
    setStatus(null);
    setComment("");
    setElapsed("");
    setDefect("");
    setStaged([]);
    setEditingId(null);
    setFieldErrors({});
  }

  function errorMessageFor(err: unknown, fallback: string): void {
    if (isSessionDead(err)) return;
    if (err instanceof ApiError && err.status === 400) {
      const next: FieldErrors = {};
      let form: string | null = null;
      for (const detail of err.details ?? []) {
        if (detail.field === "comment") next.comment = detail.issue;
        else if (detail.field === "elapsed_minutes") next.elapsed = detail.issue;
        else if (detail.field === "defect_url") next.defect = detail.issue;
        else if (detail.field === "status") next.status = detail.issue;
        else form = detail.issue;
      }
      setFieldErrors(next);
      setFormError(
        form ?? (Object.keys(next).length === 0 ? err.message || fallback : null)
      );
      return;
    }
    if (err instanceof ApiError && err.status === 409) {
      setFormError(
        "This run is completed, or the project is archived. Reopen the run to record results."
      );
      return;
    }
    if (err instanceof ApiError && err.status === 403) {
      setFormError("You can only record results on items assigned to you.");
      return;
    }
    setFormError(errorMessage(err, fallback));
  }

  async function saveEdit(resultId: string): Promise<void> {
    const trimmedComment = comment.trim();
    let elapsedNum: number | null = null;
    let elapsedError: string | null = null;
    if (elapsed.trim() !== "") {
      const parsed = Number(elapsed.trim());
      if (!Number.isInteger(parsed) || parsed < 0) {
        elapsedError = "Enter whole minutes (0 or more).";
      } else {
        elapsedNum = parsed;
      }
    }
    const next: FieldErrors = {};
    if (elapsedError) next.elapsed = elapsedError;
    if (latest?.status === "failed" && !trimmedComment) {
      next.comment = "A comment is required for a failed result.";
    }
    setFieldErrors(next);
    setFormError(null);
    if (elapsedError || next.comment) return;

    setSaving(true);
    try {
      await api.updateResult(resultId, {
        comment: trimmedComment === "" ? null : trimmedComment,
        elapsed_minutes: elapsedNum,
        defect_url: defect.trim() === "" ? null : defect.trim(),
      });
      resetForm();
      onChanged();
      setHistoryRetry((n) => n + 1);
    } catch (err) {
      errorMessageFor(err, "Could not save the changes. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function saveNew(advance: boolean): Promise<void> {
    const next: FieldErrors = {};
    if (!status) next.status = "Pick a result status.";
    if (status === "failed" && !comment.trim()) {
      next.comment = "A comment is required for a failed result.";
    }
    let elapsedNum: number | null = null;
    if (elapsed.trim() !== "") {
      const parsed = Number(elapsed.trim());
      if (!Number.isInteger(parsed) || parsed < 0) {
        next.elapsed = "Enter whole minutes (0 or more).";
      } else {
        elapsedNum = parsed;
      }
    }
    setFieldErrors(next);
    setFormError(null);
    if (Object.keys(next).length > 0 || !status) return;

    setSaving(true);
    try {
      const created = await api.createResult(runId, itemId, {
        status,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
        ...(elapsedNum !== null ? { elapsed_minutes: elapsedNum } : {}),
        ...(defect.trim() ? { defect_url: defect.trim() } : {}),
      });
      let uploadError: string | null = null;
      for (const file of staged) {
        try {
          await api.uploadResultAttachment(created.id, file);
        } catch (err) {
          uploadError = errorMessage(
            err,
            `Could not upload ${file.name}. The result was saved without it.`
          );
          break;
        }
      }
      resetForm();
      onChanged();
      setHistoryRetry((n) => n + 1);
      if (advance) onSaveAndNext();
      if (uploadError) setFormError(uploadError);
    } catch (err) {
      errorMessageFor(err, "Could not save the result. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (editingId) void saveEdit(editingId);
    else void saveNew(false);
  }

  function onStartEdit(result: Result): void {
    setEditingId(result.id);
    setComment(result.comment ?? "");
    setElapsed(
      result.elapsed_minutes === null ? "" : String(result.elapsed_minutes)
    );
    setDefect(result.defect_url ?? "");
    setStaged([]);
    setFieldErrors({});
    setFormError(null);
  }

  function onFilesPicked(event: ChangeEvent<HTMLInputElement>): void {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (picked.length === 0) return;
    const next = [...staged];
    let error: string | null = null;
    for (const file of picked) {
      if (next.length >= ATTACHMENT_MAX_PER_RESULT) {
        error = `At most ${ATTACHMENT_MAX_PER_RESULT} attachments per result.`;
        break;
      }
      if (!(ATTACHMENT_TYPES as readonly string[]).includes(file.type)) {
        error = `${file.name}: that file type is not allowed.`;
        continue;
      }
      if (file.size > ATTACHMENT_MAX_BYTES) {
        error = `${file.name}: files must be 10 MB or smaller.`;
        continue;
      }
      next.push(file);
    }
    setStaged(next);
    setFieldErrors((current) => ({ ...current, file: error ?? undefined }));
  }

  async function uploadToLatest(files: FileList | null): Promise<void> {
    if (!files || !latest) return;
    const picked = Array.from(files);
    if (picked.length === 0) return;
    setFormError(null);
    setAttachmentBusy("upload");
    try {
      for (const file of picked) {
        await api.uploadResultAttachment(latest.id, file);
      }
      setHistoryRetry((n) => n + 1);
    } catch (err) {
      errorMessageFor(err, "Could not upload the attachment. Please try again.");
    } finally {
      setAttachmentBusy(null);
    }
  }

  async function removeAttachment(attachment: ResultAttachment): Promise<void> {
    setFormError(null);
    setAttachmentBusy(attachment.id);
    try {
      await api.deleteAttachment(attachment.id);
      setHistoryRetry((n) => n + 1);
    } catch (err) {
      errorMessageFor(err, "Could not delete the attachment. Please try again.");
    } finally {
      setAttachmentBusy(null);
    }
  }

  async function downloadAttachment(
    attachment: ResultAttachment
  ): Promise<void> {
    try {
      const blob = await api.fetchAttachmentBlob(attachment.id);
      if (typeof URL.createObjectURL !== "function") return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = attachment.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      errorMessageFor(err, "Could not download the attachment.");
    }
  }

  async function removeItem(): Promise<void> {
    setRemoving(true);
    setFormError(null);
    try {
      await api.deleteRunItem(runId, itemId);
      setConfirmRemove(false);
      onRemoved();
    } catch (err) {
      setConfirmRemove(false);
      errorMessageFor(
        err,
        "Could not remove the item. Please try again."
      );
    } finally {
      setRemoving(false);
    }
  }

  const shortcuts = useMemo<ShortcutDefinition[]>(() => {
    const defs: ShortcutDefinition[] = [];
    if (canRecordHere && !editingId) {
      for (const value of RESULT_STATUSES) {
        defs.push({
          key: RESULT_STATUS_SHORTCUTS[value].toLowerCase(),
          scope: "run-result-form",
          handler: () => setStatus(value),
        });
      }
    }
    defs.push({
      key: "Enter",
      mod: true,
      allowInInputs: true,
      scope: "run-result-form",
      handler: () => {
        if (editingId) void saveEdit(editingId);
        else if (canRecordHere) void saveNew(true);
      },
    });
    return defs;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers are rebuilt with the map
  }, [
    canRecordHere,
    editingId,
    status,
    comment,
    elapsed,
    defect,
    staged,
    latest,
  ]);

  useGlobalShortcuts(shortcuts);

  const title = item
    ? `${item.case_display_id} · ${item.case_title}`
    : "Run item";

  return (
    <>
      <div className="rd-scope" data-shortcut-scope="run-result-form">
        <Drawer title={title} onClose={onClose}>
          {state.kind === "loading" && (
            <div className="rd-state" role="status" aria-live="polite">
              <span className="rd-skeleton" />
              <span className="rd-skeleton" />
              <span className="rd-skeleton" />
              <span className="sr-only">Loading item…</span>
            </div>
          )}

          {state.kind === "not-found" && (
            <div className="rd-state" role="alert">
              <p>
                <strong>Item not found.</strong>
              </p>
              <p>It may have been removed from the run.</p>
              <button type="button" onClick={onClose}>
                Close
              </button>
            </div>
          )}

          {state.kind === "error" && (
            <div className="rd-state" role="alert">
              <p>{state.message}</p>
              <button type="button" onClick={() => setRetry((n) => n + 1)}>
                Retry
              </button>
            </div>
          )}

          {item && (
            <>
              <div className="rd-meta">
                <StatusBadge status={item.status} />
                <span className="rd-meta-priority">
                  {PRIORITY_LABELS[item.case_priority]}
                </span>
              </div>

              {item.case_preconditions && (
                <section className="rd-section">
                  <h3>Preconditions</h3>
                  <p className="rd-preconditions">{item.case_preconditions}</p>
                </section>
              )}

              <section className="rd-section">
                <h3>Steps</h3>
                {item.case_steps.length === 0 ? (
                  <p className="muted">No steps recorded for this case.</p>
                ) : (
                  <ol className="rd-steps">
                    {item.case_steps.map((step) => (
                      <li key={step.position}>
                        <span className="rd-step-number t-nums">
                          {step.position}
                        </span>
                        <div>
                          <p>{step.text}</p>
                          {step.expected_result && (
                            <p className="rd-step-expected">
                              Expected: {step.expected_result}
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              <section className="rd-section">
                <h3>{editingId ? "Edit result" : "Add result"}</h3>
                {canRecordHere ? (
                  <form onSubmit={onSubmit} noValidate>
                    {formError && (
                      <p className="form-error" role="alert">
                        {formError}
                      </p>
                    )}

                    <div className="rd-field">
                      <span id="rd-status-label" className="rd-field-label">
                        Status
                      </span>
                      <div
                        className="rd-segmented"
                        role="group"
                        aria-labelledby="rd-status-label"
                      >
                        {RESULT_STATUSES.map((value) => (
                          <button
                            key={value}
                            type="button"
                            className={
                              status === value
                                ? `rd-seg rd-seg-${value} is-active`
                                : `rd-seg rd-seg-${value}`
                            }
                            aria-pressed={status === value}
                            disabled={editingId !== null}
                            onClick={() => setStatus(value)}
                            title={`Shortcut: ${RESULT_STATUS_SHORTCUTS[value]}`}
                          >
                            {STATUS_LABELS[value]}
                          </button>
                        ))}
                      </div>
                      {editingId && (
                        <p className="rd-hint">
                          Status cannot be changed after a result is recorded —
                          add a new result instead.
                        </p>
                      )}
                      {fieldErrors.status && (
                        <p className="field-error">{fieldErrors.status}</p>
                      )}
                    </div>

                    <div className="rd-field">
                      <label htmlFor="rd-comment">
                        Comment
                        {status === "failed" ? " (required)" : ""}
                      </label>
                      <textarea
                        id="rd-comment"
                        rows={4}
                        value={comment}
                        onChange={(event) => setComment(event.target.value)}
                        aria-invalid={Boolean(fieldErrors.comment)}
                        placeholder="What happened? Plain text; links become clickable."
                      />
                      {fieldErrors.comment && (
                        <p className="field-error">{fieldErrors.comment}</p>
                      )}
                    </div>

                    <div className="rd-row">
                      <div className="rd-field">
                        <label htmlFor="rd-elapsed">Elapsed (minutes)</label>
                        <input
                          id="rd-elapsed"
                          type="number"
                          min={0}
                          step={1}
                          value={elapsed}
                          onChange={(event) => setElapsed(event.target.value)}
                          aria-invalid={Boolean(fieldErrors.elapsed)}
                        />
                        {fieldErrors.elapsed && (
                          <p className="field-error">{fieldErrors.elapsed}</p>
                        )}
                      </div>
                      <div className="rd-field">
                        <label htmlFor="rd-defect">Defect link</label>
                        <input
                          id="rd-defect"
                          type="url"
                          value={defect}
                          onChange={(event) => setDefect(event.target.value)}
                          placeholder="https://…"
                          aria-invalid={Boolean(fieldErrors.defect)}
                        />
                        {fieldErrors.defect && (
                          <p className="field-error">{fieldErrors.defect}</p>
                        )}
                      </div>
                    </div>

                    {!editingId && (
                      <div className="rd-field">
                        <label htmlFor="rd-attachments">Attachments</label>
                        <input
                          id="rd-attachments"
                          type="file"
                          multiple
                          accept={ATTACHMENT_TYPES.join(",")}
                          onChange={onFilesPicked}
                        />
                        <p className="rd-hint">
                          Up to {ATTACHMENT_MAX_PER_RESULT} files, 10 MB each.
                          Uploaded when you save.
                        </p>
                        {fieldErrors.file && (
                          <p className="field-error">{fieldErrors.file}</p>
                        )}
                        {staged.length > 0 && (
                          <ul className="rd-staged" aria-label="Staged files">
                            {staged.map((file) => (
                              <li key={`${file.name}-${file.size}`}>
                                <span>
                                  {file.name}{" "}
                                  <span className="muted t-nums">
                                    {formatBytes(file.size)}
                                  </span>
                                </span>
                                <button
                                  type="button"
                                  className="rd-icon-btn"
                                  aria-label={`Remove ${file.name}`}
                                  title="Remove"
                                  onClick={() =>
                                    setStaged((current) =>
                                      current.filter((f) => f !== file)
                                    )
                                  }
                                >
                                  <RemoveIcon />
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}

                    <div className="rd-actions">
                      <DisabledHint
                        hint={saving ? "Saving — please wait" : null}
                      >
                        <button
                          type="submit"
                          className="primary"
                          disabled={saving}
                        >
                          {saving
                            ? "Saving…"
                            : editingId
                              ? "Save changes"
                              : "Save result"}
                        </button>
                      </DisabledHint>
                      {!editingId && (
                        <DisabledHint
                          hint={
                            saving
                              ? "Saving — please wait"
                              : nextUntestedId
                                ? undefined
                                : "No untested item after this one — the drawer closes"
                          }
                        >
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void saveNew(true)}
                          >
                            Save and next
                          </button>
                        </DisabledHint>
                      )}
                      {editingId && (
                        <button
                          type="button"
                          disabled={saving}
                          onClick={resetForm}
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </form>
                ) : (
                  <p className="rd-hint">
                    {canRecord
                      ? "This item isn't assigned to you. Ask a Lead to assign it to you, or record on the items assigned to you."
                      : (recordHint ??
                        "You cannot record a result on this item.")}
                  </p>
                )}
              </section>

              <section className="rd-section">
                <h3>History</h3>
                {history.kind === "loading" && (
                  <div className="rd-state" role="status" aria-live="polite">
                    <span className="rd-skeleton" />
                    <span className="sr-only">Loading history…</span>
                  </div>
                )}
                {history.kind === "error" && (
                  <div className="rd-state" role="alert">
                    <p>{history.message}</p>
                    <button
                      type="button"
                      onClick={() => setHistoryRetry((n) => n + 1)}
                    >
                      Retry
                    </button>
                  </div>
                )}
                {history.kind === "ready" && historyRows.length === 0 && (
                  <p className="rd-hint">No results recorded yet.</p>
                )}
                {history.kind === "ready" && historyRows.length > 0 && (
                  <ol className="rd-history">
                    {historyRows.map((result, index) => (
                      <HistoryRow
                        key={result.id}
                        result={result}
                        timestamp={describeTimestamp(result.created_at)}
                        isLatest={index === 0}
                        canEdit={index === 0 && canEditLatest && !saving}
                        editing={editingId === result.id}
                        busy={attachmentBusy}
                        onEdit={() => onStartEdit(result)}
                        onDeleteAttachment={(attachment) =>
                          void removeAttachment(attachment)
                        }
                        onDownloadAttachment={(attachment) =>
                          void downloadAttachment(attachment)
                        }
                        onAddAttachment={(files) =>
                          void uploadToLatest(files)
                        }
                      />
                    ))}
                  </ol>
                )}
              </section>

              {canManage && (
                <section className="rd-section rd-manage">
                  <DisabledHint
                    hint={
                      item.result_count > 0
                        ? "Items with results cannot be removed — clear the assignee instead"
                        : null
                    }
                  >
                    <button
                      type="button"
                      className="danger"
                      disabled={item.result_count > 0}
                      onClick={() => setConfirmRemove(true)}
                    >
                      Remove from run
                    </button>
                  </DisabledHint>
                </section>
              )}
            </>
          )}
        </Drawer>
      </div>

      {confirmRemove && item && (
        <ConfirmDialog
          title="Remove from run?"
          body={
            <p>
              <strong>
                {item.case_display_id} · {item.case_title}
              </strong>{" "}
              will be removed from this run. The case itself is not deleted.
            </p>
          }
          confirmLabel="Remove item"
          danger
          busy={removing}
          onConfirm={() => void removeItem()}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </>
  );
}

function HistoryRow({
  result,
  timestamp,
  isLatest,
  canEdit,
  editing,
  busy,
  onEdit,
  onDeleteAttachment,
  onDownloadAttachment,
  onAddAttachment,
}: {
  result: Result;
  timestamp: { label: string; title: string };
  isLatest: boolean;
  canEdit: boolean;
  editing: boolean;
  busy: string | null;
  onEdit: () => void;
  onDeleteAttachment: (attachment: ResultAttachment) => void;
  onDownloadAttachment: (attachment: ResultAttachment) => void;
  onAddAttachment: (files: FileList | null) => void;
}) {
  return (
    <li className={editing ? "rd-history-row is-editing" : "rd-history-row"}>
      <div className="rd-history-head">
        <StatusBadge status={result.status} />
        <time dateTime={result.created_at} title={timestamp.title}>
          {timestamp.label}
        </time>
      </div>
      <p className="rd-history-actor">
        by <span title={result.created_by}>{shortActorId(result.created_by)}</span>
        {result.elapsed_minutes !== null && (
          <>
            {" · "}
            <span className="t-nums">{result.elapsed_minutes} min</span>
          </>
        )}
        {isLatest && " · latest"}
      </p>

      {result.comment && (
        <MarkdownLite text={result.comment} className="rd-history-comment" />
      )}

      {result.defect_url && (
        <p className="rd-history-defect">
          <a
            href={result.defect_url}
            target="_blank"
            rel="noreferrer noopener"
          >
            {result.defect_url}
          </a>
        </p>
      )}

      {result.attachments.length > 0 && (
        <ul className="rd-attachments" aria-label="Attachments">
          {result.attachments.map((attachment) => (
            <li key={attachment.id}>
              <button
                type="button"
                className="linklike"
                onClick={() => onDownloadAttachment(attachment)}
              >
                {attachment.filename}
              </button>
              <span className="muted t-nums">
                {formatBytes(attachment.size_bytes)}
              </span>
              {canEdit && (
                <DisabledHint
                  hint={
                    busy === attachment.id ? "Removing — please wait" : null
                  }
                >
                  <button
                    type="button"
                    className="rd-icon-btn"
                    aria-label={`Remove ${attachment.filename}`}
                    title="Remove"
                    disabled={busy === attachment.id}
                    onClick={() => onDeleteAttachment(attachment)}
                  >
                    <RemoveIcon />
                  </button>
                </DisabledHint>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && !editing && (
        <div className="rd-history-actions">
          <button type="button" className="linklike" onClick={onEdit}>
            Edit result
          </button>
          <label className="rd-attach-add">
            <span className="linklike">Add attachment</span>
            <input
              type="file"
              multiple
              accept={ATTACHMENT_TYPES.join(",")}
              disabled={busy !== null}
              onChange={(event) => {
                onAddAttachment(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
        </div>
      )}
    </li>
  );
}