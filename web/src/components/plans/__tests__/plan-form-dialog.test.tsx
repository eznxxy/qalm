import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import type { Plan } from "@/lib/api-types";
import {
  isDateOnly,
  PlanFormDialog,
  type PlanFormValues,
} from "@/components/plans/PlanFormDialog";

/**
 * PlanFormDialog (card 3.3): the three field rules from docs/api-plans.md §
 * Validation — required name, description cap, plain `YYYY-MM-DD` due date —
 * plus edit-mode prefill. Uniqueness stays server-side, so the 409 message is
 * rendered from `serverFieldErrors`.
 */

const PLAN: Plan = {
  id: "pl-1",
  project_id: "p-1",
  name: "Release 2.4",
  description: "Regression sweep.",
  due_date: "2026-11-14",
  run_count: 3,
  counts: {
    total: 10,
    passed: 4,
    failed: 1,
    blocked: 0,
    retest: 0,
    skipped: 0,
    untested: 5,
    percent_complete: 50,
  },
  created_by: "u-1",
  updated_by: "u-1",
  created_at: "2026-10-20T12:00:00Z",
  updated_at: "2026-10-20T12:00:00Z",
};

function renderDialog(
  props: Partial<React.ComponentProps<typeof PlanFormDialog>> = {}
): jest.Mock {
  const onSubmit = jest.fn();
  render(
    <PlanFormDialog
      mode="create"
      onSubmit={onSubmit}
      onCancel={jest.fn()}
      {...props}
    />
  );
  return onSubmit;
}

describe("PlanFormDialog", () => {
  it("requires a name before submitting", () => {
    const onSubmit = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Create plan" }));

    expect(screen.getByText("Name is required.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits the trimmed values", () => {
    const onSubmit = renderDialog();

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "  Release 2.5  " },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "  Smoke first.  " },
    });
    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "2026-12-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create plan" }));

    const values = onSubmit.mock.calls[0]?.[0] as PlanFormValues;
    expect(values).toEqual({
      name: "Release 2.5",
      description: "Smoke first.",
      dueDate: "2026-12-01",
    });
  });

  it("prefills every field in edit mode", () => {
    const onSubmit = renderDialog({ mode: "edit", initial: PLAN });

    expect(screen.getByLabelText("Name")).toHaveValue("Release 2.4");
    expect(screen.getByLabelText("Description")).toHaveValue(
      "Regression sweep."
    );
    expect(screen.getByLabelText("Due date")).toHaveValue("2026-11-14");

    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    expect(onSubmit).toHaveBeenCalledWith({
      name: "Release 2.4",
      description: "Regression sweep.",
      dueDate: "2026-11-14",
    });
  });

  it("shows the server's duplicate-name message on the field", () => {
    renderDialog({
      serverFieldErrors: {
        name: "A plan with this name already exists in the project.",
      },
    });

    expect(
      screen.getByText("A plan with this name already exists in the project.")
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveAttribute(
      "aria-invalid",
      "true"
    );
  });

  it("shows a form-level error from the server", () => {
    renderDialog({ formError: "The project is archived." });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The project is archived."
    );
  });

  it("clears an optional field by submitting an empty string", () => {
    const onSubmit = renderDialog({ mode: "edit", initial: PLAN });

    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));

    const values = onSubmit.mock.calls[0]?.[0] as PlanFormValues;
    expect(values.dueDate).toBe("");
  });
});

describe("isDateOnly", () => {
  it("accepts real calendar dates", () => {
    expect(isDateOnly("2026-11-14")).toBe(true);
    expect(isDateOnly("2028-02-29")).toBe(true);
  });

  it("rejects impossible and unpadded dates", () => {
    expect(isDateOnly("2026-02-30")).toBe(false);
    expect(isDateOnly("2026-2-4")).toBe(false);
    expect(isDateOnly("14/11/2026")).toBe(false);
    expect(isDateOnly("")).toBe(false);
  });
});