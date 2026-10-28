"use client";

/**
 * NewRunDialog — "New run" opened from the project overview
 * (docs/PRD-project-overview.md §3.4, acceptance criterion 19).
 *
 * `RunFormDialog` needs the project's plans, milestones and suites before it
 * can mount its pickers, and the overview only has the first five runs and
 * their plan names. The data is therefore fetched when the dialog opens, behind
 * a small loading shell with Cancel; a failed optional fetch degrades like the
 * runs screen (an empty picker), never blocks the form.
 *
 * On success the caller closes the dialog and stays on the overview: creating a
 * run is the goal, opening its detail screen is a second step.
 */
import { useEffect, useId, useState } from "react";
import type {
  Milestone,
  Plan,
  Run,
  RunSelection,
  SuiteNode,
} from "@/lib/api-types";
import { api } from "@/lib/endpoints";
import { ApiError } from "@/lib/api-error";
import { isSessionDead } from "@/components/require-auth";
import { RunFormDialog, type RunFormValues } from "./RunFormDialog";

type FieldErrors = {
  name?: string;
  description?: string;
  start_date?: string;
  due_date?: string;
  plan_id?: string;
  milestone_id?: string;
  selection?: string;
};

interface DialogData {
  plans: Plan[];
  milestones: Milestone[];
  suites: SuiteNode[];
}

export interface NewRunDialogProps {
  projectId: string;
  onCreated: (run: Run) => void;
  onCancel: () => void;
}

export function NewRunDialog({
  projectId,
  onCreated,
  onCancel,
}: NewRunDialogProps) {
  const [data, setData] = useState<DialogData | null>(null);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const titleId = useId();

  useEffect(() => {
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      // Each fetch is decorative except suites, and even an empty suite picker
      // still allows explicit cases — so none of them fails the dialog.
      const [plans, milestones, suites] = await Promise.all([
        api
          .listPlans(projectId, { limit: 100 })
          .then((page) => page.data)
          .catch(() => []),
        api
          .listMilestones(projectId, { limit: 100 })
          .then((page) => page.data)
          .catch(() => []),
        api.listSuites(projectId).catch(() => []),
      ]);
      if (active) setData({ plans, milestones, suites });
    })();
    return () => {
      active = false;
    };
  }, [projectId]);

  // The shell is a real dialog: Escape must close it while the form loads. Once
  // the form is mounted, RunFormDialog owns Escape (an open combobox keeps the
  // first one), so this listener steps aside.
  useEffect(() => {
    if (data) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onCancel();
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [data, onCancel]);

  async function submit(
    values: RunFormValues,
    selection: RunSelection | undefined
  ): Promise<void> {
    setBusy(true);
    setFieldErrors({});
    setFormError(null);
    try {
      const created = await api.createRun(projectId, {
        name: values.name,
        ...(values.description ? { description: values.description } : {}),
        ...(values.planId ? { plan_id: values.planId } : {}),
        ...(values.milestoneId ? { milestone_id: values.milestoneId } : {}),
        ...(values.startDate ? { start_date: values.startDate } : {}),
        ...(values.dueDate ? { due_date: values.dueDate } : {}),
        ...(selection ? { selection } : {}),
      });
      onCreated(created);
    } catch (err) {
      if (isSessionDead(err)) {
        onCancel();
        return;
      }
      const fieldErrors: FieldErrors = {};
      let form: string | null = null;
      for (const detail of err instanceof ApiError ? (err.details ?? []) : []) {
        // `selection.suite_ids[0]` is a selection problem; show it by the
        // picker rather than as a bare form error.
        const rawField = detail.field ?? "";
        const field = rawField.startsWith("selection.") ? "selection" : rawField;
        if (
          field === "name" ||
          field === "description" ||
          field === "start_date" ||
          field === "due_date" ||
          field === "plan_id" ||
          field === "milestone_id" ||
          field === "selection"
        ) {
          fieldErrors[field] = detail.issue;
        } else {
          form = detail.issue;
        }
      }
      setFieldErrors(fieldErrors);
      setFormError(
        form ??
          (Object.keys(fieldErrors).length === 0
            ? err instanceof ApiError && err.message
              ? err.message
              : "Could not create the run. Please try again."
            : null)
      );
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <div className="dialog-overlay">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="dialog run-dialog"
        >
          <h2 id={titleId}>New run</h2>
          <p className="field-hint" role="status">
            Loading plans, milestones and suites…
          </p>
          <div className="button-row dialog-actions">
            <button type="button" autoFocus onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <RunFormDialog
      projectId={projectId}
      suites={data.suites}
      plans={data.plans}
      milestones={data.milestones}
      busy={busy}
      serverFieldErrors={fieldErrors}
      formError={formError}
      onSubmit={(values, selection) => void submit(values, selection)}
      onCancel={onCancel}
    />
  );
}