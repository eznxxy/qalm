import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import type {
  CaseListItem,
  Milestone,
  Plan,
  RunSelection,
  SuiteNode,
} from "@/lib/api-types";
import type { RunFormValues } from "@/components/runs/RunFormDialog";

/**
 * RunFormDialog (card 3.1): inline validation and the create-only case
 * selection it hands back — one or more suite subtrees (one shared descendants
 * toggle, on by default) and/or explicit cases picked from the debounced
 * search.
 */

const mockApi = {
  listCases: jest.fn(),
};

jest.mock("../../../lib/endpoints", () => ({ api: mockApi }));

function suite(
  overrides: Partial<SuiteNode> & { id: string; name: string }
): SuiteNode {
  return {
    project_id: "p-1",
    parent_id: null,
    description: null,
    depth: 1,
    position: 1,
    case_count: 0,
    created_by: "u-1",
    created_at: "2026-10-25T09:00:00Z",
    updated_at: "2026-10-25T09:00:00Z",
    children: [],
    ...overrides,
  };
}

const SUITES: SuiteNode[] = [
  suite({
    id: "s-1",
    name: "Checkout",
    children: [suite({ id: "s-2", parent_id: "s-1", name: "Payments", depth: 2 })],
  }),
  suite({ id: "s-3", name: "Accounts", position: 2 }),
];

const PLANS: Plan[] = [
  {
    id: "pl-1",
    project_id: "p-1",
    name: "Release 2.4",
    description: null,
    due_date: null,
    run_count: 0,
    counts: {
      total: 0,
      passed: 0,
      failed: 0,
      blocked: 0,
      retest: 0,
      skipped: 0,
      untested: 0,
      percent_complete: 0,
    },
    created_by: "u-1",
    updated_by: "u-1",
    created_at: "2026-10-20T12:00:00Z",
    updated_at: "2026-10-20T12:00:00Z",
  },
];

const MILESTONES: Milestone[] = [
  {
    id: "m-1",
    project_id: "p-1",
    name: "2.4 release",
    description: null,
    due_date: "2026-11-14",
    status: "open",
    run_count: 0,
    counts: {
      total: 0,
      passed: 0,
      failed: 0,
      blocked: 0,
      retest: 0,
      skipped: 0,
      untested: 0,
      percent_complete: 0,
    },
    created_by: "u-1",
    updated_by: "u-1",
    created_at: "2026-10-20T12:00:00Z",
    updated_at: "2026-10-20T12:00:00Z",
  },
];

const CASE: CaseListItem = {
  id: "c-1",
  project_id: "p-1",
  suite_id: "s-1",
  case_number: 1,
  display_id: "C1",
  title: "Pay with a saved card",
  priority: "high",
  type: "functional",
  tags: [],
  estimate_minutes: 15,
  created_by: "u-1",
  updated_by: "u-1",
  created_at: "2026-10-25T09:00:00Z",
  updated_at: "2026-10-25T09:12:00Z",
  step_count: 2,
};

async function renderDialog(
  onSubmit: (values: RunFormValues, selection: RunSelection | undefined) => void,
  {
    milestones = [],
    serverFieldErrors,
  }: {
    /** The project's milestones for the optional Milestone select. */
    milestones?: Milestone[];
    serverFieldErrors?: { milestone_id?: string };
  } = {}
): Promise<ReturnType<typeof render>> {
  const { RunFormDialog } = await import("@/components/runs/RunFormDialog");
  return render(
    <RunFormDialog
      projectId="p-1"
      suites={SUITES}
      plans={PLANS}
      milestones={milestones}
      serverFieldErrors={serverFieldErrors}
      onSubmit={onSubmit}
      onCancel={jest.fn()}
    />
  );
}

/** Opens the suite picker and commits the option with the given name. */
function chooseSuite(name: string): void {
  const field = screen.getByLabelText("Whole suites");
  fireEvent.click(field);
  const option = screen.getByRole("option", { name });
  fireEvent.mouseDown(option);
  fireEvent.click(option);
}

beforeEach(() => {
  mockApi.listCases.mockReset();
});

describe("RunFormDialog", () => {
  it("requires a name and does not submit an empty form", async () => {
    const onSubmit = jest.fn();
    await renderDialog(onSubmit);

    fireEvent.click(screen.getByRole("button", { name: "Create run" }));

    expect(screen.getByText("Name is required.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not flag the empty name while the dialog opens", async () => {
    // StrictMode re-runs the mount effect once, and its cleanup returns focus
    // to whatever was focused before the dialog (the "New run" trigger). That
    // momentary blur must not count as the user touching the field.
    const trigger = document.createElement("button");
    trigger.textContent = "New run";
    document.body.appendChild(trigger);
    trigger.focus();

    const { RunFormDialog } = await import("@/components/runs/RunFormDialog");
    render(
      <React.StrictMode>
        <RunFormDialog
          projectId="p-1"
          suites={SUITES}
          plans={PLANS}
          onSubmit={jest.fn()}
          onCancel={jest.fn()}
        />
      </React.StrictMode>
    );

    expect(screen.queryByText("Name is required.")).toBeNull();
    expect(screen.getByLabelText("Name")).toHaveFocus();
    trigger.remove();
  });

  it("submits the run fields with no selection by default", async () => {
    const onSubmit = jest.fn();
    await renderDialog(onSubmit);

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "  Checkout smoke  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create run" }));

    expect(onSubmit).toHaveBeenCalledWith(
      {
        name: "Checkout smoke",
        description: "",
        planId: "",
        milestoneId: "",
        startDate: "",
        dueDate: "",
      },
      undefined
    );
  });

  it("offers the project's milestones and hands the chosen one back", async () => {
    const onSubmit = jest.fn();
    await renderDialog(onSubmit, { milestones: MILESTONES });

    const select = screen.getByLabelText("Milestone");
    expect(select).toHaveValue("");
    expect(within(select).getByRole("option", { name: "No milestone" })).toBeInTheDocument();
    expect(
      within(select).getByRole("option", { name: "2.4 release" })
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Checkout smoke" },
    });
    fireEvent.change(select, { target: { value: "m-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create run" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Checkout smoke", milestoneId: "m-1" }),
      undefined
    );
  });

  it("reports a rejected milestone on its own field", async () => {
    await renderDialog(jest.fn(), {
      serverFieldErrors: { milestone_id: "Milestone not found." },
    });

    expect(screen.getByText("Milestone not found.")).toBeInTheDocument();
  });

  it("hands back the start and due dates as plain YYYY-MM-DD values", async () => {
    const onSubmit = jest.fn();
    await renderDialog(onSubmit);

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Checkout smoke" },
    });
    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2026-11-01" },
    });
    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "2026-11-14" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create run" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: "2026-11-01", dueDate: "2026-11-14" }),
      undefined
    );
  });

  it("blocks submit when the start date is after the due date", async () => {
    const onSubmit = jest.fn();
    await renderDialog(onSubmit);

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Checkout smoke" },
    });
    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2026-11-20" },
    });
    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "2026-11-14" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create run" }));

    expect(
      screen.getByText("Start date must be on or before the due date.")
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("accepts the same day for both dates", async () => {
    const onSubmit = jest.fn();
    await renderDialog(onSubmit);

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Checkout smoke" },
    });
    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2026-11-14" },
    });
    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "2026-11-14" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create run" }));

    expect(onSubmit).toHaveBeenCalled();
  });

  it("builds a suite selection with descendants included by default", async () => {
    const onSubmit = jest.fn();
    await renderDialog(onSubmit);

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Checkout smoke" },
    });
    chooseSuite("Checkout");

    // The picker stays a search box; the choice becomes a chip.
    expect(screen.getByLabelText("Whole suites")).toHaveValue("");
    const chips = screen.getByRole("list", { name: "Selected suites" });
    expect(within(chips).getByText("Checkout")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create run" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Checkout smoke" }),
      { suite_ids: ["s-1"], include_descendants: true }
    );
  });

  it("drops descendants when the toggle is cleared", async () => {
    const onSubmit = jest.fn();
    await renderDialog(onSubmit);

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Checkout smoke" },
    });
    chooseSuite("Checkout");
    fireEvent.click(screen.getByLabelText("Include descendants"));
    fireEvent.click(screen.getByRole("button", { name: "Create run" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Checkout smoke" }),
      { suite_ids: ["s-1"], include_descendants: false }
    );
  });

  it("collects several suites in the order they were added", async () => {
    const onSubmit = jest.fn();
    await renderDialog(onSubmit);

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Release smoke" },
    });
    chooseSuite("Checkout");
    chooseSuite("Accounts");

    const chips = screen.getByRole("list", { name: "Selected suites" });
    expect(
      within(chips)
        .getAllByRole("listitem")
        .map((row) => row.textContent)
    ).toEqual(["Checkout×", "Accounts×"]);

    fireEvent.click(screen.getByRole("button", { name: "Create run" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Release smoke" }),
      { suite_ids: ["s-1", "s-3"], include_descendants: true }
    );
  });

  it("removes one suite and keeps the rest", async () => {
    const onSubmit = jest.fn();
    await renderDialog(onSubmit);

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Release smoke" },
    });
    chooseSuite("Checkout");
    chooseSuite("Accounts");
    fireEvent.click(screen.getByRole("button", { name: "Remove suite Checkout" }));

    expect(screen.queryByRole("button", { name: "Remove suite Checkout" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create run" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Release smoke" }),
      { suite_ids: ["s-3"], include_descendants: true }
    );
  });

  it("does not offer a suite that is already on the run", async () => {
    const onSubmit = jest.fn();
    await renderDialog(onSubmit);

    chooseSuite("Checkout");
    fireEvent.click(screen.getByLabelText("Whole suites"));

    // The chosen root is gone from the list; its child and the other root stay.
    expect(screen.queryByRole("option", { name: "Checkout" })).toBeNull();
    expect(screen.getByRole("option", { name: /Payments/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Accounts" })).toBeInTheDocument();

    // Removing it puts it back.
    fireEvent.keyDown(screen.getByLabelText("Whole suites"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Remove suite Checkout" }));
    fireEvent.click(screen.getByLabelText("Whole suites"));
    expect(screen.getByRole("option", { name: "Checkout" })).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("sends no suite field when every suite was removed", async () => {
    const onSubmit = jest.fn();
    await renderDialog(onSubmit);

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Release smoke" },
    });
    chooseSuite("Checkout");
    fireEvent.click(screen.getByRole("button", { name: "Remove suite Checkout" }));
    fireEvent.click(screen.getByRole("button", { name: "Create run" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Release smoke" }),
      undefined
    );
  });

  it("adds explicit cases from the debounced search and submits their ids", async () => {
    mockApi.listCases.mockResolvedValue({
      data: [CASE],
      meta: { page: 1, limit: 20, total: 1, total_pages: 1 },
    });
    const onSubmit = jest.fn();
    await renderDialog(onSubmit);

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Checkout smoke" },
    });
    fireEvent.change(screen.getByLabelText("Add specific cases"), {
      target: { value: "pay" },
    });

    const add = await screen.findByRole("button", {
      name: /C1 Pay with a saved card/,
    });
    expect(mockApi.listCases).toHaveBeenCalledWith(
      "p-1",
      expect.objectContaining({ query: "pay" })
    );
    fireEvent.click(add);

    // The picker shows a removable chip once the case is selected.
    const chips = screen.getByRole("list", { name: "Selected cases" });
    expect(within(chips).getByText(/C1/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create run" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Checkout smoke" }),
      { case_ids: ["c-1"] }
    );
  });

  it("removes a selected case from the chip list", async () => {
    mockApi.listCases.mockResolvedValue({
      data: [CASE],
      meta: { page: 1, limit: 20, total: 1, total_pages: 1 },
    });
    const onSubmit = jest.fn();
    await renderDialog(onSubmit);

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Checkout smoke" },
    });
    fireEvent.change(screen.getByLabelText("Add specific cases"), {
      target: { value: "pay" },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: /C1 Pay with a saved card/ })
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove C1" }));
    await waitFor(() =>
      expect(screen.queryByRole("list", { name: "Selected cases" })).toBeNull()
    );

    fireEvent.click(screen.getByRole("button", { name: "Create run" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Checkout smoke" }),
      undefined
    );
  });
});