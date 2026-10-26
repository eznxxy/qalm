import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import type { Run } from "@/lib/api-types";

/**
 * AddToRunDialog (card 3.4): the bulk "Add to run…" action. The dialog owns
 * the open-run lookup; the page owns the write, so these tests cover the
 * choice gate, the run list's states and the flash copy the page renders.
 */

const mockApi = {
  listRuns: jest.fn(),
};

jest.mock("../../../lib/endpoints", () => ({ api: mockApi }));

function run(overrides: Partial<Run> = {}): Run {
  return {
    id: "r-1",
    project_id: "p-1",
    plan_id: null,
    name: "Run October",
    description: null,
    status: "open",
    start_date: null,
    due_date: "2026-10-28",
    completed_at: null,
    completed_by: null,
    counts: {
      total: 3,
      passed: 1,
      failed: 0,
      blocked: 0,
      retest: 0,
      skipped: 0,
      untested: 2,
      percent_complete: 33,
    },
    assignee_ids: [],
    created_by: "u-1",
    updated_by: "u-1",
    created_at: "2026-10-24T09:00:00Z",
    updated_at: "2026-10-24T09:00:00Z",
    ...overrides,
  };
}

async function renderDialog(
  onSubmit: jest.Mock,
  props: Partial<{ busy: boolean; error: string | null; caseCount: number }> = {}
): Promise<ReturnType<typeof render>> {
  const { AddToRunDialog } = await import(
    "@/components/cases/AddToRunDialog"
  );
  return render(
    <AddToRunDialog
      projectId="p-1"
      caseCount={props.caseCount ?? 2}
      busy={props.busy ?? false}
      error={props.error ?? null}
      onSubmit={onSubmit}
      onCancel={jest.fn()}
    />
  );
}

beforeEach(() => {
  mockApi.listRuns.mockReset();
  mockApi.listRuns.mockResolvedValue({
    data: [run(), run({ id: "r-2", name: "Regression week", due_date: null })],
    meta: { page: 1, limit: 25, total: 2, total_pages: 1 },
  });
});

describe("AddToRunDialog", () => {
  it("offers only open runs, named with their due date", async () => {
    await renderDialog(jest.fn());

    expect(mockApi.listRuns).toHaveBeenCalledWith("p-1", { status: "open" });
    const select = await screen.findByLabelText("Run");
    expect(
      within(select).getByRole("option", {
        name: "Run October · due 28 Oct 2026",
      })
    ).toBeInTheDocument();
    // A run with no due date is just its name — no dangling separator.
    expect(
      within(select).getByRole("option", { name: "Regression week" })
    ).toBeInTheDocument();
  });

  it("requires a choice before it submits", async () => {
    const onSubmit = jest.fn();
    await renderDialog(onSubmit);

    const submit = screen.getByRole("button", { name: "Add to run" });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(await screen.findByLabelText("Run"), {
      target: { value: "r-2" },
    });
    const enabled = screen.getByRole("button", { name: "Add to run" });
    expect(enabled).toBeEnabled();
    fireEvent.click(enabled);

    expect(onSubmit).toHaveBeenCalledWith("r-2", "Regression week");
  });

  it("says there is nothing to add to when the project has no open run", async () => {
    mockApi.listRuns.mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 25, total: 0, total_pages: 1 },
    });
    await renderDialog(jest.fn());

    expect(
      await screen.findByText("No open runs in this project.")
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Run")).toBeNull();
    expect(screen.getByRole("button", { name: "Add to run" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("shows the page's submit error inside the dialog", async () => {
    await renderDialog(jest.fn(), { error: "The run is completed." });

    expect(screen.getByRole("alert")).toHaveTextContent("The run is completed.");
  });

  it("retries a failed run lookup", async () => {
    mockApi.listRuns.mockRejectedValueOnce(new Error("offline"));
    await renderDialog(jest.fn());

    expect(
      await screen.findByText(
        "Could not load open runs. Check your connection and retry."
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(screen.getByLabelText("Run")).toBeInTheDocument());
  });
});

describe("addToRunNotice", () => {
  it("counts what went in and what was already there", async () => {
    const { addToRunNotice } = await import("@/components/cases/AddToRunDialog");

    expect(
      addToRunNotice({ added: 3, skipped: 0, item_ids: [] }, "Run October")
    ).toBe("Added 3 cases to “Run October”.");
    expect(
      addToRunNotice({ added: 1, skipped: 0, item_ids: [] }, "Run October")
    ).toBe("Added 1 case to “Run October”.");
    expect(
      addToRunNotice({ added: 2, skipped: 1, item_ids: [] }, "Run October")
    ).toBe(
      "Added 2 cases to “Run October”. 1 case was already in the run."
    );
    expect(
      addToRunNotice({ added: 1, skipped: 4, item_ids: [] }, "Run October")
    ).toBe(
      "Added 1 case to “Run October”. 4 cases were already in the run."
    );
    // Nothing new: say that plainly instead of "Added 0 cases".
    expect(
      addToRunNotice({ added: 0, skipped: 2, item_ids: [] }, "Run October")
    ).toBe("No new cases — all 2 cases are already in “Run October”.");
  });
});