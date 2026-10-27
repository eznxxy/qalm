import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import {
  PLAN_RUNS_MAX,
  PlanWithRunsDialog,
  type PlanWithRunsValues,
} from "@/components/plans/PlanWithRunsDialog";
import type { Run } from "@/lib/api-types";

/**
 * PlanWithRunsDialog (card 3.6): the runs screen's New plan flow. The plan and
 * at least one run go up as one request (docs/api-plans.md § POST /plans), so
 * these tests pin the two things that matter for that rule — a run always
 * starts in the form and Save is blocked below one — plus the per-run field
 * rules and the indexed `runs[i].<field>` error mapping the API uses.
 *
 * Card 3.10 adds the other half: existing runs with no plan can be attached in
 * the same request (`run_ids`), they count toward the same 1–20 rule, and a
 * rejected attach is reported against its row (`run_ids[i]`).
 */

/** An existing run as `GET /runs?plan_id=none` returns it. */
function makeRun(overrides: Partial<Run> & { id: string; name: string }): Run {
  return {
    project_id: "p-1",
    plan_id: null,
    milestone_id: null,
    milestone_name: null,
    description: null,
    status: "open",
    start_date: null,
    due_date: null,
    completed_at: null,
    completed_by: null,
    counts: {
      total: 4,
      passed: 2,
      failed: 1,
      blocked: 0,
      retest: 0,
      skipped: 0,
      untested: 1,
      percent_complete: 75,
    },
    assignee_ids: [],
    suite_ids: [],
    created_by: "u-1",
    updated_by: "u-1",
    created_at: "2026-10-24T09:00:00Z",
    updated_at: "2026-10-24T09:00:00Z",
    ...overrides,
  };
}

const UNPLANNED: Run[] = [
  makeRun({
    id: "run-nightly",
    name: "Nightly checkout",
    start_date: "2026-10-01",
    due_date: "2026-10-05",
  }),
  makeRun({ id: "run-staging", name: "Smoke on staging" }),
  makeRun({ id: "run-mobile", name: "Mobile smoke" }),
];

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
      runIds: [],
    });
  });

  it("adds and removes runs, numbering them by position", () => {
    const { onSubmit } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Add run" }));
    fireEvent.click(screen.getByRole("button", { name: "Add run" }));
    expect(screen.getAllByRole("group", { name: /^Run \d$/ })).toHaveLength(3);
    expect(screen.getByRole("group", { name: "Run 3" })).toBeInTheDocument();
    expect(
      screen.getByText(`3 new · 0 attached · 3 of ${PLAN_RUNS_MAX} runs`)
    ).toBeInTheDocument();

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
      screen.getByText(
        `${PLAN_RUNS_MAX} new · 0 attached · ${PLAN_RUNS_MAX} of ${PLAN_RUNS_MAX} runs`
      )
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

  it("rejects two runs with the same name, ignoring case and spaces", () => {
    const { onSubmit } = renderDialog();

    fireEvent.change(screen.getByLabelText("Plan name"), {
      target: { value: "Release 2.5" },
    });
    fireEvent.change(runName(0), { target: { value: "Smoke" } });
    fireEvent.click(screen.getByRole("button", { name: "Add run" }));
    fireEvent.change(runName(1), { target: { value: "  smoke  " } });
    fireEvent.click(screen.getByRole("button", { name: "Create plan" }));

    // The first run keeps the name; the later one carries the error, so the
    // payload never reaches the API's 409.
    expect(
      screen.getByText("Run name is already used by Run 1.")
    ).toBeInTheDocument();
    expect(runName(0)).not.toHaveAttribute("aria-invalid");
    expect(runName(1)).toHaveAttribute("aria-invalid", "true");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows the server's indexed run error on the right run", () => {
    renderDialog({
      serverFieldErrors: { "runs[1].name": "already in use" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Add run" }));

    expect(screen.getByText("already in use")).toBeInTheDocument();
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

  // ---- existing runs (card 3.10) ----

  it("attaches an unplanned run and drops the empty starter row", () => {
    const { onSubmit } = renderDialog({ unplannedRuns: UNPLANNED });

    // The picker lists every unplanned run with its facts, so a run can be
    // recognized before it is adopted.
    const pick = screen.getByRole("button", { name: "Attach Nightly checkout" });
    const row = pick.closest("li")!;
    expect(row).toHaveTextContent("Open · 75% complete");
    expect(row).toHaveTextContent("2026-10-01 → 2026-10-05");

    fireEvent.change(screen.getByLabelText("Plan name"), {
      target: { value: "Release 2.5" },
    });
    // The untouched "Run 1" row is a placeholder: attaching answers which runs
    // the plan has, so the row goes away instead of demanding a name.
    expect(screen.getByLabelText("Name")).toBeInTheDocument();

    fireEvent.click(pick);

    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(
      screen.getByText(`0 new · 1 attached · 1 of ${PLAN_RUNS_MAX} runs`)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create plan" }));

    const values = onSubmit.mock.calls[0]?.[0] as PlanWithRunsValues;
    expect(values).toEqual({
      name: "Release 2.5",
      description: "",
      dueDate: "",
      runs: [],
      runIds: ["run-nightly"],
    });
    // The regression this covers: a blank starter row used to block the save
    // with "Run name is required." even though two runs were attached.
    expect(screen.queryByText("Run name is required.")).not.toBeInTheDocument();
  });

  it("keeps a run row the user started when a run is attached", () => {
    const { onSubmit } = renderDialog({ unplannedRuns: UNPLANNED });

    fireEvent.change(screen.getByLabelText("Plan name"), {
      target: { value: "Release 2.5" },
    });
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Release 2.5 smoke" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Attach Nightly checkout" })
    );

    expect(screen.getByLabelText("Name")).toHaveValue("Release 2.5 smoke");
    expect(
      screen.getByText(`1 new · 1 attached · 2 of ${PLAN_RUNS_MAX} runs`)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create plan" }));

    const values = onSubmit.mock.calls[0]?.[0] as PlanWithRunsValues;
    expect(values.runs).toEqual([
      {
        name: "Release 2.5 smoke",
        description: "",
        startDate: "",
        dueDate: "",
      },
    ]);
    expect(values.runIds).toEqual(["run-nightly"]);
  });

  it("ignores an empty run row added after attaching", () => {
    const { onSubmit } = renderDialog({ unplannedRuns: UNPLANNED });

    fireEvent.change(screen.getByLabelText("Plan name"), {
      target: { value: "Release 2.5" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Attach Nightly checkout" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Add run" }));

    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create plan" }));

    const values = onSubmit.mock.calls[0]?.[0] as PlanWithRunsValues;
    expect(values.runs).toEqual([]);
    expect(values.runIds).toEqual(["run-nightly"]);
    expect(screen.queryByText("Run name is required.")).not.toBeInTheDocument();
  });

  it("offers an attached run again once it is removed", () => {
    renderDialog({ unplannedRuns: UNPLANNED });

    fireEvent.click(
      screen.getByRole("button", { name: "Attach Nightly checkout" })
    );
    expect(
      screen.queryByRole("button", { name: "Attach Nightly checkout" })
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Remove Nightly checkout" })
    );

    expect(
      screen.getByRole("button", { name: "Attach Nightly checkout" })
    ).toBeInTheDocument();
    // The starter row went away when the run was attached and is not
    // resurrected by a removal; the empty state asks for a run instead.
    expect(
      screen.getByText(
        "A plan needs at least one run before it can be saved."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(`0 new · 0 attached · 0 of ${PLAN_RUNS_MAX} runs`)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add run" }));
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });

  it("counts attached runs toward the cap of 20", () => {
    renderDialog({ unplannedRuns: UNPLANNED });

    // Attaching drops the placeholder row, so 19 added rows reach the cap
    // together with the attached run.
    fireEvent.click(
      screen.getByRole("button", { name: "Attach Nightly checkout" })
    );
    for (let i = 1; i < PLAN_RUNS_MAX; i += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Add run" }));
    }

    expect(
      screen.getByText(
        `${PLAN_RUNS_MAX - 1} new · 1 attached · ${PLAN_RUNS_MAX} of ${PLAN_RUNS_MAX} runs`
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add run" })).toBeDisabled();
    // The remaining unplanned runs cannot be attached either — the cap spans
    // both lists.
    expect(
      screen.getByRole("button", { name: "Attach Smoke on staging" })
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Attach Mobile smoke" })
    ).toBeDisabled();
  });

  it("shows the server's run_ids error on the attached row", () => {
    renderDialog({
      unplannedRuns: UNPLANNED,
      serverFieldErrors: { "run_ids[0]": "already in a plan" },
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Attach Nightly checkout" })
    );

    const attached = screen.getByText("Nightly checkout").closest("li")!;
    expect(within(attached).getByRole("alert")).toHaveTextContent(
      "already in a plan"
    );
  });

  it("shows the picker's empty state when nothing is unplanned", () => {
    renderDialog({ unplannedRuns: [] });

    expect(
      screen.getByText("No unplanned runs in this project — add one above.")
    ).toBeInTheDocument();
  });

  it("shows the picker's loading state", () => {
    renderDialog({ unplannedRunsLoading: true });

    expect(screen.getByRole("status")).toHaveTextContent("Loading runs…");
    expect(screen.queryByRole("button", { name: /^Attach / })).toBeNull();
  });

  it("surfaces a failed picker load and retries it", () => {
    const onRetry = jest.fn();
    renderDialog({
      unplannedRunsError: "Couldn't load the runs to attach.",
      onRetryUnplannedRuns: onRetry,
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't load the runs to attach."
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});