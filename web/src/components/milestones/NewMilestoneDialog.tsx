"use client";

/**
 * NewMilestoneDialog — "New milestone" opened from the project overview
 * (docs/PRD-project-overview.md §3.3, acceptance criterion 19).
 *
 * The overview does not navigate to the milestones screen any more: it mounts
 * the same `MilestoneFormDialog` the list screen uses, in create mode, and owns
 * the submit so the list screen's error mapping is not duplicated there. On
 * success the caller closes the dialog and refreshes the cards.
 */
import { useState } from "react";
import type { Milestone } from "@/lib/api-types";
import { api } from "@/lib/endpoints";
import { ApiError } from "@/lib/api-error";
import { isSessionDead } from "@/components/require-auth";
import {
  MilestoneFormDialog,
  type MilestoneFormValues,
} from "./MilestoneFormDialog";

type FieldErrors = {
  name?: string;
  description?: string;
  due_date?: string;
};

export interface NewMilestoneDialogProps {
  projectId: string;
  onCreated: (milestone: Milestone) => void;
  onCancel: () => void;
}

export function NewMilestoneDialog({
  projectId,
  onCreated,
  onCancel,
}: NewMilestoneDialogProps) {
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(values: MilestoneFormValues): Promise<void> {
    setBusy(true);
    setFieldErrors({});
    setFormError(null);
    try {
      // Send all three fields, as the milestones screen does: an emptied input
      // clears the value rather than leaving it unchanged.
      const created = await api.createMilestone(projectId, {
        name: values.name,
        description: values.description || null,
        due_date: values.dueDate || null,
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
      setFieldErrors(fieldErrors);
      setFormError(
        form ??
          (Object.keys(fieldErrors).length === 0
            ? err instanceof ApiError && err.message
              ? err.message
              : "Could not create the milestone. Please try again."
            : null)
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <MilestoneFormDialog
      mode="create"
      busy={busy}
      serverFieldErrors={fieldErrors}
      formError={formError}
      onSubmit={(values) => void submit(values)}
      onCancel={onCancel}
    />
  );
}