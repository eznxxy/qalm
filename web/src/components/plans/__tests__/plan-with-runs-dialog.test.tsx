import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import {
  PLAN_RUNS_MAX,
  PlanWithRunsDialog,
  type PlanWithRunsValues,
} from "@/components/plans/PlanWithRunsDialog";

/**
 * PlanWithRunsDialog (card 3.6): the runs screen's New plan flow. The plan and
 * at least one run go up as one request (docs/api-plans.md § POST /plans), so
 * these tests pin the two things that matter for that rule — a run always
 * starts in the form and Save is blocked below one — plus the per-run field
 * rules and the indexed `runs[i].<field>` error mapping the API uses.
 */

function renderDialog(
  props: Partial<React.ComponentProps<typeof PlanWithRunsDialog>> = {}
): { onSubmit: jest.Mock; onCancel: jest.Mock } {
  const onSubmit = jest.fn();
  const onCancel = jest.fn();
  render(
    <PlanWithRunsDialog onSubmit={onSubmit} onCancel={onCancel} {...props} />
  );
  return { onSubmit, onCancel };
}

/** The nth run's Name input — every run's field is labelled just "Name". */
function runName(index = 0): HTMLElement {
  return screen.getAllByLabelText("Name")[index]!;
}

describe("PlanWithRunsDialog", () => {
  it("starts with one run and both halves of the name required", () => {
    const { onSubmit } = renderDialog();

    expect(screen.getByRole("group", { name: "Run 1" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create plan" }));

    expect(screen.getByText("Plan name is required.")).toBeInTheDocument();
    expect(screen.getByText("Run name is required.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits the plan and its run, trimmed, in one payload", () => {
    const { onSubmit } = renderDialog();

    fireEvent.change(screen.getByLabelText("Plan name"), {
      target: { value: "  Release 2.5  " },
    });
    fireEvent.change(screen.getByLabelText("Plan description"), {
      target: { value: "  Sweep before the release.  " },
    });
    fireEvent.change(screen.getByLabelText("Plan due date"), {
      target: { value: "2026-12-15" },
    });
    fireEvent.change(runName(), { target: { value: "  Smoke  " } });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "  Checkout first.  " },
    });
    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2026-12-01" },
    });
    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "2026-12-10" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create plan" }));

    const values = onSubmit.mock.calls[0]?.[0] as PlanWithRunsValues;
    expect(values).toEqual({
      name: "Release 2.5",
      description: "Sweep before the release.",
      dueDate: "2026-12-15",
      runs: [
        {
          name: "Smoke",
          description: "Checkout first.",
          startDate: "2026-12-01",
          dueDate: "2026-12-10",
        },
      ],
    });
  });

  it("adds and removes runs, numbering them by position", () => {
    const { onSubmit } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Add run" }));
    fireEvent.click(screen.getByRole("button", { name: "Add run" }));
    expect(screen.getAllByRole("group", { name: /^Run \d$/ })).toHaveLength(3);
    expect(screen.getByRole("group", { name: "Run 3" })).toBeInTheDocument();
    expect(screen.getByText(`3 of ${PLAN_RUNS_MAX} runs`)).toBeInTheDocument();

    // Removing Run 2 renumbers the rest, so the last run becomes Run 2.
    fireEvent.click(screen.getByRole("button", { name: "Remove run 2" }));
    expect(screen.getAllByRole("group", { name: /^Run \d$/ })).toHaveLength(2);
    expect(screen.getByRole("group", { name: "Run 2" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Plan name"), {
      target: { value: "Release 2.5" },
    });
    fireEvent.change(runName(0), { target: { value: "Smoke" } });
    fireEvent.change(runName(1), { target: { value: "Regression" } });
    fireEvent.click(screen.getByRole("button", { name: "Create plan" }));

    const values = onSubmit.mock.calls[0]?.[0] as PlanWithRunsValues;
    expect(values.runs.map((run) => run.name)).toEqual(["Smoke", "Regression"]);
  });

  it("stops at the contract's cap of 20 runs", () => {
    renderDialog();

    for (let i = 1; i < PLAN_RUNS_MAX; i += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Add run" }));
    }

    expect(screen.getAllByRole("group", { name: /^Run \d+$/ })).toHaveLength(
      PLAN_RUNS_MAX
    );
    expect(
      screen.getByText(`${PLAN_RUNS_MAX} of ${PLAN_RUNS_MAX} runs`)
    ).toBeInTheDocument();
    // Re-queried: at the cap the button moves inside a DisabledHint wrapper,
    // so the pre-cap node is no longer the one on screen.
    expect(screen.getByRole("button", { name: "Add run" })).toBeDisabled();
  });

  it("blocks Save once the last run is removed", () => {
    const { onSubmit } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Remove run 1" }));

    expect(
      screen.getByText("A plan needs at least one run before it can be saved.")
    ).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Create plan" });
    expect(save).toBeDisabled();

    // A disabled button cannot fire a submit; the click is here to prove the
    // guard behind it, not to expect a call.
    fireEvent.click(save);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps a run's start date on or before its due date", () => {
    const { onSubmit } = renderDialog();

    fireEvent.change(screen.getByLabelText("Plan name"), {
      target: { value: "Release 2.5" },
    });
    fireEvent.change(runName(), { target: { value: "Smoke" } });
    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2026-12-10" },
    });
    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "2026-12-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create plan" }));

    expect(
      screen.getByText("Start date must be on or before the due date.")
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Start date")).toHaveAttribute(
      "aria-invalid",
      "true"
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows the server's indexed run error on the right run", () => {
    renderDialog({
      serverFieldErrors: { "runs[1].name": "Run name must be unique in the plan." },
    });

    fireEvent.click(screen.getByRole("button", { name: "Add run" }));

    expect(
      screen.getByText("Run name must be unique in the plan.")
    ).toBeInTheDocument();
    expect(runName(0)).not.toHaveAttribute("aria-invalid");
    expect(runName(1)).toHaveAttribute("aria-invalid", "true");
  });

  it("shows the server's plan field error and a form-level error", () => {
    renderDialog({
      serverFieldErrors: { name: "A plan with this name already exists." },
      formError: "The project is archived.",
    });

    expect(
      screen.getByText("A plan with this name already exists.")
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Plan name")).toHaveAttribute(
      "aria-invalid",
      "true"
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The project is archived."
    );
  });

  it("disables the whole form while the request is in flight", () => {
    renderDialog({ busy: true });

    expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add run" })).toBeDisabled();
    expect(screen.getByLabelText("Plan name")).toBeDisabled();
    expect(runName()).toBeDisabled();
  });

  it("cancels from the Cancel button and from Escape", () => {
    const { onCancel } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(within(dialog).getByLabelText("Plan name"), {
      key: "Escape",
    });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});