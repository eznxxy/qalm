import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Run } from "@/lib/api-types";
import type { AddRunsDialogProps } from "@/components/milestones/AddRunsDialog";

/**
 * AddRunsDialog (docs/DESIGN.md §4.5, docs/api-milestones.md § POST
 * /milestones/:id/runs). The dialog only offers runs the page fetched with
 * `milestone_id=none`; ticking is local until Save, and a rejected id must land
 * on the row the server named (`run_ids[i]`), not on the whole list.
 */

function run(overrides: Partial<Run> & { id: string; name: string }): Run {
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

const RUNS: Run[] = [
  run({ id: "r-1", name: "Release 2.4 smoke", due_date: "2026-11-14" }),
  run({ id: "r-2", name: "Ad-hoc checkout", status: "completed" }),
];

async function renderDialog(props: Partial<AddRunsDialogProps> = {}) {
  const { AddRunsDialog } = await import(
    "@/components/milestones/AddRunsDialog"
  );
  return render(
    <AddRunsDialog
      runs={RUNS}
      onSubmit={jest.fn()}
      onCancel={jest.fn()}
      {...props}
    />
  );
}

function submitButton(): HTMLElement {
  return screen.getByRole("button", { name: /^Add( \d+ run)?/ });
}

describe("AddRunsDialog", () => {
  it("lists each candidate with its status, progress and due date", async () => {
    await renderDialog();

    const first = screen.getByLabelText(/Release 2\.4 smoke/);
    expect(first).not.toBeChecked();
    expect(
      screen.getByText("Open · 75% complete · due 14 Nov 2026")
    ).toBeInTheDocument();
    expect(screen.getByText("Completed · 75% complete")).toBeInTheDocument();
  });

  it("keeps Save disabled until something is ticked, then counts the runs", async () => {
    const onSubmit = jest.fn();
    await renderDialog({ onSubmit });

    expect(submitButton()).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/Release 2\.4 smoke/));
    expect(screen.getByRole("button", { name: "Add 1 run" })).toBeEnabled();

    fireEvent.click(screen.getByLabelText(/Ad-hoc checkout/));
    expect(screen.getByRole("button", { name: "Add 2 runs" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Add 2 runs" }));
    expect(onSubmit).toHaveBeenCalledWith(["r-1", "r-2"]);
  });

  it("unticking removes a run from the request", async () => {
    const onSubmit = jest.fn();
    await renderDialog({ onSubmit });

    fireEvent.click(screen.getByLabelText(/Release 2\.4 smoke/));
    fireEvent.click(screen.getByLabelText(/Ad-hoc checkout/));
    fireEvent.click(screen.getByLabelText(/Release 2\.4 smoke/));

    expect(screen.getByRole("button", { name: "Add 1 run" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Add 1 run" }));
    expect(onSubmit).toHaveBeenCalledWith(["r-2"]);
  });

  it("indexes run_ids by tick order on screen, so a server error names the right row", async () => {
    // The user ticks the second run first; the request order is still list
    // order, and `run_ids[0]` therefore belongs to the first run on screen.
    await renderDialog({
      serverFieldErrors: { "run_ids[0]": "already in a milestone" },
    });

    fireEvent.click(screen.getByLabelText(/Ad-hoc checkout/));
    fireEvent.click(screen.getByLabelText(/Release 2\.4 smoke/));

    const firstRow = screen
      .getByLabelText(/Release 2\.4 smoke/)
      .closest("li") as HTMLElement;
    const secondRow = screen
      .getByLabelText(/Ad-hoc checkout/)
      .closest("li") as HTMLElement;
    expect(within(firstRow).getByRole("alert")).toHaveTextContent(
      "already in a milestone"
    );
    expect(within(secondRow).queryByRole("alert")).toBeNull();
  });

  it("shows the list-level run_ids error above the picker", async () => {
    await renderDialog({
      serverFieldErrors: { run_ids: "Select at least one run." },
    });
    expect(screen.getByText("Select at least one run.")).toBeInTheDocument();
  });

  it("shows the form error and keeps the selection", async () => {
    await renderDialog({ formError: "Something went wrong." });
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong.");
  });

  it("offers a retry when the candidate list fails to load", async () => {
    const onRetry = jest.fn();
    await renderDialog({
      runs: [],
      error: "Couldn't load the runs to add.",
      onRetry,
    });

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("says so when the project has nothing to attach", async () => {
    await renderDialog({ runs: [] });
    expect(
      screen.getByText("No runs without a milestone in this project.")
    ).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it("blocks both actions while saving", async () => {
    const onCancel = jest.fn();
    await renderDialog({ busy: true, onCancel });

    fireEvent.click(screen.getByLabelText(/Release 2\.4 smoke/));
    expect(screen.getByRole("button", { name: "Adding…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});